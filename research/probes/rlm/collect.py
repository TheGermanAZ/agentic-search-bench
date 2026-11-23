"""Builds research/probes/results/rlm.json from out/*.json and the pinned source facts."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
REL = "research/probes/rlm/out"
SHA = "e11f1a8f8ee4490686e16dd6463233abe08a07eb"
GH = f"https://github.com/alexzhang13/rlm/blob/{SHA}"

probes = {}
for pid in ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"]:
    d = json.loads((HERE / "out" / f"{pid}.json").read_text())
    probes[pid] = {"outcome": d["outcome"], "detail": d["detail"], "evidence": f"{REL}/{pid}.txt"}
for pid in ["P9b", "CTX"]:
    d = json.loads((HERE / "out" / f"{pid}.json").read_text())
    probes[pid] = {"outcome": d["outcome"], "detail": d["detail"] + " (extra beyond SPEC)", "evidence": f"{REL}/{pid}.txt"}

result = {
    "impl": "rlm",
    "name": "Recursive Language Models (Zhang, Kraska, Khattab; arXiv 2512.24601): LocalREPL",
    "source": "https://github.com/alexzhang13/rlm (MIT), paper https://arxiv.org/html/2512.24601v3",
    "pinned": f"commit {SHA} (default branch HEAD, pushed 2026-11-21); rlm 0.1.3",
    "language": "Python",
    "engine": "CPython exec() in the host process, with a restricted builtins dict (LocalREPL is a NonIsolatedEnv). No isolation.",
    "how_run": "LocalREPL(lm_handler_address=None, custom_tools={'lookup': fn}) with llm_query replaced by a stub, then env.execute_code(code) for each cell. This is the call rlm/core/rlm.py makes at rlm.py:757.",
    "probes": probes,
    "defaults": {
        "time": "None at the REPL level: P6 ran past the 120 s watchdog. RLM(max_timeout=None) is checked only between iterations (rlm.py:421-422, 551-553), not inside a cell.",
        "memory": "None. P7 reached 4.03 GB peak RSS in 1.0 s with no error; the harness stopped it.",
        "output": "execute_code returns all stdout, uncapped (P2: 200,001 chars). The model view is capped at 20,000 chars per block, head only, with a '... + [N chars...]' marker (parsing.py:26, 58-62).",
        "tool_calls": "No cap on custom-tool calls. Sub-LLM concurrency is capped at max_concurrent_subcalls=4 (local_repl.py:170, 397).",
    },
    "source_notes": [
        {"topic": "API shape", "finding": "custom_tools is a dict of name to callable. setup() copies each callable into self.globals, so the cell sees it as a plain name (P1). Names in RESERVED_TOOL_NAMES are refused. The reserved helpers are llm_query, llm_query_batched, rlm_query, rlm_query_batched, SHOW_VARS and answer.", "evidence": f"{GH}/rlm/environments/local_repl.py#L167, #L198, #L241-L243; {GH}/rlm/environments/base_env.py#L13, #L130-L147"},
        {"topic": "Discovery", "finding": "The system prompt lists the built-in helpers and the context variable up front (context, llm_query, rlm_query, SHOW_VARS). I did not find where custom tool names reach the prompt, so I did not claim it.", "evidence": f"{GH}/rlm/utils/prompts.py#L132-L140"},
        {"topic": "Bridge", "finding": "Custom tools: none. They are direct calls in the same process. llm_query is the only bridge, and it is a socket request to an LM handler: send_lm_request(lm_handler_address, LMRequest(...)). With no handler it returns the string 'Error: No LM handler configured', which is what the stub replaces.", "evidence": f"{GH}/rlm/environments/local_repl.py#L266-L289; {GH}/rlm/core/comms_utils.py"},
        {"topic": "Isolation boundary", "finding": "None for the default local REPL. The builtins dict keeps __import__, open and getattr, and drops only eval, exec, input, compile, globals and locals (set to None). The code runs through exec() in the host process (P3, P4, P5 and P12 all reached the host). The LocalREPL docstring says 'sandboxed namespace', and base_env.py's NonIsolatedEnv docstring says the default runs 'as a subprocess'. The code does neither. The README says 'generally safe' for local use.", "evidence": f"{GH}/rlm/environments/local_repl.py#L60, #L107, #L121-L122, #L145, #L156-L157, #L578 (exec); {GH}/rlm/environments/base_env.py#L259-L263; {GH}/README.md (Local Environments, line 99)"},
        {"topic": "Output channel", "finding": "execute_code returns REPLResult(stdout, stderr, locals, execution_time, llm_calls, final_answer). exec() returns None, so the last expression's value is not returned (P2). stdout is captured by swapping sys.stdout, a process-wide change for the duration of the cell. The model sees formatted output cut at 20,000 chars (head only), and the prompt tells the model about it.", "evidence": f"{GH}/rlm/environments/local_repl.py#L509-L518 (_capture_output), #L564-L604 (execute_code), #L578 (exec); {GH}/rlm/utils/parsing.py#L26, #L57-L62 (format_iteration); {GH}/rlm/utils/prompts.py#L141"},
        {"topic": "Limits", "finding": "The REPL has no time limit and no memory limit (P6, P7). The RLM-level max_timeout is checked between iterations only. The only numeric caps are the 20,000-char model view and max_concurrent_subcalls=4 for batched sub-calls.", "evidence": f"{GH}/rlm/core/rlm.py#L66, #L421-L422, #L551-L553; {GH}/rlm/environments/local_repl.py#L170, #L382-L397 (ThreadPoolExecutor for batched sub-calls)"},
        {"topic": "State", "finding": "Persistent within one environment object. self.globals and self.locals survive between execute_code calls, and _restore_scaffold resets the reserved names after each cell (P8). The RLM persistent flag only controls whether a fresh environment is spawned per completion() call (default False: a new one each call).", "evidence": f"{GH}/rlm/environments/local_repl.py#L215-L243 (setup), #L530-L562 (_restore_scaffold), #L578-L586 (namespace update); {GH}/rlm/core/rlm.py#L224, #L267-L272, #L303-L304"},
        {"topic": "Errors", "finding": "Exceptions are caught in execute_code and appended to stderr as '\\n<Type>: <message>'. No traceback and no line number (P10). The harness saw only that string.", "evidence": f"{GH}/rlm/environments/local_repl.py#L589-L592"},
        {"topic": "Corpus exposure", "finding": "The corpus is the completion's prompt (rlm.py sets env_kwargs['context_payload'] = prompt). A str is written as plain text to <temp_dir>/context_0.txt and read back inside the REPL. A list or dict goes to context_0.json. 'context' is an alias of context_0. The corpus sits on disk in plaintext until cleanup (CTX).", "evidence": f"{GH}/rlm/core/rlm.py#L317; {GH}/rlm/environments/local_repl.py#L415-L455 (load_context, add_context), #L438-L452"},
        {"topic": "Parallelism", "finding": "Batched sub-calls use a ThreadPoolExecutor. Custom tools get no such helper, but any cell can import concurrent.futures, since __import__ is available (P9b ran 5 lookups in 210 ms). The plain loop (P9) is serial at about 1 s.", "evidence": f"{GH}/rlm/environments/local_repl.py#L382-L397 (batched sub-calls)"},
    ],
    "surprises": [
        "The 'sandboxed namespace' wording in the LocalREPL docstring and the 'as a subprocess' wording in base_env.py do not match the code, which runs exec() in the host process with open, __import__ and getattr available (local_repl.py#L156-L157, base_env.py#L259-L263, local_repl.py#L578).",
        "The default REPL has no time limit, so a cell that never ends never returns (P6). The RLM loop calls execute_code synchronously (rlm.py#L757), so the loop waits with it. max_timeout is checked only between iterations (rlm.py#L421-L422).",
        "The last expression of a cell is silently dropped, since exec returns None. The model's view of output is also cut to 20,000 chars with the tail gone (P2).",
        "P12 escaped twice: __import__('os').system and the os._wrap_close globals route both ran echo on the host (the PWNED lines are in out/P12.log).",
        "Corpus sits in plaintext in a temp directory during the run (CTX).",
        "The P3 network probe needed a CA bundle fix on this machine. Without it the failure was a certificate error, not a sandbox block.",
    ],
}

out = REPO / "research" / "probes" / "results" / "rlm.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2) + "\n")
print(out)

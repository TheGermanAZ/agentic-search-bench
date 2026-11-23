"""Builds research/probes/results/smolagents-local.json from out/*.json and the pinned source facts."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
REL = "research/probes/smolagents-local/out"
GH = "https://github.com/huggingface/smolagents/blob/12c1bc820eca50ace6f80a21d90426d41d74f845"
LPE = "src/smolagents/local_python_executor.py"

probes = {}
for pid in ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"]:
    d = json.loads((HERE / "out" / f"{pid}.json").read_text())
    probes[pid] = {"outcome": d["outcome"], "detail": d["detail"], "evidence": f"{REL}/{pid}.txt"}
extras = ["P4b", "P6b", "P9b"]
for pid in extras:
    d = json.loads((HERE / "out" / f"{pid}.json").read_text())
    probes[pid] = {"outcome": d["outcome"], "detail": d["detail"] + " (extra beyond SPEC)", "evidence": f"{REL}/{pid}.txt"}

result = {
    "impl": "smolagents-local",
    "name": "Hugging Face smolagents CodeAgent, LocalPythonExecutor",
    "source": "PyPI smolagents; repo https://github.com/huggingface/smolagents",
    "pinned": "smolagents 1.26.0 (git tag v1.26.0 = 12c1bc820eca50ace6f80a21d90426d41d74f845)",
    "language": "Python",
    "engine": "CPython process running smolagents' own AST walker (evaluate_ast), not a separate runtime. Code runs in-process with the host, and a timeout runs it in a ThreadPoolExecutor worker thread.",
    "how_run": "LocalPythonExecutor(additional_authorized_imports=[]) with send_tools({'lookup': Tool}), then executor(code) for each probe. This is the class CodeAgent builds when executor_type='local' (agents.py:1598-1606).",
    "probes": probes,
    "defaults": {
        "time": "MAX_EXECUTION_TIME_SECONDS = 30 (local_python_executor.py:60). Not enforced as a wall clock: the caller gets the timeout only after the worker finishes (P6b, 35.01 s). The loop caps stop infinite loops first (P6, 1.9 s).",
        "memory": "None found. 4.12 GB peak RSS reached with no error (P7), stopped by the harness.",
        "output": "DEFAULT_MAX_LEN_OUTPUT = 50000 chars for print logs (local_python_executor.py:57). Head and tail kept with a marker in the middle (utils.py:257-265). Return value is not truncated.",
        "tool_calls": "No cap in the executor or the CodeAgent path. MAX_OPERATIONS = 10,000,000 counts AST node evaluations, not tool calls (local_python_executor.py:58, 1444-1448).",
    },
    "source_notes": [
        {"topic": "API shape", "finding": "Tools are smolagents Tool objects passed to send_tools(). They go into static_tools and are called in the sandbox as Python functions with keyword args. There is no generated stub. Calls go through evaluate_call, and a static tool cannot be overwritten by the code.", "evidence": f"{GH}/{LPE}#L1763-L1765 (send_tools); #L825 (evaluate_call); #L1708-L1723 (__init__)"},
        {"topic": "Discovery", "finding": "All tools are rendered into the agent's system prompt up front through the 'tools' template variable, so the model sees every tool before writing code. The executor itself has no search or read step.", "evidence": f"{GH.replace('local_python_executor', 'agents')}/src/smolagents/agents.py#L1269 (the template variable 'tools'); the executor itself has no discovery function"},
        {"topic": "Bridge", "finding": "No bridge. A tool call is a direct Python call in the same process. The Tool's forward() runs on the host, the sandbox and host share one interpreter, and there is no RPC, postMessage, or snapshot. Host calls are counted by the probe (P1, P9).", "evidence": f"{GH}/{LPE}#L825-L865 (evaluate_call dispatches Python callables)"},
        {"topic": "Isolation boundary", "finding": "The class docstring says it is not a security sandbox and points to remote executors for untrusted code. The guards are: an import allowlist (11 modules), dunder-attribute blocking, and a check that refuses module objects reached through attributes ('Forbidden access to module'). Those guards held in P3 to P5 and P12a to d. A custom AST walker is not a security boundary, so these guards are a filter, not a proof.", "evidence": f"{GH}/{LPE}#L1688-L1694 (docstring); #L68-L71 (nodunder_getattr); #L156-L175 (check_safer_result); #L372 (check_import_authorized)"},
        {"topic": "Import allowlist", "finding": "BASE_BUILTIN_MODULES = collections, datetime, itertools, math, queue, random, re, stat, statistics, time, unicodedata. CodeAgent adds additional_authorized_imports on top, and the default is none. Only 'time' gives a clock, and there is no asyncio or threading.", "evidence": "https://github.com/huggingface/smolagents/blob/12c1bc820eca50ace6f80a21d90426d41d74f845/src/smolagents/utils.py#L49-L61; agents.py#L1543-L1544"},
        {"topic": "Output channel", "finding": "__call__ returns CodeOutput(output, logs, is_final_answer). output is the last expression's value. logs is the print buffer. Both come back to the caller, and the print buffer is truncated, not the return value (P2).", "evidence": f"{GH}/{LPE}#L1747-L1758 (__call__); #L1583-L1676 (evaluate_python_code); utils.py#L257-L265 (truncate_content)"},
        {"topic": "Limits", "finding": "Time: MAX_EXECUTION_TIME_SECONDS = 30, applied by the timeout() wrapper, which runs the code in a ThreadPoolExecutor. The 'with' block waits for the worker in __exit__, so the caller is not cut off at 30 s (P6b). Operations: MAX_OPERATIONS = 10M, checked in evaluate_ast. While loops: MAX_WHILE_ITERATIONS = 1M, which stops P6 in 1.9 s. Memory: no limit in the source.", "evidence": f"{GH}/{LPE}#L57-L60 (constants); #L285-L318 (timeout; 'with' at #L308, except at #L313); #L457-L458 (while cap); #L1444-L1448 (operations cap)"},
        {"topic": "State", "finding": "Persistent. The executor keeps self.state across __call__, and send_variables() writes into it. evaluate_python_code resets only the print buffer and the operation counter each call. CodeAgent creates one executor per agent instance, so variables carry across steps of one run (P8).", "evidence": f"{GH}/{LPE}#L1716 (self.state); #L1627-L1628 (per-call reset of _print_outputs and _operations_count); #L1760-L1761 (send_variables); agents.py#L1585 (one executor per agent)"},
        {"topic": "Errors", "finding": "Any exception is re-raised as InterpreterError with the failing statement's source text, the exception type, and the message: \"Code execution failed at line '<statement>' due to: <Type>: <msg>\". The text has no numeric line number (P10).", "evidence": f"{GH}/{LPE}#L1653-L1663 (error wrap, message at #L1660)"},
        {"topic": "Parallelism", "finding": "No parallel tool calls on the CodeAgent path. The executor has no await branch in evaluate_ast (grep for ast.Await returns 0), and asyncio is not authorized. max_tool_threads exists only on ToolCallingAgent (agents.py#L1215-L1258, #L1426).", "evidence": f"{GH}/{LPE}#L1547 (import dispatch); `grep -c ast.Await` on the file returns 0; agents.py#L1426 (ThreadPoolExecutor for max_tool_threads, ToolCallingAgent)"},
    ],
    "surprises": [
        "The source sets a 30 s limit (MAX_EXECUTION_TIME_SECONDS) and the timeout error says so, but the caller only gets that error after the worker finishes. A 35 s sleep returned after 35.01 s with ExecutionTimeoutError (P6b).",
        "An infinite loop stops at 1.9 s from the 1M while-iteration cap, not from the 30 s limit (P6).",
        "No memory limit found: a 1 MB-per-append loop reached 4.12 GB peak RSS with no error (P7), and the harness stopped it there. Two earlier runs were stopped at 4.13 and 4.33 GB. A third run was SIGKILLed by the OS before the watchdog wrote anything, and I did not identify the cause.",
        "The class docstring says 'It is not a security sandbox'. The survey table lists the import allowlist and op-count cap as its controls, which is a weaker claim than the code makes.",
        "The escape attempts in P12 did not reach the host, including module-attribute routes (collections._sys.modules, queue.threading._os). Four shapes were tried, not all of them, so this does not prove there is no escape.",
        "The variable persistence question is settled: state persists across executions (P8). A print buffer does not persist.",
        "The 'concurrent' tool call is impossible in CodeAgent code: asyncio is blocked (P9b) and threading is not authorized. P9 ran 5 lookups in 1024 ms, which is serial.",
    ],
}

for n in result["source_notes"]:
    n["evidence"] = n["evidence"].replace("agents.py#L", GH + "/src/smolagents/agents.py#L").replace("utils.py#L", GH + "/src/smolagents/utils.py#L").replace(LPE + "#L", LPE + "#L")
    n["evidence"] = n["evidence"].replace(f"{GH}/{LPE}#L", f"{GH}/src/smolagents/local_python_executor.py#L").replace(f"{GH}/src/smolagents/{GH}", GH)

out = REPO / "research" / "probes" / "results" / "smolagents-local.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2) + "\n")
print(out)

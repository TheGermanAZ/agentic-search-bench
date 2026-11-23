"""Builds research/probes/results/codeact.json from out/*.json and the pinned source facts."""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
REL = "research/probes/codeact/out"
SHA = "d607f56c9cfe9e8632ebaf65dcaf2b4b7fe1c6f8"
GH = f"https://github.com/xingyaoww/code-act/blob/{SHA}"

probes = {}
for pid in ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"]:
    d = json.loads((HERE / "out" / f"{pid}.json").read_text())
    probes[pid] = {"outcome": d["outcome"], "detail": d["detail"], "evidence": f"{REL}/{pid}.txt"}
d = json.loads((HERE / "out" / "P9b.json").read_text())
probes["P9b"] = {"outcome": d["outcome"], "detail": d["detail"] + " (extra beyond SPEC)", "evidence": f"{REL}/P9b.txt"}

result = {
    "impl": "codeact",
    "name": "CodeAct (Wang et al., ICML 2024): mint PythonREPL, the agent environment's executor",
    "source": "https://github.com/xingyaoww/code-act (also ships a Jupyter-gateway chat engine under scripts/chat/code_execution/, not probed)",
    "pinned": f"commit {SHA} (default branch HEAD; last push 2024-05-23); ipython 9.18.1 (resolved; repo leaves it unpinned)",
    "language": "Python",
    "engine": "IPython InteractiveShell.run_cell() in the host process, with stdout captured through IPython.utils.io.capture_output. Not isolated.",
    "how_run": "PythonREPL(user_ns={'lookup': fn}) then repl(code) for each probe. This matches GeneralEnv.__init__ (general_env.py:66-70) and handle_tool_call (general_env.py:143). The default timeout is 30 s.",
    "probes": probes,
    "defaults": {
        "time": "30 s, via SIGALRM (python_tool.py:21, 28-38). Observed P6: returned after 30.03 s with a TimeoutError traceback.",
        "memory": "None found. P7 stopped by the harness at 4.14 GB peak RSS after 0.3 s, before the 30 s alarm.",
        "output": "2000 chars of captured stdout, then '...\\n[Output Truncated]' (python_tool.py:72-73). The return value is not separate: it appears only as IPython's Out line in stdout, so the cut can remove it.",
        "tool_calls": "None. lookup is an ordinary function in user_ns, and the executor counts nothing.",
    },
    "source_notes": [
        {"topic": "API shape", "finding": "GeneralEnv builds user_ns = {tool.name: tool.__call__} for every Tool in its tool set, then adds task.user_ns. Each tool is a plain Python callable in the IPython namespace. There is no generated stub and no schema-to-code step.", "evidence": f"{GH}/mint/envs/general_env.py#L66-L70"},
        {"topic": "Discovery", "finding": "The model sees every tool up front. get_toolset_description() writes each tool's signature and description into the prompt as 'Tool function available (already imported in <execute> environment)'. The env passes it into the prompt templates.", "evidence": f"{GH}/mint/tools/__init__.py#L8-L18; {GH}/mint/envs/general_env.py#L122, #L287"},
        {"topic": "Bridge", "finding": "No bridge. A tool call is a direct Python call in the same process, inside the IPython shell (P1, P9 with 5 host calls).", "evidence": f"{GH}/mint/envs/general_env.py#L138-L152 (handle_tool_call calls self.python_repl(env_input))"},
        {"topic": "Isolation boundary", "finding": "None in the executor. PythonREPL is commented 'This PythonREPL is not used by the environment; It is THE ENVIRONMENT' and has no restriction on imports, builtins or files. The NOT_USED signature shows the class is not a tool. The repo's only sandbox language is in mint/utils/exec.py, which is the human-eval correctness harness, and it tells users to sandbox it. The containerized engine is in the chat demo, not the agent environment.", "evidence": f"{GH}/mint/tools/python_tool.py#L10-L16; {GH}/mint/utils/exec.py#L52-L57; {GH}/README.md (containerized engine, chat UI); {GH}/scripts/chat/code_execution/jupyter.py#L239 (JupyterGatewayDocker)"},
        {"topic": "Output channel", "finding": "__call__ returns only the captured stdout. An empty output becomes '[Executed Successfully with No Output]'. The traceback path is redacted by regex. The expression value of the last line appears only as an Out line in stdout, so the 2000-char cut can remove it (P2).", "evidence": f"{GH}/mint/tools/python_tool.py#L49-L75 (__call__), #L59-L60 (empty output), #L66-L71 (path redaction), #L72-L73 (truncation)"},
        {"topic": "Limits", "finding": "Time: timeout=30 by default, enforced by SIGALRM inside time_limit. The shell turns the TimeoutError into text, so the caller gets a string back and no exception (P6). Memory: none. Tool calls: none. The SIGALRM handler needs the main thread (a signal.signal rule), which is inferred from the Python signal docs and not probed.", "evidence": f"{GH}/mint/tools/python_tool.py#L18-L38 (signature, default timeout 30, time_limit)"},
        {"topic": "State", "finding": "Persistent for one PythonREPL. reset() calls InteractiveShell.clear_instance() and makes a new shell from a copy of user_ns. GeneralEnv creates one PythonREPL in __init__ (general_env.py:68). The reset() method I read (general_env.py:274-300) does not call python_repl.reset(), so a new episode on the same env object may keep variables. That is inferred from the lines read, not probed (P8 persists in one object).", "evidence": f"{GH}/mint/tools/python_tool.py#L40-L47 (reset); {GH}/mint/envs/general_env.py#L68 (creation); #L274-L300 (reset, no python_repl call)"},
        {"topic": "Errors", "finding": "Exceptions are not raised to the caller. IPython prints a traceback into captured stdout, and the path is redacted. The message and the 'Cell In[1], line N' line both survive (P10). The outer try in handle_tool_call only catches errors from parse_action and the call itself.", "evidence": f"{GH}/mint/tools/python_tool.py#L49-L75; {GH}/mint/envs/general_env.py#L138-L152"},
        {"topic": "Approvals, credentials, PII", "finding": "None in the code. Anything in the host environment is readable (P5), and a shell command runs with the host's privileges (P12). The repo has no credential handling in this path.", "evidence": f"{GH}/mint/tools/python_tool.py (whole file)"},
    ],
    "surprises": [
        "The 2000-char cut removes the last expression, which is where the return value shows up. A probe that relies on a final-expression result can lose it silently (P2).",
        "The README describes a containerized code execution engine, and that is true for the chat demo. The agent environment that the paper's evaluations use runs PythonREPL in the host process with no container (python_tool.py#L10-L16, general_env.py#L68).",
        "The 30 s limit does work as documented: P6 returned at 30.03 s. It is a SIGALRM inside the shell, so a blocking C call would not be interrupted (not probed).",
        "The memory allocation loop reached 4.14 GB in 0.3 s, which was faster than the 30 s alarm. No memory limit exists below the process's own limits.",
        "The repo's last push was 2024-05-23, so the executor is pinned to an older IPython-era design. The unpinned ipython resolved to 9.18.1.",
    ],
}

out = REPO / "research" / "probes" / "results" / "codeact.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(result, indent=2) + "\n")
print(out)

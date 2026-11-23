SD = "research/impls/ms-agent-framework-hyperlight/pkg/agent_framework_hyperlight-1.0.0b261112"
T = f"{SD}/agent_framework_hyperlight/_execute_code_tool.py"
INS = f"{SD}/agent_framework_hyperlight/_instructions.py"
HL = "research/impls/ms-agent-framework-hyperlight/.venv-hl010/lib/python3.12/site-packages/hyperlight_sandbox/__init__.py"
P = "research/probes/ms-agent-framework-hyperlight"

IMPL = "ms-agent-framework-hyperlight"
NAME = "Microsoft Agent Framework CodeAct with Hyperlight (HyperlightExecuteCodeTool, alpha)"
SOURCE = ("PyPI agent-framework-hyperlight 1.0.0b261112 (sdist sha256 a8895150f63773127fc9d95395b2f368330eab34257ed81f0af96ae294395c54); "
          "blog https://devblogs.microsoft.com/agent-framework/codeact-with-hyperlight/ ; the listed repo github.com/microsoft/agent-framework returned 404 on 2026-11-22")
PINNED = ("agent-framework-hyperlight 1.0.0b261112, agent-framework-core 1.26.0, run with hyperlight-sandbox / -python-guest / -backend-wasm 0.10.0 "
          "(OUT OF PIN: the package requires hyperlight-sandbox <0.10, and 0.9.0 has no macOS backend). Guest: CPython 3.14.0 for WASI.")
LANGUAGE = "Python"
ENGINE = ("Hyperlight micro-VM through macOS Hypervisor.framework (the 0.10.0 _native_wasm .so links it), running a Wasm runtime that hosts "
          "CPython 3.14 compiled for WASI. One sandbox per tool config, snapshotted after warm-up and restored before every execution.")
HOW_RUN = ("HyperlightExecuteCodeTool(tools=[lookup], approval_mode='never_require').invoke(arguments={'code': ...}), the execute_code "
           "FunctionTool an Agent calls; guest code calls call_tool('lookup', id=...). Default include_detailed_errors=False; a second run "
           "with include_detailed_errors=True (out/diag-*) supplies the error text the default hides.")

OVERRIDES = {
    "P1": {"detail": "Printed 42 via call_tool(\"lookup\", id=21); 1 host-side call. The documented install (hyperlight-sandbox 0.9.0) failed on macOS with \"The selected Hyperlight backend is not installed or not supported on this platform\" (out/attempt-macos-documented.txt); Docker on this Mac has no /dev/kvm (out/attempt-linux-kvm.txt). All probes ran with the 0.10.0 macOS wheels (out/attempt-macos-hyperlight-0.10-override.txt).",
           "display": "works (42, 1 host call)"},
    "P2": {"outcome": "error",
           "detail": "The 200000-char print aborted the guest: \"Guest aborted: 8 panicked ... hyperlight-guest-bin-0.18.0 ... G2H response submission failed. Caused by: Backpressure\" (out/diag-P2.txt). invoke() raised RuntimeError(\"Code execution failed.\"), so nothing came back. 40000 chars printed fine and 50000 failed; the same tool recovered on the next call (out/diag-PX.txt). The last expression is never returned (_instructions.py tells the model to print).",
           "display": "error (print >40K chars aborts)"},
    "P3": {"detail": "Execution error. With details on: ModuleNotFoundError: No module named 'urllib'; socket is missing too (out/diag-P3.txt, diag-PX.txt). Outbound HTTP exists only through allowed_domains, empty by default.",
           "display": "blocked (no urllib/socket)"},
    "P4": {"detail": "Execution error. With details on: FileNotFoundError: [Errno 44] No such file or directory: '/etc/hosts'. The guest has no filesystem unless workspace_root or file_mounts is set; even listdir('/') fails.",
           "display": "blocked (no filesystem)"},
    "P5": {"detail": "os.environ is empty in the guest ({}), so ENV=None.", "display": "blocked (empty guest env)"},
    "P6": {"detail": "Stopped at 30.0 s: \"Code execution exceeded its time limit.\" A watchdog thread kills the guest through Sandbox.interrupt_handle().",
           "display": "limited (30 s)"},
    "P7": {"detail": "Guest aborted after 0.3 s: \"Guest aborted: 13 Out of physical memory\" (out/diag-P7.txt). 8 x 1 MB strings fit, 10 failed (out/P7-size.txt); hyperlight-sandbox's non-Windows default heap is 25Mi and the tool passes no heap_size. The host survived; the same tool and a fresh tool both ran print(1+1) afterwards.",
           "display": "limited (~8-10 MB guest data)"},
    "P8": {"detail": "Fresh: the warm snapshot is restored before every execution. Files written to /tmp do not exist either (out/diag-PX.txt).", "display": "fresh"},
    "P9": {"detail": "Loop of five call_tool took 1022 ms, 5 host calls. call_tool is synchronous; the guest has no asyncio or threading module (out/diag-PX.txt).",
           "display": "serial (1,022 ms)"},
    "P10": {"detail": "Default result: error content \"Execution error\" with error_details=None, so neither message nor line reaches the model. With include_detailed_errors=True: \"ValueError: probe-boom\", still no line number (out/diag-P10.txt).",
            "display": "no message (redacted by default)"},
    "P11": {"detail": "Per execution in one tool (snapshot restore + run): median 59.8 ms, p90 70.7 ms. New tool + first execution (sandbox boot + warm-up): median 272 ms, p90 289 ms.",
            "display": "median 59.8 ms"},
    "P12": {"detail": "Blocked. ().__class__.__base__.__subclasses__() works and finds os._wrap_close, but its globals have no 'system' (KeyError); os.system does not exist; subprocess is not importable (WASI CPython). No host marker was written.",
            "display": "blocked"},
}

HARDENED_CONFIG = (f"HyperlightExecuteCodeTool(execution_timeout_seconds=10), no workspace_root, file_mounts or allowed_domains, include_detailed_errors=False "
                   f"({T}:1709-1730). The defaults are already the strictest file, network and error settings; the tool exposes no heap_size option.")
HARDENED_OVERRIDES = {
    "P3": {"display": "blocked (no urllib/socket)"},
    "P4": {"display": "blocked (no filesystem)"},
    "P5": {"display": "blocked (empty guest env)"},
    "P6": {"display": "limited (10 s)"},
    "P7": {"detail": "Same guest abort (Out of physical memory) after 0.3 s; host survived and the tool ran again.", "display": "limited (~8-10 MB guest data)"},
    "P9": {"display": "serial (1,029 ms)"},
}

DEFAULTS = {
    "time": f"execution_timeout_seconds=30 ({T}:61), enforced by a watchdog thread calling Sandbox.interrupt_handle().kill() ({T}:116-154). Host tool callbacks are not interruptible (README).",
    "memory": f"No option in the tool. hyperlight-sandbox defaults heap_size to 25Mi on non-Windows ({HL}:22-29); measured: about 8-10 MB of guest strings before \"Out of physical memory\".",
    "output": f"stdout returned as text. No truncation marker; a print between 40 and 50 KB aborts the guest. Output files capped at 20 files / 5 MB each / 20 MB total ({T}:54-56).",
    "tool_calls": "No count limit; calls are synchronous and serial.",
}

SOURCE_NOTES = [
    {"topic": "API shape", "finding": "A single built-in call_tool(name, **kwargs) inside the guest; each registered FunctionTool becomes a host callback registered with sandbox.register_tool(name, callback). The execute_code description lists every tool with its parameters (compact or JSON Schema).",
     "evidence": f"{T}:1607-1612 ; {INS}:17-58 and :134-171"},
    {"topic": "Discovery", "finding": "All upfront: tool summaries are rendered into the execute_code tool description (or instructions via build_instructions). No search.",
     "evidence": f"{INS}:134-171"},
    {"topic": "Bridge", "finding": "Synchronous host callback through the Hyperlight FFI. Each callback runs the async FunctionTool.invoke on a fresh thread with asyncio.run and returns raw Python primitives to the guest. Host exceptions become \"Host tool execution failed.\" unless include_detailed_errors. Credentials stay in the host callback.",
     "evidence": f"{T}:1367-1401"},
    {"topic": "Isolation boundary", "finding": "Hyperlight micro-VM (hypervisor) plus a Wasm runtime with WASI CPython. No filesystem without mounts, no network without allowed_domains, empty environment. The blog says \"every execute_code call gets its own freshly created micro-VM\"; the code keeps one sandbox per tool configuration and restores a warm snapshot before each call, which gives fresh state but not a fresh VM.",
     "evidence": f"{T}:1580-1645 and :376-377 ; {P}/out/blog-quotes.md"},
    {"topic": "Output channel", "finding": "stdout as text content, then output files from /output if mounts exist, then stderr on success. On failure an error Content \"Execution error\" whose details are None unless include_detailed_errors=True. Some failures (guest abort) raise instead of returning content.",
     "evidence": f"{T}:1311-1364 and :2082-2085"},
    {"topic": "Limits", "finding": "Time: 30 s budget, interruptible. Memory: whatever hyperlight-sandbox defaults to (heap_size not passed). Output files: 20 / 5 MB / 20 MB. stdout: no documented cap, but large prints abort the guest.",
     "evidence": f"{T}:52-61 , :1589-1603 ; {HL}:22-29"},
    {"topic": "State", "finding": "Snapshot taken after warm-up and restored before every execution, so no state carries over.", "evidence": f"{T}:1624-1643 and :376-377"},
    {"topic": "Errors", "finding": "Redacted by default: the model sees \"Execution error\" with no message. include_detailed_errors=True exposes stderr (message without line numbers here).",
     "evidence": f"{T}:1356-1364 ; {SD}/README.md:22-37"},
    {"topic": "Anything else", "finding": "Platform: the package pins hyperlight-sandbox <0.10 and installs the Wasm backend only on Linux x86_64 and Windows AMD64; 0.10.0 (released two days after this beta) ships macOS arm64 wheels that run it through Hypervisor.framework. The README warns FIDES policy enforcement does not apply to tool calls made from inside code. Approval mode is configurable per tool.",
     "evidence": f"{SD}/pyproject.toml:27-29 ; {SD}/README.md:5-20 and :80-86 ; {P}/out/attempt-macos-hyperlight-0.10-override.txt"},
]

SURPRISES = [
    "It runs on Apple Silicon after all, but only outside the package's pin: hyperlight-sandbox 0.10.0 ships macOS arm64 wheels linked to Hypervisor.framework, while agent-framework-hyperlight requires <0.10 and its README lists only Linux x86_64 and Windows.",
    "The source repo named in the PyPI metadata (github.com/microsoft/agent-framework) returned HTTP 404 on 2026-11-22; source was read from the PyPI sdist.",
    "A print of about 50 KB or more crashes the guest (\"G2H ... Backpressure\") and the call raises RuntimeError(\"Code execution failed.\") with no hint that output size was the cause.",
    "The default memory budget is tiny: about 8-10 MB of user data before \"Out of physical memory\".",
    "Errors are redacted by default, so the model cannot see its own exception message (\"Execution error\", details None).",
    "The blog says each execute_code call gets a \"freshly created micro-VM\"; the code reuses one sandbox per configuration and restores a snapshot each call (fresh state, measured 60 ms per call, not a new VM).",
    "The guest CPython has no asyncio, threading, socket, subprocess or urllib, so tool calls are strictly serial.",
    "PyO3 prints \"WasmSandbox is unsendable, but is being dropped on another thread\" when the tool is garbage-collected without the internal registry close.",
]

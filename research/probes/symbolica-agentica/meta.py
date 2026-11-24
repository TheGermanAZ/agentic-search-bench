SRV = "https://github.com/symbolica-ai/agentica-server/blob/8db268f44ef8d09bd706b49e72e329348bb4b8b3"
SDK = "https://github.com/symbolica-ai/agentica-python-sdk/blob/1e64ecda69b6456530c9aabff476923893f41fe8"
LIB = f"{SRV}/src/sandbox/host/src/lib.rs"
SBX = f"{SRV}/src/sandbox/host/sandbox.py"
P = "research/probes/symbolica-agentica"
DOC = f"{P}/out/docs-how-it-works.md"

IMPL = "symbolica-agentica"
NAME = "Symbolica Agentica SDK (Warp RPC + sandboxed Python REPL)"
SOURCE = "https://docs.symbolica.ai/concepts/how-it-works ; https://github.com/symbolica-ai/agentica-server ; https://github.com/symbolica-ai/agentica-python-sdk (PyPI symbolica-agentica 0.4.1)"
PINNED = "agentica-server 8db268f44ef8d09bd706b49e72e329348bb4b8b3, agentica-python-sdk 1e64ecda69b6456530c9aabff476923893f41fe8, agentica-internal e5c1774 (all last committed 2026-02-13); not built or run"
LANGUAGE = "Python"
ENGINE = ("Source reading: CPython 3.12 compiled for WASI, run as a Wasm component in wasmtime 39 (Rust host loaded into the server via PyO3). "
          "Setting AGENTICA_NO_SANDBOX=1 swaps in an in-process Python runner instead.")
HOW_RUN = ("Not run. The sandbox is part of agentica-server, which runs locally with no Symbolica key, but `uv sync` builds it from source: "
           "setup.py runs build_guest.sh (wasi-sdk, CPython for WASI, msgspec, pydantic-core wasm) and build_host.sh (Rust/maturin wasmtime host). "
           "No prebuilt server is published. A Rust + WASI toolchain build was not run on this shared machine.")

NA = "Not run: the Wasm sandbox needs a local Rust + wasi-sdk + CPython-for-WASI build (agentica-server setup.py BuildPy); see how_run."


def na(extra="", display="not-applicable (not built)"):
    return {"outcome": "not-applicable", "detail": NA + (" " + extra if extra else ""), "display": display, "evidence": f"{SRV}/setup.py#L37-L50"}


OVERRIDES = {f"P{i}": na() for i in range(1, 13)}
OVERRIDES["P3"] = na("Source: the WasiCtxBuilder gets no network permission (wasmtime-wasi denies sockets by default).")
OVERRIDES["P4"] = na("Source: no preopened directories are given to the WASI context.")
OVERRIDES["P5"] = na("Source: no env vars are passed to the WASI context.")
OVERRIDES["P6"] = na("Source: the wasmtime Config enables neither fuel nor epoch interruption, and no execution timeout was found in the server's sandbox code.")
OVERRIDES["P7"] = na("Source: the Store has no ResourceLimiter, so the bound is wasm32's 4 GiB linear memory.")
OVERRIDES["P8"] = na("Docs: the REPL persists across turns of an agent invocation.")

HARDENED_CONFIG = None

DEFAULTS = {
    "time": "None found: wasmtime Config sets only async_support (lib.rs:189-190); no fuel or epoch deadline.",
    "memory": "None set: Store::new without a limiter (lib.rs:220-227); wasm32 caps linear memory at 4 GiB.",
    "output": "Value reprs truncated to 80 lines x 1000 chars with a \"[truncated, N ...]\" marker (guest/common.py:64-92).",
    "tool_calls": "Not determined from source.",
    "hardened": "null: not run, and no stricter sandbox option was found beyond the default Wasm mode.",
}

SOURCE_NOTES = [
    {"topic": "API shape", "finding": "Functions and objects passed in scope appear in the sandbox as stubs/proxies (\"Warp\"); return values are proxies by reference, not serialized. Async host functions appear as functions returning Future[T].",
     "evidence": f"{DOC} (overview and async functions)"},
    {"topic": "Discovery", "finding": "All upfront: the request to the model includes signatures and docstrings of every function and type in scope.", "evidence": f"{DOC} (\"What Happens Behind the Scenes\", step 1)"},
    {"topic": "Bridge", "finding": "RPC over two host imports into the Wasm component, send-bytes and recv-bytes (plus recv-ready, write-log); messages are msgspec-encoded Warp frames relayed to the SDK process, where the real functions run.",
     "evidence": f"{LIB}#L193-L203 ; {SBX}#L170-L200"},
    {"topic": "Isolation boundary", "finding": "wasmtime component with a default WasiCtxBuilder: no preopened dirs, no env, no inherited network; stdio inherited only in debug mode. The server can instead run guest code in-process when AGENTICA_NO_SANDBOX=1 (choose_mode).",
     "evidence": f"{LIB}#L210-L218 ; {SBX}#L145-L151 and #L765-L773"},
    {"topic": "Output channel", "finding": "REPL summary: output text, stdout, stderr/traceback, and the eval value; reprs truncated to 80 lines and 1000 chars per line with a visible marker.",
     "evidence": f"{SBX}#L681-L693 ; {SRV}/src/sandbox/guest/common.py#L64-L92"},
    {"topic": "Limits", "finding": "No fuel, no epoch interruption, no memory limiter in the wasmtime setup. A loop in guest code would run until the session is closed.",
     "evidence": f"{LIB}#L189-L227"},
    {"topic": "State", "finding": "Persistent REPL for the life of an agent; docs show multi-step sessions.", "evidence": f"{DOC} (\"sandboxed REPL environment\")"},
    {"topic": "Errors", "finding": "Traceback string returned as stderr of the REPL summary.", "evidence": f"{SBX}#L681-L693"},
    {"topic": "Anything else", "finding": "Hosted use needs AGENTICA_API_KEY; local use points the SDK at a self-run server via S_M_BASE_URL=http://localhost:2345 and needs an inference key (OpenRouter by default) for the server, not for the sandbox. Credentials of in-scope functions stay in the SDK process because calls are proxied.",
     "evidence": f"{SDK}/src/agentica/__main__.py#L496-L538 ; {SRV}/README.md"},
]

SURPRISES = [
    "The sandbox is fully open source and runs without a Symbolica key, but no prebuilt server exists: running it means building CPython for WASI, wasi-sdk, msgspec and a Rust wasmtime extension from source.",
    "An environment variable, AGENTICA_NO_SANDBOX=1, silently switches the server to running agent code in-process with no Wasm sandbox (sandbox.py:765-773).",
    "The wasmtime host sets no fuel, epoch deadline or memory limiter, so time and memory are unbounded inside the sandbox by design of the shown code (not measured).",
]

"""Datalayer agent-codemode adapter. A ToolRegistry with one stdio MCP server (lookup_server.py),
then CodeModeExecutor(registry, CodeModeConfig(sandbox_variant=VARIANT)).execute(code), the call
that the MCP server's execute_code handler and the pydantic-ai toolset both make."""
import os
import sys
import tempfile
import time
from pathlib import Path

from agent_codemode import CodeModeExecutor, MCPServerConfig, ToolRegistry
from agent_codemode.types import CodeModeConfig

HERE = Path(__file__).resolve().parent
VARIANT = os.environ.get("DL_VARIANT", "docker")
PRELUDE = "from generated.mcp.probe import lookup\n"
TRANSPORT = os.environ.get("DL_TRANSPORT", "stdio")
HTTP_PORT = int(os.environ.get("DL_HTTP_PORT", "41510"))
EXEC_TIMEOUT = 30.0  # what server.handle_execute_code and the toolset pass by default


def call(i):
    return f'await lookup({{"id": {i}}})'


def coro(i):
    return f'lookup({{"id": {i}}})'


def value(var):
    return f'{var}["value"]'


IMAGE = "datalayer-codemode-docker-jupyter:1.12.4"  # docker/Dockerfile of code-sandboxes v1.12.4, built locally
CONTAINER_PREFIX = "datalayer-codemode-docker-"


def default_docker_client(work):
    """What CodeModeExecutor.setup() builds for sandbox_variant="docker" (executor.py:239-258),
    plus a container_name so the shared-machine rules can find and remove the container."""
    from code_sandboxes import CodeSandboxClient, SandboxConfig

    cfg = SandboxConfig(timeout=30, working_dir=str(work / "workspace"), env_vars=dict(os.environ), gpu=None)
    return CodeSandboxClient.create(variant="docker", config=cfg, image=IMAGE,
                                    container_name=f"{CONTAINER_PREFIX}{os.getpid()}-{int(time.time() * 1000)}")


def hardened_client():
    from code_sandboxes import CodeSandboxClient, SandboxConfig

    cfg = SandboxConfig(timeout=EXEC_TIMEOUT, network_policy="none", env_vars={},
                        memory_limit=256 * 1024**2, cpu_limit=1.0)
    kwargs = {}
    if VARIANT == "monty":
        kwargs["limits"] = {"max_duration_secs": 10, "max_memory": 50_000_000}
    if VARIANT == "docker":
        kwargs.update(image=IMAGE, container_name=f"{CONTAINER_PREFIX}{os.getpid()}-{int(time.time() * 1000)}")
    return CodeSandboxClient.create(variant=VARIANT, config=cfg, **kwargs)


async def open_session(config):
    work = Path(tempfile.mkdtemp(prefix=f"dl-{VARIANT}-"))
    registry = ToolRegistry()
    if TRANSPORT == "http":
        registry.add_server(MCPServerConfig(name="probe", url=f"http://127.0.0.1:{HTTP_PORT}/mcp"))
    else:
        # env passes the call-log path explicitly: an MCP client spawned inside a kernel would
        # otherwise start the server with the MCP SDK's minimal default environment
        registry.add_server(MCPServerConfig(name="probe", command=sys.executable, args=[str(HERE / "lookup_server.py")],
                                            env={"PROBE_CALL_LOG": os.environ.get("PROBE_CALL_LOG", "")}))
    await registry.discover_all()
    cfg = CodeModeConfig(sandbox_variant=VARIANT, workspace_path=str(work / "workspace"),
                         generated_path=str(work / "generated"), skills_path=str(work / "skills"),
                         max_tool_calls=50 if config == "hardened" else None)
    (work / "workspace").mkdir()
    executor = CodeModeExecutor(registry, config=cfg,
                                sandbox_client=hardened_client() if config == "hardened" else default_docker_client(work))
    await executor.setup()
    return executor


async def close_session(executor):
    await executor.cleanup()


async def run(executor, code):
    ex = await executor.execute(code, timeout=EXEC_TIMEOUT)
    err = None
    if ex.code_error:
        err = f"{ex.code_error.name}: {ex.code_error.value}\n{ex.code_error.traceback}"
    if not ex.execution_ok:
        err = f"execution_error: {ex.execution_error}" + (f"\n{err}" if err else "")
    return {
        "ok": bool(ex.execution_ok and not ex.code_error),
        "stdout": ex.stdout,
        "stderr": ex.stderr,
        "result": ex.text,
        "error": err,
        "interrupted": getattr(ex, "interrupted", None),
    }

SHA = "8390985108cb1e3881f5f7297765758d8ad2540c"
GH = f"https://github.com/microsoft/autogen/blob/{SHA}/python/packages"
DK = f"{GH}/autogen-ext/src/autogen_ext/code_executors/docker/_docker_code_executor.py"
COMMON = f"{GH}/autogen-ext/src/autogen_ext/code_executors/_common.py"
P = "research/probes/autogen-docker"

IMPL = "autogen-docker"
NAME = "AutoGen DockerCommandLineCodeExecutor with functions"
SOURCE = "https://github.com/microsoft/autogen (PyPI autogen-ext[docker] 0.7.5)"
PINNED = f"autogen-ext 0.7.5 / autogen-core 0.7.5 / docker 7.2.0 (code_executors identical to {SHA}, repo archived); image python:3-slim pulled 2026-11-22; OrbStack Docker 29.8.2 arm64"
LANGUAGE = "Python"
ENGINE = ("CPython in a long-lived Docker container (default image python:3-slim) started once per executor; each code block runs as "
          "`timeout <t> python <file>` through docker exec, as root, on the default bridge network, with the work dir bind-mounted read-write at /workspace.")
HOW_RUN = ("DockerCommandLineCodeExecutor(container_name='autogen-docker-probe-<id>', work_dir=tmp, functions=[lookup]); start(); "
           "execute_code_blocks([CodeBlock(language='python', code=...)]). Guest code imports the tool with `from functions import lookup`.")

OVERRIDES = {
    "P1": {"detail": "Printed 42. 0 host-side calls: lookup's source is copied into functions.py in the bind-mounted work dir and runs inside the container (1 LOOKUP_CALL marker). There is no host bridge.",
           "display": "works (42; tool runs in container)"},
    "P2": {"detail": "All 200000 printed chars came back, no truncation marker. No return value: only the docker exec output text.",
           "display": "full (200,000 chars), no return"},
    "P3": {"detail": "urllib.request.urlopen(\"https://example.com\") returned 200. The container is created on Docker's default network and the constructor has no network option.",
           "display": "works (example.com 200)"},
    "P4": {"detail": "open(\"/etc/hosts\") read the container's own /etc/hosts, not the host's. A host file inside the repo (canary.txt) was not reachable (FileNotFoundError, out/PX.txt). Only the work dir is mounted, read-write.",
           "display": "blocked (container's own /etc/hosts)"},
    "P5": {"detail": "ENV=None. The container does not inherit the host environment.", "display": "blocked (ENV=None)"},
    "P6": {"detail": "Stopped at 60.1 s: exit_code=124 \"Timeout\" from the in-container `timeout 60` command. A guest child holding stdout did not extend it (P6-orphan in out/PX.txt returned at 60.1 s).",
           "display": "limited (60 s)"},
    "P7": {"detail": "No memory limit: containers.create sets none. Container cgroup memory reached 5.79 GB before the harness stopped it (polled every 0.5 s, so it overshot 4 GB). The ceiling would be the Docker VM (16.8 GB here). The host survived.",
           "display": "no-limit-within-120s (5.8 GB)"},
    "P8": {"detail": "Variables are fresh (new python process per block). Files persist in the bind-mounted /workspace: a file written by one execution was read by the next (out/PX.txt).",
           "display": "fresh (/workspace files persist)"},
    "P9": {"detail": "asyncio.gather over asyncio.to_thread(lookup) took 211 ms (parallel), 5 in-container calls, 0 host calls. A plain loop took 1021 ms.",
           "display": "parallel (211 ms, in-container)"},
    "P10": {"detail": "exit_code=1 and the full traceback: /workspace/tmp_code_<sha>.python, line 2, ValueError: probe-boom.",
            "display": "message + line (full traceback)"},
    "P11": {"detail": "Per execution (docker exec of a fresh python in the running container): median 58.0 ms, p90 97.3 ms. One-time setup 606 ms. A new executor per call costs about 10.8 s median; inferred cause: stopping the container on close.",
            "display": "median 58.0 ms"},
    "P12": {"detail": "Language-level escapes work inside the container: the __subclasses__ walk reached os._wrap_close globals and os.system ran (PWNED printed, uid 0). The command could not write the host marker path (\"Directory nonexistent\"), so the host was not reached. The container is the boundary.",
            "display": "blocked (container held; root inside)"},
}

HARDENED_CONFIG = ("DockerCommandLineCodeExecutor(timeout=10, delete_tmp_files=True). The constructor exposes no memory, CPU, network or read-only options "
                   "(_docker_code_executor.py:158-181); container creation passes none (:537-550).")
HARDENED_OVERRIDES = {
    "P3": {"detail": "Still 200: no option disables networking.", "display": "works (example.com 200)"},
    "P4": {"display": "blocked (container's own /etc/hosts)"},
    "P6": {"display": "limited (10 s)"},
    "P7": {"detail": "No memory option. Container memory reached 4.37 GB before the harness stopped it; host survived.", "display": "no-limit-within-120s (4.4 GB)"},
    "P9": {"display": "parallel (209 ms, in-container)"},
    "P12": {"display": "blocked (container held; root inside)"},
}

DEFAULTS = {
    "time": "timeout=60 s per block (:163), enforced inside the container by `timeout <t> python <file>` (:360); exit code 124 adds \"Timeout\" (:303-305).",
    "memory": "None set on the container (:537-550). Bounded only by the Docker VM.",
    "output": "None. docker exec output, uncapped (:301-306).",
    "tool_calls": "No cap and no host bridge: functions run inside the container.",
}

SOURCE_NOTES = [
    {"topic": "API shape", "finding": "Same as the local executor: function source is copied into functions.py in the work dir and imported by guest code; stubs (signature + docstring) for the prompt come from to_stub().",
     "evidence": f"{COMMON}#L52-L92 ; {DK}#L254-L285"},
    {"topic": "Discovery", "finding": "All upfront through format_functions_for_prompt(), which the application must add to the prompt itself.", "evidence": f"{COMMON}#L70-L92"},
    {"topic": "Bridge", "finding": "None. Tools execute in the container, so credentials a tool needs must be placed inside the container (image, extra_volumes, or code) where model-written code can read them.",
     "evidence": f"{COMMON}#L52-L67"},
    {"topic": "Isolation boundary", "finding": "A Docker container. It runs as the image's user (root in python:3-slim), on the default network, with the work dir bind-mounted rw at /workspace plus any extra_volumes. No memory, CPU, pids, network or read-only-rootfs settings are passed.",
     "evidence": f"{DK}#L537-L550"},
    {"topic": "Output channel", "finding": "Decoded docker exec output only (stdout and stderr together); exit code 124 appends \"Timeout\". No cap.", "evidence": f"{DK}#L292-L306"},
    {"topic": "Limits", "finding": "Only the timeout. Cancellation runs `pkill -f <command>` inside the container.", "evidence": f"{DK}#L163 , #L287-L290 , #L360"},
    {"topic": "State", "finding": "One container per executor; each block is a new python process. /workspace persists, and delete_tmp_files defaults to False, so every generated code file stays in the host work dir.",
     "evidence": f"{DK}#L82 and #L368-L374"},
    {"topic": "Errors", "finding": "Raw traceback text and the exit code.", "evidence": f"{DK}#L292-L306"},
    {"topic": "Anything else", "finding": "A container with the same name is force-removed before start. The image is pulled automatically if missing. The repo is archived.",
     "evidence": f"{DK}#L517-L535"},
]

SURPRISES = [
    "The recommended \"secure\" executor leaves the network on and sets no memory limit, and the constructor offers no option to change either; the hardened run differs from default only in the timeout.",
    "The guest runs as root in the container and the host work dir is mounted read-write, so guest code can plant files the host application later reads.",
    "`functions` copies source into the container rather than bridging to the host, so tools that need host credentials cannot be used without moving the credentials into the sandbox.",
    "A new executor costs about 10.8 s (median of 20) (inferred cause: container stop on close, not measured separately); per-execution cost in a running container is 58 ms.",
]

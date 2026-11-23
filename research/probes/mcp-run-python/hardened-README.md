## Wave-2 hardened run

The only public limit knob is `allow_networking=False` (main.py:188-190 omits `--allow-net`; CLI `--disable-networking`, _cli.py:27). There is no time, memory, output or tool-call option. So only P3 changes from defaults; everything else is rerun identically to confirm.

Rerun (P6 takes 120 s; P7 must hold the mem lock):

    ../../impls/mcp-run-python/.venv/bin/python hardened-run_probes.py P1 P3 P4 P5 P9 P12 P12x
    ../../impls/mcp-run-python/.venv/bin/python hardened-run_probes.py P6
    ../mem-lock.sh ../../impls/mcp-run-python/.venv/bin/python hardened-run_probes.py P7

Outputs: `out/hardened-P*.txt` (and `out/hardened-P*.log` / `*.server.log`). P1 is the hardened sanity check (print(21*2) -> 42 with no --allow-net); it is not added to the JSON. P12x is an extra: it verifies the hardened net knob cannot run either HTTP mode (the server needs --allow-net to bind) and reads the cross-client shared-realm fact from source. Ports used: 41880, 41881 (P12x HTTP bind test only).

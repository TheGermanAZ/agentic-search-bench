"""Checks source claims the SPEC probes do not cover. Writes out/extras.txt.

Usage: PROBE_SECRET=s3cr3t extras.py
"""

import asyncio
import json
import time

import harness
from harness import build, run, tid


async def main():
    results = {}

    hardened = build("hardened")
    t0 = time.perf_counter()
    r = await run(hardened, 'for (let i = 1; i <= 8; i++) await tools.lookup({id: i}); "eight serial calls done"', tid())
    r["wall_ms"] = round((time.perf_counter() - t0) * 1000, 1)
    results["hardened_timeout_1s_vs_8_serial_200ms_host_calls"] = r

    results["hardened_ptc_budget_9_calls"] = await run(
        hardened, "for (let i = 1; i <= 9; i++) await tools.lookup({id: i}); 'unreachable'", tid()
    )

    default = build("default")
    thread = tid()
    results["default_after_timeout_same_thread"] = [
        await run(default, "globalThis.before = 1; while (true) {}", thread),
        await run(default, "typeof before + ' / ' + (1 + 1)", thread),
    ]

    snap_thread = tid()
    sizes = []
    for code in ["globalThis.kept = 7", "kept + 1", "kept + 2"]:
        step = await run(default, code, snap_thread)
        state = (await default.aget_state({"configurable": {"thread_id": snap_thread}})).values
        sizes.append({
            "code": code,
            "turn_ms": step["turn_ms"],
            "eval_ms": step["eval_ms"],
            "stored_snapshot_payload_bytes": len(state.get("_quickjs_snapshot_payload") or b""),
        })
    results["default_thread_mode_snapshot_per_turn"] = sizes

    results["default_line_numbers_leading_paren"] = await run(
        default, '(function () { throw new Error("paren-boom"); })()', tid()
    )
    results["default_task_global_without_task_tool"] = await run(
        default, 'await task({description: "x", subagentType: "y"})', tid()
    )

    host_before_ms = time.time() * 1000
    clock = await run(default, "Date.now()", tid())
    clock["host_epoch_ms_before_turn"] = round(host_before_ms)
    clock["guest_minus_host_ms"] = round(float(clock["output"][8:-9]) - host_before_ms)
    results["default_date_now_vs_host_clock"] = clock

    text = json.dumps(results, indent=1, ensure_ascii=False)
    (harness.OUT / "extras.txt").write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    asyncio.run(main())

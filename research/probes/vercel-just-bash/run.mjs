// Driver: runs every probe in its own Node process, enforces the stop rules, writes out/ and out/summary.json.
// Usage: node run.mjs [P1 P2 ...]   (no args runs P1 to P12)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "out");
const WORKER = join(here, "probe.mjs");
const STOP_MS = 120_000;
const RSS_LIMIT_KB = 4 * 1024 * 1024;
const SECRET = "s3cr3t";
const ALL = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10", "P11", "P12"];
// Variants that sharpen a row: P6b raises the counters to see the deadline, P1js and P9js use js-exec with invokeTool, P12js is js-exec.
const EXTRA = ["P6b", "P6c", "P1js", "P9js", "P12js", "P2b", "P10b", "P10js"];

function peakRssKb(pid) {
  try {
    return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) || 0;
  } catch {
    return 0;
  }
}

function runWorker(id) {
  return new Promise((resolve) => {
    const started = performance.now();
    const child = spawn(process.execPath, [WORKER, id], {
      env: { ...process.env, PROBE_SECRET: SECRET },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let peak = 0;
    let killed = null;
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const sampler = setInterval(() => {
      const rss = peakRssKb(child.pid);
      peak = Math.max(peak, rss);
      if (rss > RSS_LIMIT_KB && !killed) {
        killed = "rss-4GB";
        child.kill("SIGKILL");
      }
    }, 100);
    const timer = setTimeout(() => {
      if (!killed) killed = "time-120s";
      child.kill("SIGKILL");
    }, STOP_MS);
    child.on("close", (code, signal) => {
      clearInterval(sampler);
      clearTimeout(timer);
      let parsed = null;
      try {
        parsed = JSON.parse(stdout.trim().split("\n").pop());
      } catch {
        parsed = null;
      }
      resolve({
        id,
        parsed,
        stderr,
        exitCode: code,
        signal,
        killed,
        wallMs: Math.round(performance.now() - started),
        peakRssKb: peak,
      });
    });
  });
}

function fmtRun(r) {
  return [
    `script: ${r.script}`,
    `exit: ${r.exitCode}`,
    `stdout (${r.stdout.length} chars):`,
    r.stdout.length > 600 ? `${r.stdout.slice(0, 300)}\n...[${r.stdout.length - 600} chars elided by this report]...\n${r.stdout.slice(-300)}` : r.stdout,
    `stderr:`,
    r.stderr,
    `ms: ${r.ms}, host lookup calls so far: ${r.hostCalls}`,
    "",
  ].join("\n");
}

function writeProbeText(id, result, extra) {
  const lines = [`probe: ${id}`, `worker exit: ${result.exitCode} signal: ${result.signal} killed: ${result.killed}`, `wall ms: ${result.wallMs}`, `peak host RSS KB: ${result.peakRssKb}`, ""];
  if (result.parsed?.runs) for (const r of result.parsed.runs) lines.push(fmtRun(r));
  if (result.parsed && !result.parsed.runs) lines.push(JSON.stringify(result.parsed, null, 2));
  if (!result.parsed) lines.push(`no parsed output; worker stderr:\n${result.stderr}`);
  if (extra) lines.push(extra);
  writeFileSync(join(OUT, `${id}.txt`), `${lines.join("\n")}\n`);
}

const LIMIT_RE = /too many (commands executed|iterations)/;

const find = (runs, label) => runs.find((r) => r.label === label) ?? runs[0];

// Each classifier turns a raw worker result into the spec outcome word and a short detail.
const CLASSIFY = {
  P1(res) {
    const r = res.parsed.runs[0];
    const ok = r.exitCode === 0 && r.stdout.trim() === "42";
    return { outcome: ok ? "works" : "error", detail: `printed ${r.stdout.trim()}, ${r.hostCalls} host call${r.hostCalls === 1 ? "" : "s"}` };
  },
  P2(res) {
    const r = res.parsed.runs[0];
    const aCount = (r.stdout.match(/A/g) ?? []).length;
    const returned = r.stdout.trimEnd().endsWith("RETURNED");
    return {
      outcome: aCount >= 200000 && returned ? "works" : "error",
      detail: `printed output only: ${aCount} A chars came back, the final RETURNED line came back via echo, exit ${r.exitCode}. Shells have no expression return value, so there is no separate return channel. No truncation marker in ${r.stdout.length} chars.`,
    };
  },
  P3(res) {
    const direct = res.parsed.runs[0];
    const allow = res.parsed.runs[1];
    const notDefined = direct.exitCode === 127 && /command not found/.test(direct.stderr);
    return {
      outcome: notDefined ? "not-defined" : "error",
      detail: `default sandbox: "${direct.stderr.trim()}" (exit ${direct.exitCode}); curl is registered only when network is configured. With an allowlist of https://example.com only: exit ${allow.exitCode}, first bytes "${allow.stdout.slice(0, 40).replace(/\s+/g, " ")}".`,
    };
  },
  P4(res) {
    const r = res.parsed.runs[0];
    const blocked = r.exitCode !== 0 && /No such file or directory/.test(r.stderr);
    return {
      outcome: blocked ? "blocked" : "error",
      detail: `cat /etc/hosts: "${r.stderr.trim()}" (exit ${r.exitCode}); ls /etc shows only the virtual tree.`,
    };
  },
  P5(res) {
    const r = res.parsed.runs[0];
    const value = r.stdout.trim();
    const leaked = value.includes(SECRET);
    return {
      outcome: leaked ? "works" : "blocked",
      detail: `echo "[\$PROBE_SECRET]" printed "${value}" with PROBE_SECRET=${SECRET} set on the host. ${leaked ? "LEAK" : "host env not visible"}.`,
    };
  },
  P6(res) {
    const r = res.parsed?.runs?.[0];
    if (res.killed === "time-120s") {
      return { outcome: "no-limit-within-120s", detail: "killed by driver at 120 s" };
    }
    const stopped = r && r.exitCode !== 0 && LIMIT_RE.test(r.stderr);
    return {
      outcome: stopped ? "limited" : "error",
      detail: `stopped after ${r?.ms} ms (driver wall ${res.wallMs} ms): "${r?.stderr.trim()}" exit ${r?.exitCode}`,
    };
  },
  P7(res) {
    const r = res.parsed?.runs?.[0];
    if (res.killed === "rss-4GB" || res.killed === "time-120s") {
      return { outcome: res.killed === "rss-4GB" ? "limited" : "no-limit-within-120s", detail: `driver kill: ${res.killed}, peak RSS ${res.peakRssKb} KB` };
    }
    const stopped = r && r.exitCode !== 0 && /limit exceeded/.test(r.stderr);
    return {
      outcome: stopped ? "limited" : "error",
      detail: `stopped after ${r?.ms} ms, peak host RSS ${res.parsed.peakRssKb} KB (worker maxRSS): "${r?.stderr.trim()}" exit ${r?.exitCode}`,
    };
  },
  P8(res) {
    const second = res.parsed.runs.find((r) => r.label === "exec 2: echo ${kept:-gone}");
    const persisted = second.stdout.trim() === "7";
    const file = res.parsed.runs.find((r) => r.label === "exec 2b: read file");
    const cwd = res.parsed.runs.find((r) => r.label === "exec 2c: pwd");
    return {
      outcome: persisted ? "persists" : "fresh",
      detail: `variable: exec 2 printed "${second.stdout.trim()}". Side effects: file written in exec 1 read back as "${file.stdout.trim()}"; cd in exec 1 gives pwd "${cwd.stdout.trim()}" in exec 2.`,
    };
  },
  P9(res) {
    const r = res.parsed.runs[0];
    const serial = res.parsed.maxInFlight <= 1;
    return {
      outcome: r.exitCode === 0 ? "works" : "error",
      detail: `${r.ms} ms host-side for 5 lookups (each sleeps 200 ms), ${r.hostCalls} host calls, max in flight ${res.parsed.maxInFlight}, ${serial ? "serial" : "parallel"}, stdout "${r.stdout.trim().replace(/\n/g, " | ")}"`,
    };
  },
  P1js(res) {
    const r = res.parsed.runs[0];
    const ok = r.exitCode === 0 && r.stdout.trim() === "42";
    return { outcome: ok ? "works" : "error", detail: `js-exec + invokeTool printed ${r.stdout.trim()}, ${r.hostCalls} host call${r.hostCalls === 1 ? "" : "s"}, ${r.ms} ms` };
  },
  P6c(res) {
    const r = res.parsed?.runs?.[0];
    const stopped = r && r.exitCode !== 0 && LIMIT_RE.test(r.stderr);
    return { outcome: stopped ? "limited" : "error", detail: `with only maxCommandCount raised, the loop stopped after ${r?.ms} ms on the loop limit: "${r?.stderr.trim()}" exit ${r?.exitCode}` };
  },
  P6b(res) {
    const r = res.parsed?.runs?.[0];
    if (res.killed === "time-120s") {
      return { outcome: "no-limit-within-120s", detail: "with maxCommandCount and maxLoopIterations raised to 1e9, the loop was still running at 120 s when the driver killed it" };
    }
    return { outcome: "limited", detail: `stopped after ${r?.ms} ms: "${r?.stderr.trim()}"` };
  },
  P9js(res) {
    const r = res.parsed.runs[0];
    return { outcome: r.exitCode === 0 ? "works" : "error", detail: `js-exec Promise.all over 5 tools.lookup calls: in-guest Date.now() delta printed ${r.stdout.trim()}, host-side elapsed ${r.ms} ms, ${r.hostCalls} host calls, max in flight ${res.parsed.maxInFlight}` };
  },
  P12js(res) {
    const runs = res.parsed.runs;
    const hostPid = String(res.parsed.host.pid);
    const leaked = runs.some((r) => r.stdout.includes("s3cr3t") || r.stdout.includes(hostPid) || r.stdout.includes("inner-child-host"));
    const summary = runs.map((r) => `exit ${r.exitCode} "${(r.stdout || r.stderr).trim().slice(0, 90)}"`).join(" | ");
    return { outcome: leaked ? "escaped" : "blocked", detail: `${leaked ? "host value seen" : "no host value seen"}: ${summary}` };
  },
  P2b(res) {
    const r = res.parsed.runs[0];
    const hasEnd = r.stdout.trimEnd().endsWith("END");
    const marker = /limit|exceeded/.test(r.stderr);
    return {
      outcome: marker ? "limited" : "error",
      detail: `printf 5 x 60 MB (300 MB total stdout): stdout ${r.stdout.length} chars came back, END ${hasEnd ? "present" : "absent"}, exit ${r.exitCode}, stderr "${r.stderr.trim()}". Partial stdout is kept on the limit path (Bash.ts:963-969).`,
    };
  },
  P10b(res) {
    const r = res.parsed.runs[0];
    if (r.threw) {
      return { outcome: "error", detail: `exec() rejected with "${r.threw}"; stack head: ${r.stackHead}` };
    }
    const kept = /probe-boom/.test(r.stderr);
    return {
      outcome: kept ? "works" : "error",
      detail: `host command threw Error("probe-boom"): exec resolved, exit ${r.exitCode}, stderr "${r.stderr.trim()}", stdout "${r.stdout.trim()}"`,
    };
  },
  P10js(res) {
    const [thrown, afterLog] = res.parsed.runs;
    const kept = /probe-boom/.test(thrown.stderr) && /probe-boom/.test(afterLog.stderr);
    return {
      outcome: kept ? "works" : "error",
      detail: `js-exec uncaught throw: exit ${thrown.exitCode}, stderr "${thrown.stderr.trim().split("\n").slice(0, 2).join(" | ")}". With console.log before the throw: stdout "${afterLog.stdout.trim()}", stderr "${afterLog.stderr.trim().split("\n").slice(0, 2).join(" | ")}"`,
    };
  },
  P10(res) {
    const [unknown, exit7, syntax] = res.parsed.runs;
    return {
      outcome: unknown.exitCode === 127 ? "works" : "error",
      detail: `unknown command: exit ${unknown.exitCode}, stderr "${unknown.stderr.trim()}". exit 7: exit ${exit7.exitCode}, stderr "${exit7.stderr.trim()}". syntax error: exit ${syntax.exitCode}, stderr "${syntax.stderr.trim()}". The caller gets text and exit code. No stack trace.`,
    };
  },
  P11(res) {
    const s = res.parsed.sameInstance;
    const f = res.parsed.freshInstance;
    return {
      outcome: s.allOutputs2 && f.allOutputs2 ? "works" : "error",
      detail: `one-time setup (import + new Bash) ${res.parsed.setupMs} ms. Same instance, exec "echo 2" x20: median ${s.median.toFixed(2)} ms, p90 ${s.p90.toFixed(2)} ms. New Bash per exec x20: median ${f.median.toFixed(2)} ms, p90 ${f.p90.toFixed(2)} ms.`,
    };
  },
  P12(res) {
    const runs = res.parsed.runs;
    const hostPid = String(res.parsed.host.pid);
    const reached = runs.some((r) => r.stdout.includes("PWNED") || r.stdout.includes(hostPid));
    const summary = runs.map((r) => `${r.script} -> exit ${r.exitCode} "${(r.stdout || r.stderr).trim().slice(0, 60)}"`).join("; ");
    return {
      outcome: reached ? "escaped" : "blocked",
      detail: `${reached ? "host reached" : "no attempt reached the host runtime"}. Attempts: ${summary}`,
    };
  },
};

mkdirSync(OUT, { recursive: true });
// Keeps JSON evidence small: long stdout or stderr is replaced by its length and head and tail.
function shrink(value) {
  if (Array.isArray(value)) return value.map(shrink);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if ((k === "stdout" || k === "stderr") && typeof v === "string" && v.length > 1000) {
        out[k] = { chars: v.length, head: v.slice(0, 300), tail: v.slice(-300) };
      } else out[k] = shrink(v);
    }
    return out;
  }
  return value;
}

const requested = process.argv.slice(2);
const ids = requested.length ? requested : [...ALL, ...EXTRA];
const summary = {};
for (const id of ids) {
  const res = await runWorker(id);
  if (!res.parsed) {
    summary[id] = {
      outcome: res.killed === "time-120s" ? "no-limit-within-120s" : res.killed ? "limited" : "error",
      detail: `driver kill: ${res.killed ?? "none"}; wall ${res.wallMs} ms; peak host RSS ${res.peakRssKb} KB; worker stderr: ${res.stderr.trim().slice(0, 200) || "(none)"}`,
    };
  } else {
    const { outcome, detail } = CLASSIFY[id](res);
    summary[id] = { outcome, detail };
  }
  writeProbeText(id, res, `outcome: ${summary[id].outcome}\ndetail: ${summary[id].detail}`);
  writeFileSync(join(OUT, `${id}.json`), `${JSON.stringify({ worker: { exitCode: res.exitCode, signal: res.signal, killed: res.killed, wallMs: res.wallMs, peakRssKb: res.peakRssKb }, parsed: shrink(res.parsed) }, null, 2)}\n`);
  console.log(`${id}\t${summary[id].outcome}\t${summary[id].detail.slice(0, 160)}`);
}
writeFileSync(join(OUT, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

// Shared host side of the Python engines: one long-lived Python sidecar (py/sidecar.py) per engine, speaking JSON
// lines. Guest code runs in Monty worker subprocesses that the sidecar's pool owns, never in the sidecar itself.
// Each execution gets a fresh Monty session in its own worker process; the sidecar is pooled because a Python start
// costs about 50 ms (pydantic-monty alone) to 500 ms (FastMCP and Pydantic AI imports), against under 1 ms for a
// pre-spawned Monty worker (research/probes/engines/PY-ENGINES.md).
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Corpus } from "../search";
import { LIMITS, OutputBuffer, callCorpus, cleanError, slot, wallClockMessage } from "./host";

export type SidecarMode = "monty" | "fastmcp" | "pydantic-ai";

type FromPy =
  | { t: "ready"; versions: Record<string, string>; pid: number }
  | { t: "call"; id: number; c: number; name: string; args: string }
  | { t: "out"; id: number; text: string }
  | { t: "done"; id: number; value?: string; error?: string; dropped: number };

type Pending = {
  /** The sidecar process running this execution. */
  proc: ChildProcess;
  /** The model already has its result (the program ended or hit the wall clock); later corpus calls are refused. */
  done: boolean;
  corpus: Corpus;
  out: OutputBuffer;
  /** Resolves the model-facing text; later calls are ignored. */
  finish: (tail: string) => void;
  /** Releases the concurrency slot once the sidecar confirms the execution is gone. */
  settle: () => void;
};

const PY_DIR = join(import.meta.dirname, "..", "..", "py");
/**
 * How long a cancelled execution may take to confirm. After that its sidecar is retired: new executions go to a fresh
 * sidecar, and the old one is killed once every other execution on it has ended (see retire()).
 */
const CANCEL_GRACE_MS = 3000;
/** First start may run `uv sync`, which downloads wheels. */
const START_TIMEOUT_MS = 180_000;

export class PySidecar {
  private proc?: ChildProcess;
  private starting?: Promise<void>;
  private pending = new Map<number, Pending>();
  /** Sidecars that take no new executions and are killed once nothing still running depends on them. */
  private retired = new Set<ChildProcess>();
  private nextId = 1;
  /** Last 8 KB of the sidecar's stderr (FastMCP logs masked errors there). */
  stderrTail = "";
  versions: Record<string, string> = {};
  /** Sidecar processes started, for tests: more than one means a crash or a forced respawn. */
  spawns = 0;
  /** The Python process id (inside the `uv run` wrapper), for tests. */
  pid?: number;

  constructor(private readonly mode: SidecarMode) {}

  private start(): Promise<void> {
    this.starting ??= new Promise<void>((resolve, reject) => {
      this.spawns++;
      // A minimal environment: no API keys or other host secrets reach the sidecar or its workers.
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: process.env.HOME ?? "/tmp",
        TMPDIR: process.env.TMPDIR ?? "/tmp",
        UV_NO_PROGRESS: "1",
        ASB_MAX_CONCURRENT: String(LIMITS.maxConcurrent),
        ASB_MEMORY_BYTES: String(LIMITS.memoryBytes),
        ASB_CPU_SECS: String(LIMITS.cpuMs / 1000),
        ASB_MAX_OUTPUT: String(LIMITS.maxOutput),
        DO_NOT_TRACK: "1",
      };
      if (process.env.UV_CACHE_DIR) env.UV_CACHE_DIR = process.env.UV_CACHE_DIR;
      const proc = spawn("uv", ["run", "--quiet", "--frozen", "--project", PY_DIR, "python", "-I", join(PY_DIR, "sidecar.py"), this.mode], {
        cwd: PY_DIR,
        env,
        stdio: ["pipe", "pipe", "pipe"],
        // Its own process group, so a hard kill takes the Monty workers with it.
        detached: true,
      });
      this.proc = proc;
      const timer = setTimeout(() => fail(new Error(`python sidecar (${this.mode}) did not start within ${START_TIMEOUT_MS / 1000} s`)), START_TIMEOUT_MS);
      const fail = (e: Error) => {
        clearTimeout(timer);
        this.kill(proc);
        reject(e);
      };
      proc.on("error", (e) => fail(e));
      proc.stdin!.on("error", () => {}); // EPIPE after a crash is handled by the exit handler
      proc.stderr!.on("data", (b: Buffer) => {
        this.stderrTail = (this.stderrTail + b.toString()).slice(-8000);
      });
      createInterface({ input: proc.stdout!, crlfDelay: Infinity }).on("line", (line) => {
        let msg: FromPy;
        try {
          msg = JSON.parse(line) as FromPy;
        } catch {
          return;
        }
        if (msg.t === "ready") {
          clearTimeout(timer);
          this.versions = msg.versions;
          this.pid = msg.pid;
          this.idle();
          resolve();
        } else this.onMessage(msg);
      });
      proc.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (this.proc === proc) {
          this.proc = undefined;
          this.starting = undefined;
        }
        this.retired.delete(proc);
        reject(new Error(`python sidecar exited (code ${code}, signal ${signal}): ${cleanError(this.stderrTail.trim().split("\n").at(-1) ?? "")}`));
        // Monty workers outlive a killed sidecar until their own limits fire; take down the rest of its group.
        this.kill(proc);
        // Every execution still on this process fails now; the next run starts a new sidecar.
        for (const [id, p] of this.pending) {
          if (p.proc !== proc) continue;
          p.finish(`ERROR: the sandbox stopped this program (python sidecar exited${signal ? ` on ${signal}` : ""})`);
          p.settle();
          this.pending.delete(id);
        }
      });
    }).catch((e: unknown) => {
      this.starting = undefined;
      throw e;
    });
    return this.starting;
  }

  /** Keeps Node alive only while executions are in flight, so an idle sidecar never holds the host open. */
  private idle() {
    const p = this.proc;
    if (!p) return;
    const busy = this.pending.size > 0;
    for (const h of [p, p.stdin, p.stdout, p.stderr] as unknown as { ref?: () => void; unref?: () => void }[]) (busy ? h?.ref : h?.unref)?.call(h);
  }

  private send(proc: ChildProcess, msg: object) {
    proc.stdin?.write(`${JSON.stringify(msg)}\n`);
  }

  private onMessage(msg: FromPy) {
    if (msg.t === "ready") return;
    const p = this.pending.get(msg.id);
    if (!p) return;
    if (msg.t === "out") p.out.push(msg.text);
    else if (msg.t === "call") {
      // A program already stopped by the wall clock gets no more host work; its task is being cancelled.
      if (p.done) {
        this.send(p.proc, { t: "result", id: msg.id, c: msg.c, json: JSON.stringify({ __error: "the program was stopped" }) });
        return;
      }
      void callCorpus(p.corpus, msg.name, msg.args).then((json) => {
        if (this.pending.get(msg.id) === p) this.send(p.proc, { t: "result", id: msg.id, c: msg.c, json });
      });
    } else if (msg.t === "done") {
      this.pending.delete(msg.id);
      p.out.noteDropped(msg.dropped);
      p.finish(msg.error !== undefined ? `ERROR: ${msg.error}` : (msg.value ?? ""));
      p.settle();
      this.idle();
      this.reap(p.proc);
    }
  }

  /**
   * Stops sending new executions to a sidecar whose execution ignored a cancel. Killing it at once would fail every
   * other execution on it, so it is killed only when all of them have a result (each has its own wall clock).
   */
  private retire(proc: ChildProcess) {
    if (this.proc === proc) {
      this.proc = undefined;
      this.starting = undefined;
    }
    this.retired.add(proc);
    this.reap(proc);
  }

  private reap(proc: ChildProcess) {
    if (!this.retired.has(proc)) return;
    for (const p of this.pending.values()) if (p.proc === proc && !p.done) return;
    this.kill(proc);
  }

  private kill(proc: ChildProcess) {
    try {
      if (proc.pid) process.kill(-proc.pid, "SIGKILL");
    } catch {
      proc.kill("SIGKILL");
    }
  }

  async run(code: string, corpus: Corpus): Promise<string> {
    const release = await slot();
    try {
      await this.start();
      // The sidecar was retired while this run waited for it: start a fresh one.
      if (!this.proc) await this.start();
    } catch (e) {
      release();
      return `ERROR: the Python sandbox could not start: ${cleanError(e)}`;
    }
    const proc = this.proc;
    if (!proc) {
      release();
      return "ERROR: the sandbox stopped this program (python sidecar exited)";
    }
    const id = this.nextId++;
    const out = new OutputBuffer();
    return new Promise<string>((resolve) => {
      let settled = false;
      let killTimer: NodeJS.Timeout | undefined;
      const entry: Pending = {
        proc,
        corpus,
        out,
        done: false,
        finish: (tail) => {
          if (entry.done) return;
          entry.done = true;
          clearTimeout(wallTimer);
          resolve(out.finish(tail));
        },
        settle: () => {
          if (settled) return;
          settled = true;
          clearTimeout(killTimer);
          release();
        },
      };
      // Timer callbacks run before pending I/O in each event-loop turn, so after any stall a reply already sitting in
      // the pipe would lose to an expired timer. setImmediate runs after that I/O, so the timers decide only on what
      // really has not arrived.
      const wallTimer = setTimeout(
        () =>
          setImmediate(() => {
            if (entry.done) return;
            entry.finish(wallClockMessage());
            // Cancelling the execution's task makes Monty kill its worker process. If the sidecar does not confirm
            // in time, retire it: it takes no new executions and is killed once the others on it have ended.
            this.send(proc, { t: "cancel", id });
            killTimer = setTimeout(
              () =>
                setImmediate(() => {
                  if (!settled) this.retire(proc);
                }),
              CANCEL_GRACE_MS,
            );
          }),
        LIMITS.wallMs,
      );
      this.pending.set(id, entry);
      this.idle();
      this.send(proc, { t: "run", id, code });
    });
  }

  async close(): Promise<void> {
    for (const r of this.retired) this.kill(r);
    const p = this.proc;
    if (!p) return;
    this.proc = undefined;
    this.starting = undefined;
    p.stdin?.end();
    await new Promise<void>((r) => {
      const t = setTimeout(() => {
        this.kill(p);
        r();
      }, 2000);
      p.once("exit", () => {
        clearTimeout(t);
        r();
      });
    });
  }
}

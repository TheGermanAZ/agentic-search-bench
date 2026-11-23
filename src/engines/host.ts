// The host side every engine shares: the corpus functions a program may call, the limits, error scrubbing,
// output capping and the concurrency cap. Engines differ only in how they run the guest.
import type { Corpus } from "../search";

export const LIMITS = {
  /** Guest CPU time, enforced by the engine inside the sandbox. */
  cpuMs: 60_000,
  /** Whole program including corpus calls, enforced on the host by killing the execution. */
  wallMs: 65_000,
  /** Memory per execution, enforced by the engine or the OS, never by trusting a counter in the guest. */
  memoryBytes: 512 * 1024 * 1024,
  /** Characters of printed output that reach the model. */
  maxOutput: 8000,
  /** Executions running at once in this process. */
  maxConcurrent: Number(process.env.SANDBOX_MAX_CONCURRENT ?? 8),
} as const;

/** The six corpus functions, positional args as in CORPUS_API. A Map, so a guest cannot name an inherited property. */
export const CORPUS_FUNCTIONS = new Map<string, (c: Corpus, a: unknown[]) => unknown>([
  ["search", (c, a) => c.search(a[0] as string, (a[1] ?? {}) as Parameters<Corpus["search"]>[1])],
  ["grep", (c, a) => c.grep(a[0] as string, (a[1] ?? {}) as Parameters<Corpus["grep"]>[1])],
  ["messages", (c, a) => c.messages((a[0] ?? {}) as Parameters<Corpus["messages"]>[0])],
  ["count", (c, a) => c.count((a[0] ?? {}) as Parameters<Corpus["count"]>[0])],
  ["people", (c, a) => c.people(a[0] as string)],
  ["read", (c, a) => c.read(a[0] as string)],
]);
export const CORPUS_NAMES = [...CORPUS_FUNCTIONS.keys()];

/** Host errors reach the model as one short line, with URLs (which can carry credentials) and file paths removed. */
export const cleanError = (e: unknown): string =>
  (String((e as Error)?.message ?? e).split("\n")[0] ?? "")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/(?:\/[\w.@+-]+){2,}/g, "<path>")
    .slice(0, 300) || "host call failed";

/**
 * Runs one corpus call for a guest. Takes and returns JSON text so every engine crosses the boundary the same way.
 * Errors come back as {"__error": "..."} for the guest-side stub to throw.
 */
export async function callCorpus(corpus: Corpus, name: string, argsJson: string): Promise<string> {
  try {
    const fn = CORPUS_FUNCTIONS.get(name);
    if (!fn) throw new Error(`unknown corpus function ${name}`);
    const args = JSON.parse(argsJson) as unknown;
    if (!Array.isArray(args)) throw new Error("arguments must be a JSON array");
    return JSON.stringify((await fn(corpus, args)) ?? null);
  } catch (err) {
    return JSON.stringify({ __error: cleanError(err) });
  }
}

/** Collects printed output up to the cap as it arrives, so a log flood cannot grow host memory. */
export class OutputBuffer {
  private text = "";
  private dropped = 0;
  push(chunk: string): void {
    const room = LIMITS.maxOutput - this.text.length;
    if (chunk.length > room) this.dropped += chunk.length - Math.max(room, 0);
    if (room > 0) this.text += chunk.slice(0, room);
  }
  noteDropped(n: number): void {
    this.dropped += n;
  }
  /**
   * The text the model sees, with a truncation marker when anything was dropped. The tail (a final value or an
   * error) is capped too: it gets whatever room the printed output left, and at least 1,000 chars for errors.
   */
  finish(tail = ""): string {
    const room = Math.max(LIMITS.maxOutput - this.text.length, 1000);
    if (tail.length > room) {
      this.dropped += tail.length - room;
      tail = tail.slice(0, room);
    }
    const marker = this.dropped > 0 ? `[output truncated: ${this.dropped} more chars. Print less.]\n` : "";
    return `${this.text}${marker}${tail}`.trim() || "(no output; print results to see them)";
  }
}

export const wallClockMessage = () => `ERROR: stopped at the ${LIMITS.wallMs / 1000} s limit for the whole program, including corpus calls. Do less per execution.`;

let running = 0;
const queue: (() => void)[] = [];
/** Waits for one of LIMITS.maxConcurrent slots; call the returned function to release it. */
export async function slot(): Promise<() => void> {
  if (running >= LIMITS.maxConcurrent) await new Promise<void>((r) => queue.push(r));
  running++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    running--;
    queue.shift()?.();
  };
}

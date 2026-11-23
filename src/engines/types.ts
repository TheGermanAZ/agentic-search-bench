import type { Corpus } from "../search";

/**
 * A code-mode engine: runs one model-written program against the corpus API and returns the text the model sees.
 * Every engine follows the same contract (src/engines/host.ts) so they can be compared fairly:
 * - only the six corpus functions are reachable, dispatched on the host through callCorpus();
 * - LIMITS: guest CPU, whole-program wall clock, per-execution memory, output cap with a marker, concurrency cap;
 * - fresh state for every execution; host errors scrubbed with cleanError();
 * - a runaway program must not block the host's event loop or another execution.
 */
export type Engine = {
  name: string;
  language: "javascript" | "python";
  /** One line for reports: what runs the code and where. */
  description: string;
  /** The API reference shown to the model, in the engine's language. */
  apiDoc: string;
  /** The system-prompt paragraph that introduces the execute tool. */
  guide: string;
  run(code: string, corpus: Corpus): Promise<string>;
  /** Releases pools, subprocesses or servers. Optional. */
  close?(): Promise<void>;
};

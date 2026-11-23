// py-monty: pydantic-monty 1.6.0 directly. A Python sidecar owns an AsyncMonty worker pool; every execution runs in a
// fresh Monty session on a fresh worker process with max_memory and max_feed_duration_secs set from LIMITS. The six
// corpus functions are async external functions whose calls cross to Node over JSON lines; print() streams back.
import { PY_API_POSITIONAL, MONTY_HOW, pyGuide } from "./py-api";
import { PySidecar } from "./py-sidecar";
import type { Engine } from "./types";

const sidecar = new PySidecar("monty");

export const engine: Engine = {
  name: "py-monty",
  language: "python",
  description: "Monty (pydantic-monty 1.6.0, Rust Python-subset interpreter) in a fresh pooled worker process per execution, driven by a Python sidecar; async bridge",
  apiDoc: PY_API_POSITIONAL,
  guide: pyGuide(PY_API_POSITIONAL, MONTY_HOW),
  run: (code, corpus) => sidecar.run(code, corpus),
  close: () => sidecar.close(),
};
export const _sidecar = sidecar;

// Engine registry. Each engine module exports `engine: Engine`; modules load lazily so a missing optional
// dependency (a Python environment, a native add-on) only matters when that engine is used.
import type { Engine } from "./types";

export const ENGINES: Record<string, () => Promise<{ engine: Engine }>> = {
  "quickjs-asyncify": () => import("./quickjs-asyncify"),
  "vercel-run": () => import("./vercel-run"),
  "quickjs-ng": () => import("./quickjs-ng"),
  "isolated-vm": () => import("./isolated-vm"),
  "py-monty": () => import("./py-monty"),
  "py-fastmcp": () => import("./py-fastmcp"),
  "py-pydantic-ai": () => import("./py-pydantic-ai"),
};
export const DEFAULT_ENGINE = "vercel-run";

const loaded = new Map<string, Promise<Engine>>();
export function getEngine(name = process.env.CODEMODE_ENGINE ?? DEFAULT_ENGINE): Promise<Engine> {
  const load = ENGINES[name];
  if (!load) throw new Error(`unknown engine ${name}; known: ${Object.keys(ENGINES).join(", ")}`);
  let p = loaded.get(name);
  if (!p) {
    p = load().then((m) => m.engine);
    loaded.set(name, p);
  }
  return p;
}

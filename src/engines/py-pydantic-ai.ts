// py-pydantic-ai: Pydantic AI Harness 0.71.0 CodeModeToolset (run_code over Monty 1.6.0), called without an agent.
// Per execution the Python sidecar builds a RunContext and ToolManager the way the agent graph does and sends one
// run_code call through ToolManager.handle_call; no model is ever called. The six corpus functions are FunctionToolset
// tools that forward to Node. The harness type-checks the snippet (ty), keyword-only calls, 100 calls per run_code.
import { PY_API_KEYWORD, PYDANTIC_AI_HOW, pyGuide } from "./py-api";
import { PySidecar } from "./py-sidecar";
import type { Engine } from "./types";

const sidecar = new PySidecar("pydantic-ai");

export const engine: Engine = {
  name: "py-pydantic-ai",
  language: "python",
  description: "Pydantic AI Harness 0.71.0 CodeModeToolset run_code (Monty 1.6.0, fresh pool per execution, ty type check) without an agent, in a Python sidecar; keyword-only async bridge",
  apiDoc: PY_API_KEYWORD,
  guide: pyGuide(PY_API_KEYWORD, PYDANTIC_AI_HOW),
  run: (code, corpus) => sidecar.run(code, corpus),
  close: () => sidecar.close(),
};
export const _sidecar = sidecar;

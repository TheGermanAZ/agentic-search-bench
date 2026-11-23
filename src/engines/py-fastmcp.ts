// py-fastmcp: FastMCP 4.2.4's CodeMode transform as shipped. Per execution the Python sidecar builds a FastMCP server
// (mask_error_details=True) whose six tools forward to Node, adds CodeMode (MontySandboxProvider with LIMITS), and
// calls its `execute` tool through an in-process FastMCP client. The program sees only call_tool(name, params);
// only the returned value comes back (CodeMode sends print() to the host's stdout, which the sidecar discards).
import { FASTMCP_HOW, PY_API_CALL_TOOL, pyGuide } from "./py-api";
import { PySidecar } from "./py-sidecar";
import type { Engine } from "./types";

const sidecar = new PySidecar("fastmcp");

export const engine: Engine = {
  name: "py-fastmcp",
  language: "python",
  description: "FastMCP 4.2.4 CodeMode execute tool (Monty 1.6.0 worker per execution) on an in-process FastMCP server in a Python sidecar; call_tool bridge, return value only, errors masked",
  apiDoc: PY_API_CALL_TOOL,
  guide: pyGuide(PY_API_CALL_TOOL, FASTMCP_HOW),
  run: (code, corpus) => sidecar.run(code, corpus),
  close: () => sidecar.close(),
};
export const _sidecar = sidecar;

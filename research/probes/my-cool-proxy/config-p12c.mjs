// Does a write through a proxied tool result reach the gateway's Object.prototype (host realm), and persist across executions?
export * from "./config.mjs";
import { probes as base } from "./config.mjs";
const pre = `local r = probe.lookup({id = 1}):await()\n`;
export const probes = { ...base, P12: [
  pre + `result(tostring(r.probePolluted))`,
  pre + `r.__proto__.probePolluted = "written-by-guest-lua"\nresult("set")`,
  pre + `result(tostring(r.probePolluted))`,
  `result(tostring(_gateway.probePolluted))`,
  pre + `r.__proto__.probePolluted = nil\nresult(tostring(r.probePolluted))`,
] };

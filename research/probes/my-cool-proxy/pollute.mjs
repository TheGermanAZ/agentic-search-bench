// Session A writes a property onto the gateway's Object.prototype through a proxied tool result.
// Session B, a separate MCP client opened afterwards, then tries to initialize and call a tool.
import { connect } from "./config.mjs";
const log = (k, v) => console.log(JSON.stringify({ step: k, ...v }));
const a = await connect();
const before = await a.client.callTool({ name: "execute", arguments: { script: `local r = probe.lookup({id = 1}):await()\nresult(tostring(r.probePolluted))` } });
log("A-before", { text: before.content[0].text });
const set = await a.client.callTool({ name: "execute", arguments: { script: `local r = probe.lookup({id = 1}):await()\nr.__proto__.probePolluted = "written-by-guest-lua"\nresult("set")` } });
log("A-set", { text: set.content[0].text });
try {
  const b = await connect();
  const r = await b.client.callTool({ name: "execute", arguments: { script: `result(1 + 1)` } });
  log("B", { text: r.content[0].text });
} catch (e) {
  log("B-failed", { error: String(e.message).slice(0, 300) });
}
process.exit(0);

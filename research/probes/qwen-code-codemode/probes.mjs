// Fixed probe sources (SPEC.md), written for Qwen Code's exec runtime.
// Differences from the SPEC's JS form, because of this runtime: there is no console, so printed output is text(...);
// a bare last expression is not returned (the program body is wrapped in an async function), so P2 also tries `return`;
// MCP tool results arrive as {callId, name, status, output: string}, so P1 parses output.
const L = "tools.mcp__probe__lookup";
export const probes = {
  P1: [
    `const r = await ${L}({id: 21}); text(JSON.parse(r.output).value)`,
    `const r = await ${L}({id: 21}); console.log(JSON.parse(r.output).value)`,
  ],
  P2: [
    `text("A".repeat(200000)); "RETURNED"`,
    `text("A".repeat(200000)); return "RETURNED"`,
    `text("A".repeat(20000)); return "RETURNED"`,
    `text("B".repeat(10)); text("RETURNED")`,
  ],
  P3: [
    `const r = await fetch("https://example.com"); text(r.status)`,
    `text([typeof fetch, typeof XMLHttpRequest, typeof WebSocket].join(","))`,
    `const r = await tools.web_fetch({url: "https://example.com", prompt: "Return the page title verbatim."}); text(r.output.slice(0, 600))`,
  ],
  P4: [
    `text(require("fs").readFileSync("/etc/hosts", "utf8"))`,
    `const fs = await import("fs"); text(fs.readFileSync("/etc/hosts", "utf8"))`,
    `text(await Deno.readTextFile("/etc/hosts"))`,
    `const r = await tools.read_file({file_path: "/etc/hosts"}); text(r.output.slice(0, 400))`,
  ],
  P5: [
    `text(process.env.PROBE_SECRET)`,
    `text(typeof process + "," + Object.getOwnPropertyNames(globalThis).join(","))`,
  ],
  P6: [`while (true) {}`],
  P6b: [`await new Promise((r) => setTimeout(r, 1e9)); text("woke")`],
  P6c: [`let n = 0; const t = Date.now(); while (true) { await ${L}({id: 1}); n++; if (n % 50 === 0) text(n + " calls, " + (Date.now() - t) + " ms"); }`],
  P7: [`const a = []; while (true) a.push("x".repeat(1e6))`],
  P7after: [`text(1 + 1)`],
  P8: [`globalThis.kept = 7; text("set")`, `text(typeof kept === "undefined" ? "gone" : kept)`],
  P9: [`const t = Date.now(); const rs = await Promise.all([1,2,3,4,5].map(i => ${L}({id: i}))); text(Date.now() - t); text(rs.map(r => JSON.parse(r.output).value).join(","))`],
  P10: [
    `throw new Error("probe-boom")`,
    `const x = 1;\nconst y = 2;\nfunction inner() { throw new Error("probe-boom"); }\ninner();`,
    `const r = await ${L}({id: "not-a-number"}); text(r.output)`,
    `await tools.no_such_tool({})`,
  ],
  P11: { repeat: 20, source: `1 + 1` },
  P12: [
    `text(String(this.constructor.constructor("return process")()))`,
    `text(String((function(){ return this })().process))`,
    `text(String(${L}.constructor.constructor("return typeof process + ',' + typeof require + ',' + typeof globalThis.__callTool")()))`,
    `text(String(setTimeout.constructor.constructor("return typeof process")()))`,
    `text(String(typeof eval) + "," + eval("typeof process"))`,
    `text(JSON.stringify([typeof WebAssembly, typeof Atomics, typeof SharedArrayBuffer, typeof __callTool, typeof __appendText, typeof std, typeof os]))`,
  ],
};

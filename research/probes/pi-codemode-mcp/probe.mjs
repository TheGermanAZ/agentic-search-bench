// Usage: HOME=<probe>/home node probe.mjs <default|hardened> <P1..P12|P6b>
// Loads the extension with jiti as Pi's extension loader does
// (@mariozechner/pi-coding-agent dist/core/extensions/loader.js:192-200), passes a minimal ExtensionAPI,
// fires session_start, then calls the registered `call_mcp` tool's execute(). No LLM.
import { readFileSync, rmSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repo = fileURLToPath(new URL("../../impls/pi-codemode-mcp/repo/", import.meta.url));
const require = createRequire(`${repo}package.json`);
const { createJiti } = require("@mariozechner/jiti");

const [config, probe] = process.argv.slice(2);
const OPTIONS = { default: {}, hardened: { timeoutMs: 1000 } };
const countFile = `${here}out/.lookup-count-${process.pid}`;
process.env.LOOKUP_COUNT_FILE = countFile;
process.env.PROBE_SECRET = "s3cr3t";
process.argv.push("--mcp-config", `${here}mcp.json`);

const tools = new Map();
const handlers = new Map();
const pi = {
	registerTool: (t) => tools.set(t.name, t),
	registerFlag: () => {},
	registerCommand: () => {},
	getFlag: () => undefined,
	on: (event, fn) => handlers.set(event, fn),
};
const jiti = createJiti(`${repo}package.json`, { moduleCache: false });
const factory = await jiti.import(`${repo}src/index.ts`, { default: true });
factory(pi);
await handlers.get("session_start")({}, { hasUI: false });

const hostCalls = () => (existsSync(countFile) ? readFileSync(countFile, "utf8").trim().split("\n").filter(Boolean).length : 0);

async function run(code, extra = {}) {
	const t = performance.now();
	try {
		const res = await tools.get("call_mcp").execute("probe", { code, ...OPTIONS[config], ...extra }, undefined, undefined);
		const text = res.content.map((c) => c.text).join("\n");
		return { code, ms: Math.round(performance.now() - t), hostCalls: hostCalls(), isError: !!res.isError, textChars: text.length, text: text.length > 1500 ? `${text.slice(0, 700)} ...[${text.length} chars]... ${text.slice(-700)}` : text };
	} catch (e) {
		return { code, ms: Math.round(performance.now() - t), threw: String(e?.stack ?? e) };
	}
}

const PROBES = {
	P1: async () => [await run(`const r = await call("host", "lookup", {id: 21}); console.log(r.structuredContent.value)`)],
	P2: async () => [await run(`console.log("A".repeat(200000)); "RETURNED"`), await run(`console.log("A".repeat(200000)); return "RETURNED"`)],
	P3: async () => [await run(`const r = await fetch("https://example.com"); return r.status`), await run(`return [typeof fetch, typeof require, typeof process, typeof Buffer, typeof setTimeout].join("/")`)],
	P3b: async () => [await run(`const hostFetch = Buffer.constructor.constructor("return fetch")(); const r = await hostFetch("https://example.com"); return r.status + " " + (await r.text()).length + " bytes"`)],
	P4: async () => [
		await run(`return require("fs").readFileSync("/etc/hosts","utf8")`),
		await run(`const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")`),
		await run(`return await Deno.readTextFile("/etc/hosts")`),
		await run(`const p = Buffer.constructor.constructor("return process")(); return p.getBuiltinModule("fs").readFileSync("/etc/hosts","utf8").slice(0, 200)`),
	],
	P5: async () => [await run(`return process.env.PROBE_SECRET`), await run(`return Buffer.constructor.constructor("return process")().env.PROBE_SECRET`)],
	P6: async () => [await run(`while (true) {}`)],
	P6b: async () => [await run(`await null; while (true) {}`)],
	P7: async () => [await run(`const a = []; while (true) a.push("x".repeat(1e6))`), await run(`return "alive"`)],
	P8: async () => [await run(`globalThis.kept = 7; state.keptInState = 7; return "set"`), await run(`console.log(typeof kept === "undefined" ? "gone" : kept); return state.keptInState`)],
	P9: async () => [await run(`const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => call("host", "lookup", {id:i}))); console.log(Date.now()-t)`)],
	P10: async () => [await run(`throw new Error("probe-boom")`), await run(`const x = 1;\nconst y = 2;\nthrow new Error("probe-boom")`)],
	P11: async () => {
		const times = [];
		for (let i = 0; i < 20; i++) {
			const t = performance.now();
			const r = await run(`return 1+1`);
			times.push(performance.now() - t);
			if (r.isError || !r.text.includes('"result": 2')) throw new Error(`bad result ${r.text}`);
		}
		const s = [...times].sort((a, b) => a - b);
		return [{ timesMs: times.map((x) => +x.toFixed(2)), medianMs: +((s[9] + s[10]) / 2).toFixed(2), p90Ms: +s[17].toFixed(2) }];
	},
	P12: async () => {
		globalThis.__HOST_CANARY = "host-canary";
		return [
			await run(`return String(this.constructor.constructor("return process")())`),
			await run(`return String((function(){return this})().process)`),
			await run(`const p = Buffer.constructor.constructor("return process")(); return p.getBuiltinModule("child_process").execSync("echo PWNED").toString()`),
			await run(`const p = console.log.constructor.constructor("return process")(); return [p.pid === ${process.pid}, typeof p.getBuiltinModule].join("/")`),
			await run(`return call.constructor.constructor("return globalThis.__HOST_CANARY")()`),
		];
	},
};

const setupStart = performance.now();
await run(`await call("host", "lookup", {id: 0}); return 1`);
const firstExecMs = +(performance.now() - setupStart).toFixed(2);
rmSync(countFile, { force: true });
const results = await PROBES[probe]();
const hostCallLog = existsSync(countFile) ? readFileSync(countFile, "utf8").trim().split("\n") : [];
console.log(JSON.stringify({ impl: "pi-codemode-mcp", config, probe, options: OPTIONS[config], warmupExecIncludingServerSpawnMs: firstExecMs, hostCalls: hostCalls(), hostCallLog, results }, null, 2));
rmSync(countFile, { force: true });
await handlers.get("session_shutdown")?.();
process.exit(0);

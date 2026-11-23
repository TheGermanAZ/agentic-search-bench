// Usage: node probe.mjs <default|hardened|agent> <P1..P12>
// Prints one JSON object describing the probe run to stdout.
const { CodemodeSandbox } = await import(
	new URL("../../../../impls/pi-codemode/npm/node_modules/@earendil-works/pi-codemode/dist/index.js", import.meta.url).href
);

const [config, probe] = process.argv.slice(2);

// default: package defaults. hardened: documented public options at their strictest documented values.
// agent: the options Pi's coding agent passes (packages/coding-agent/src/extensions/codemode/execute.ts:584-593).
const CONFIGS = {
	default: {},
	hardened: { timeoutMs: 30_000, memoryLimitBytes: 32 * 1024 * 1024 },
	agent: { timeoutMs: Number.POSITIVE_INFINITY, memoryLimitBytes: 256 * 1024 * 1024 },
};

let hostCalls = 0;
const lookup = {
	name: "lookup",
	description: "Look up a value",
	inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
	execute: async (args) => {
		hostCalls++;
		await new Promise((r) => setTimeout(r, 200));
		return { id: args.id, value: args.id * 2 };
	},
};

const make = () => new CodemodeSandbox({ tools: [lookup], ...CONFIGS[config] });

function summarize(result) {
	const out = {
		ok: result.ok,
		output: result.output.map((o) => (o.type === "text" ? { ...o, text: o.text.length > 300 ? `${o.text.slice(0, 300)}...[${o.text.length} chars]` : o.text } : o)),
		outputTextChars: result.output.filter((o) => o.type === "text").reduce((n, o) => n + o.text.length, 0),
		calls: result.calls?.map((c) => ({ name: c.name, status: c.status })),
	};
	if (result.ok) out.value = result.value;
	else out.error = result.error;
	return out;
}

async function run(code, sandbox = make()) {
	const t = performance.now();
	try {
		const result = await sandbox.execute(code);
		return { code, ms: Math.round(performance.now() - t), hostCalls, ...summarize(result) };
	} catch (e) {
		return { code, ms: Math.round(performance.now() - t), threw: String(e?.stack ?? e) };
	} finally {
		await sandbox.close();
	}
}

const PROBES = {
	P1: async () => [await run(`const r = await tools.lookup({id: 21}); console.log(r.value)`)],
	P2: async () => [
		await run(`console.log("A".repeat(200000)); "RETURNED"`),
		await run(`console.log("A".repeat(200000)); return "RETURNED"`),
	],
	P3: async () => [await run(`await fetch("https://example.com")`), await run(`return typeof fetch + "/" + typeof XMLHttpRequest + "/" + typeof WebSocket`)],
	P4: async () => [
		await run(`return require("fs").readFileSync("/etc/hosts","utf8")`),
		await run(`const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")`),
		await run(`return await Deno.readTextFile("/etc/hosts")`),
	],
	P5: async () => [await run(`return process.env.PROBE_SECRET`), await run(`return typeof process + "/" + JSON.stringify(Object.getOwnPropertyNames(globalThis))`)],
	P6: async () => [await run(`while (true) {}`)],
	P6b: async () => [await run(`while (true) await null`), await run(`await null; while (true) {}`)],
	P7: async () => [await run(`const a = []; while (true) a.push("x".repeat(1e6))`), await run(`return "alive"`)],
	P8: async () => {
		const sandbox = make();
		const a = await sandbox.execute(`globalThis.kept = 7`);
		const b = await sandbox.execute(`console.log(typeof kept === "undefined" ? "gone" : kept)`);
		await sandbox.close();
		return [{ step: 1, ...summarize(a) }, { step: 2, ...summarize(b) }];
	},
	P9: async () => [await run(`const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id:i}))); console.log(Date.now()-t)`)],
	P10: async () => [await run(`throw new Error("probe-boom")`), await run(`const x = 1;\nconst y = 2;\nthrow new Error("probe-boom")`)],
	P11: async () => {
		const t0 = performance.now();
		const first = make();
		await first.execute(`1+1`);
		await first.close();
		const setupMs = performance.now() - t0;
		const times = [];
		for (let i = 0; i < 20; i++) {
			const s = make();
			const t = performance.now();
			const r = await s.execute(`return 1+1`);
			times.push(performance.now() - t);
			await s.close();
			if (!r.ok || r.value !== 2) throw new Error("bad result");
		}
		const sorted = [...times].sort((a, b) => a - b);
		return [{ firstExecutionIncludingWasmCompileMs: +setupMs.toFixed(2), timesMs: times.map((t) => +t.toFixed(2)), medianMs: +((sorted[9] + sorted[10]) / 2).toFixed(2), p90Ms: +sorted[17].toFixed(2) }];
	},
	P12: async () => {
		globalThis.__HOST_CANARY = "host-canary";
		return [
			await run(`return this.constructor.constructor("return process")()`),
			await run(`return (function(){return this})().process`),
			await run(`return typeof (function(){return this})().__HOST_CANARY`),
			await run(`return Function("return typeof process + '/' + typeof require + '/' + typeof WebAssembly + '/' + typeof globalThis.__HOST_CANARY")()`),
			await run(`return tools.lookup.constructor.constructor("return typeof process")()`),
		];
	},
};

process.env.PROBE_SECRET = "s3cr3t";
const results = await PROBES[probe]();
console.log(JSON.stringify({ impl: "pi-codemode", config, probe, options: CONFIGS[config], hostCalls, results }, null, 2));
process.exit(0);

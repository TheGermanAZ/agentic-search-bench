// Isolates the P7 finding: same library versions Qwen Code 0.28.4 pins (packages/core/package.json:113,164),
// same calls as host.ts:208-211, then asks QuickJS what it thinks its limit and usage are.
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";
const quickjs = await newQuickJSWASMModuleFromVariant(variant);
const rt = quickjs.newRuntime();
rt.setMemoryLimit(64 * 1024 * 1024);
rt.setMaxStackSize(1024 * 1024);
const vm = rt.newContext();
const src = process.argv[2] ?? 'globalThis.a = []; for (let i = 0; i < 200; i++) a.push("x".repeat(1e6) + i); a.length';
const r = vm.evalCode(src);
console.log("result:", r.error ? vm.dump(r.error) : vm.dump(r.value));
r.error ? r.error.dispose() : r.value.dispose();
console.log(rt.dumpMemoryUsage().split("\n").slice(0, 6).join("\n"));
console.log("process RSS MB:", Math.round(process.memoryUsage().rss / 1048576));

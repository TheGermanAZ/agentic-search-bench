import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const qe = require("quickjs-emscripten");
const which = process.argv[2];
const variant = which === "ng" ? require("@jitl/quickjs-ng-wasmfile-release-sync").default : qe.RELEASE_ASYNC;
const mod = which === "ng" ? await qe.newQuickJSWASMModuleFromVariant(variant) : await qe.newQuickJSAsyncWASMModuleFromVariant(variant);
const rt = mod.newRuntime();
rt.setMemoryLimit(64 * 1024 * 1024);
const vm = rt.newContext();
rt.setInterruptHandler(qe.shouldInterruptAfterDeadline(Date.now() + 8000));
const t = Date.now();
let r;
try {
  r = vm.evalCode(`const a = []; let i = 0; try { while (true) { a.push("x".repeat(1e6) + i); i++; } } catch (e) { "caught " + e + " after " + i + " MB" }`);
  console.log(which, "result", r.error ? vm.dump(r.error) : vm.dump(r.value));
} catch (e) { console.log(which, "host threw", String(e).slice(0, 200)); }
console.log(which, "ms", Date.now() - t, "rss MB", Math.round(process.memoryUsage().rss / 2**20), "usage:", rt.computeMemoryUsage ? "" : "");
try { console.log(rt.dumpMemoryUsage().split("\n").slice(0,3).join(" | ")); } catch (e) { console.log("dump failed", String(e).slice(0,100)); }

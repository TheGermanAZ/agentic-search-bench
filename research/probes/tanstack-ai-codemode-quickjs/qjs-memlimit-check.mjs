// Checks quickjs-emscripten 0.31.0 setMemoryLimit directly, outside TanStack, to locate the P7 behavior.
import { fileURLToPath, pathToFileURL } from 'node:url';
const NM = fileURLToPath(new URL('../../impls/tanstack-ai-codemode-quickjs/pkg/node_modules/', import.meta.url));
const { getQuickJS } = await import(pathToFileURL(NM + 'quickjs-emscripten/dist/index.mjs').href);
const QuickJS = await getQuickJS();
const code = 'const a = []; let err; try { while (true) a.push("x".repeat(1e6)); } catch (e) { err = String(e); } ({ pushed: a.length, err })';
for (const mode of ['context.runtime.setMemoryLimit', 'newRuntime({memoryLimit})']) {
  let vm, rt;
  if (mode.startsWith('context')) { vm = QuickJS.newContext(); vm.runtime.setMemoryLimit(32 * 1024 * 1024); }
  else { rt = QuickJS.newRuntime({ memoryLimit: 32 * 1024 * 1024 }); vm = rt.newContext(); }
  const r = vm.evalCode(code);
  const out = r.error ? { error: vm.dump(r.error) } : vm.dump(r.value);
  (r.error ?? r.value).dispose();
  console.log(mode, JSON.stringify(out), 'rssMB', Math.round(process.memoryUsage().rss / 1048576));
  vm.dispose(); rt?.dispose();
}

// Splits R2a into its parts to find which one Run refuses to serialize. Output: out/R2a-split.txt
import { pathToFileURL, fileURLToPath } from 'node:url';
const PKG = fileURLToPath(new URL('../../../impls/vercel-run/pkg/node_modules/run/', import.meta.url));
const { run } = await import(pathToFileURL(PKG + 'dist/index.js').href);
const hostFunctions = { host: { lookup: async ({ id }) => ({ id, value: id * 2 }) } };
for (const src of [
  'const r = await host.lookup({id:1}); return Object.getPrototypeOf(r) === Object.prototype;',
  'const r = await host.lookup({id:1}); try { return String(r.constructor.constructor("return typeof process")()); } catch (e) { return "threw " + e.message; }',
  'try { return String(host.lookup.constructor("return typeof process")()); } catch (e) { return "threw " + e.message; }',
  'try { const p = host.lookup.constructor("return 1")(); return typeof p; } catch (e) { return "threw " + e.message; }',
  'host.lookup({id: 1}); return "left a bridge call un-awaited";',
]) {
  try { const r = await run({ source: src, hostFunctions }); console.log(src, '=>', JSON.stringify(r.value)); }
  catch (e) { console.log(src, '=> THREW', e.name, e.code, JSON.stringify(e.message)); }
}
process.exit(0);

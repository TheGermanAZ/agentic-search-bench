// Can guest code call the raw ivm.Reference behind a tool (__external_lookup_ref) and skip host input validation?
// Run: node ref_check.mjs -> out/ref_check.txt
import { writeFileSync } from 'node:fs';
import makeAdapter from './adapter.mjs';
let seen = [];
const a = await makeAdapter('default', {
  lookup: async (id) => { seen.push(id); return { id, value: id * 2 }; },
  failing: async () => { throw new Error('x'); },
  rich: async () => ({}),
});
const lines = [];
for (const code of [
  'return await external_lookup({id: "not-a-number"});',
  'return JSON.parse(await __external_lookup_ref.applySyncPromise(undefined, [JSON.stringify({id: "not-a-number"})]));',
  'return Object.getOwnPropertyNames(globalThis).filter(k => k.startsWith("__"));',
]) {
  const r = await a.exec(code);
  lines.push(`${code}\n  => ${JSON.stringify(r).slice(0, 400)}\n  host lookup received: ${JSON.stringify(seen)}`);
  seen = [];
}
const text = lines.join('\n');
console.log(text);
writeFileSync(new URL('out/ref_check.txt', import.meta.url), text + '\n');
process.exit(0);

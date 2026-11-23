// asb-quickjs adapter (run with bun): src/sandbox.ts runCode() against a stand-in corpus.
// corpus.read(id) plays `lookup` (200 ms, {id, value: id*2}); corpus.search() throws like `failing`; corpus.people() returns the rich object.
// runCode returns the text the model sees; console output only (no `return`), so ret=false.
import { runCode } from '../../../../src/sandbox.ts';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default async (config, host) => {
  process.env.CODEMODE_ENGINE ??= 'quickjs-asyncify'; // runCode() follows the default engine
  const fake = {
    read: (id) => host.lookup(Number(id)),
    search: () => host.failing(),
    people: () => host.rich(),
  };
  let corpus = fake;
  const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  return {
    name: 'asb-quickjs', T: 'corpus.read', F: 'corpus.search', R: 'corpus.people', ret: false,
    notes: 'src/sandbox.ts runCode(code, corpus) as strategies.ts calls it; stand-in corpus',
    exec: (code) => runCode(code, corpus),
    extraTests: ({ timed, sleep }) => ({
      // The guest can call the bridge global itself and pick any dispatch key, including inherited ones.
      A1: async () => {
        corpus = { ...fake, db: { file: 'stand-in' }, vectors: new Float32Array(200_000).fill(0.123), chunkMsg: Array.from({ length: 50_000 }, (_, i) => `E${String(i).padStart(12, '0')}`), embedder: Promise.resolve(null) };
        const keys = await timed(`console.log(typeof __host, Object.getOwnPropertyNames(globalThis).filter(k => k.startsWith("__")).join(","))`, 'globals');
        const ctor = await timed(`const s = __host(JSON.stringify({ name: "constructor", args: [] })); const o = JSON.parse(s); console.log(s.length, Object.keys(o).join(","), o.chunkMsg && o.chunkMsg.length, o.vectors && Object.keys(o.vectors).length)`, 'constructor');
        const proto = await timed(`console.log(__host(JSON.stringify({ name: "__proto__", args: [] })))`, '__proto__');
        const tostr = await timed(`console.log(__host(JSON.stringify({ name: "toString", args: [] })))`, 'toString');
        const bad = await timed(`let o; try { o = __host("{"); } catch (e) { o = "guest caught: " + e; } console.log(o)`, 'invalid-json');
        const after = await timed(`console.log(corpus.read(21).value)`, 'after');
        return { keys, ctor, proto, tostr, bad, after };
      },
      // Same call against a corpus object with the real Corpus's own fields (real read-only DB handle, real 633 MB vectors).
      A1real: async () => {
        const db = new Database(ROOT + 'data/index/corpus.sqlite', { readonly: true });
        const rows = db.query('SELECT rowid, msg_id FROM chunks ORDER BY rowid').all();
        const chunkMsg = new Array(rows.length + 1);
        for (const r of rows) chunkMsg[r.rowid] = r.msg_id;
        const vectors = new Float32Array(readFileSync(ROOT + 'data/index/vectors.f32').buffer);
        corpus = { ...fake, db, vectors, chunkMsg, embedder: Promise.resolve(null) };
        const before = process.memoryUsage().rss;
        const r = await timed(`const s = __host(JSON.stringify({ name: "constructor", args: [] })); console.log(s.length, s.slice(0, 200))`, 'constructor-real');
        return { chunks: rows.length, vectorFloats: vectors.length, rssBeforeMb: Math.round(before / 2 ** 20), r, rssAfterMb: Math.round(process.memoryUsage().rss / 2 ** 20) };
      },
      // The `await` strip is a regex over the whole source, strings included.
      A4: async () => timed(`const s = "please await  the reply"; console.log(s)`),
      // Each execution gets its own 512 MB memory; six at once is six caps.
      A5: async () => {
        const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => timed('const a = []; while (true) a.push("x".repeat(1e6));', `bomb${i}`)));
        return { rs, rssMb: Math.round(process.memoryUsage().rss / 2 ** 20) };
      },
    }),
  };
};

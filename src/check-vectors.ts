// The corpus was embedded with sentence-transformers on the GPU, queries are embedded with
// transformers.js at runtime. This proves both produce the same vectors for the same text.
import { pipeline } from "@huggingface/transformers";
import { readFileSync } from "node:fs";
import { DIMS, EMBED_MODEL, VEC_PATH, openDb } from "./corpus";

const db = openDb();
const vecs = ((b) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4))(readFileSync(VEC_PATH));
const n = vecs.length / DIMS;
const total = (db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }).n;
if (n !== total) throw new Error(`vector rows ${n} != chunks ${total}`);
const fe = await pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" });
const sample = Array.from({ length: 25 }, (_, i) => 1 + Math.floor(((i * 2654435761) % 2 ** 32) / 2 ** 32 * n));
let worst = 1;
for (const row of sample) {
  const text = (db.query("SELECT text FROM chunks WHERE rowid = ?").get(row) as { text: string }).text.slice(0, 1000);
  const q = (await fe([text], { pooling: "cls", normalize: true })).data as Float32Array;
  let dot = 0;
  for (let d = 0; d < DIMS; d++) dot += q[d] * vecs[(row - 1) * DIMS + d];
  worst = Math.min(worst, dot);
}
console.log(`rows ${n} match chunks; min cosine between stored and runtime embedding over ${sample.length} samples: ${worst.toFixed(5)}`);
if (worst < 0.99) process.exit(1);

import { pipeline } from "@huggingface/transformers";
import { appendFileSync, existsSync, statSync } from "node:fs";
import { DIMS, EMBED_MODEL, VEC_PATH, openDb } from "./corpus";

const BATCH = 64;
const MAX_CHARS = 1000;

const db = openDb();
const total = (db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }).n;
// Resumable: the vector file holds rows 1..done in rowid order, so a restart continues where it stopped.
const done = existsSync(VEC_PATH) ? statSync(VEC_PATH).size / (DIMS * 4) : 0;
if (!Number.isInteger(done)) throw new Error(`${VEC_PATH} has a partial row; truncate it to a multiple of ${DIMS * 4} bytes`);
console.log(`embedding chunks ${done + 1}..${total}`);

const fe = await pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" });
const q = db.query("SELECT text FROM chunks WHERE rowid > ? ORDER BY rowid LIMIT ?");
const t0 = Date.now();
for (let at = done; at < total; at += BATCH) {
  const rows = q.all(at, BATCH) as { text: string }[];
  const out = await fe(rows.map((r) => r.text.slice(0, MAX_CHARS)), { pooling: "cls", normalize: true });
  appendFileSync(VEC_PATH, Buffer.from((out.data as Float32Array).buffer));
  if ((at / BATCH) % 50 === 0) {
    const rate = (at + rows.length - done) / ((Date.now() - t0) / 1000);
    console.log(`${at + rows.length}/${total} ${rate.toFixed(0)}/s eta ${((total - at) / rate / 60).toFixed(1)}m`);
  }
}
console.log("done");

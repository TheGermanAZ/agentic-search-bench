// Host cost of the guest call __host('{"name":"constructor","args":[]}') on the real corpus: JSON.stringify of the
// Corpus object runs synchronously on the host. Measures it on a 10% slice of the real vectors and extrapolates.
// Output: out/stringify-cost.txt
import { readFileSync, writeFileSync } from "node:fs";
const buf = readFileSync(new URL("../../../../data/index/vectors.f32", import.meta.url));
const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
const slice = all.slice(0, Math.floor(all.length / 10));
const t = performance.now();
let len = -1, err = "";
try { len = JSON.stringify({ vectors: slice }).length; } catch (e) { err = String(e); }
const ms = performance.now() - t;
const line = `full vectors: ${all.length} floats; 10% slice: ${slice.length} floats -> JSON ${len} chars in ${ms.toFixed(0)} ms ${err}; extrapolated full: ~${((len * 10) / 1e9).toFixed(2)} G chars, ~${((ms * 10) / 1000).toFixed(0)} s of blocked host event loop; rss now ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB`;
console.log(line);
writeFileSync(new URL("out/stringify-cost.txt", import.meta.url), line + "\n");

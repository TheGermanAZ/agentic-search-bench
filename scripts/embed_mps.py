# /// script
# requires-python = ">=3.11"
# dependencies = ["sentence-transformers>=3", "torch", "numpy"]
# ///
import sqlite3, sys, time
import numpy as np
from sentence_transformers import SentenceTransformer

db_path, out_path = sys.argv[1], sys.argv[2]
db = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
rows = db.execute("SELECT rowid, text FROM chunks ORDER BY rowid").fetchall()
assert rows[0][0] == 1 and rows[-1][0] == len(rows), "chunk rowids must be dense 1..n"
texts = [t[:1000] for _, t in rows]
model = SentenceTransformer("BAAI/bge-small-en-v1.5", device="mps")
model.max_seq_length = 512
order = np.argsort([len(t) for t in texts])
t0 = time.time()
vecs = np.zeros((len(texts), 384), dtype=np.float32)
B = 50_000
for i in range(0, len(order), B):
    idx = order[i:i + B]
    vecs[idx] = model.encode([texts[j] for j in idx], batch_size=128, normalize_embeddings=True, convert_to_numpy=True)
    print(f"{i + len(idx)}/{len(texts)} {(i + len(idx)) / (time.time() - t0):.0f}/s", flush=True)
vecs.tofile(out_path)
print("done", vecs.shape)

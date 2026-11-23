import { pipeline } from "@huggingface/transformers";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { Database } from "./db";
import { DIMS, EMBED_MODEL, FILES_DIR, type Message, VEC_PATH, loadMessages, openDb, readBody } from "./corpus";

export type Filter = { from?: string; to?: string; involves?: string; after?: string; before?: string; subjectContains?: string };
export type SearchMode = "hybrid" | "keyword" | "semantic";
export type SearchHit = Message & { score: number; snippet: string };
export type GrepHit = Message & { line: string };

const RRF_K = 60;
const POOL = 60;

/**
 * ripgrep scans of the whole corpus run one at a time. A scan is bound by the kernel opening about 500k small files,
 * and concurrent scans slow each other down: one takes 3.5 s, two at once 15 s, four at once 19 s (measured on a 14-core Mac).
 */
const RG_MAX_CONCURRENT = 1;
const RG_MAX_OUTPUT = 1 << 30;
let rgRunning = 0;
const rgQueue: (() => void)[] = [];

/** Runs rg without blocking the event loop (a synchronous spawn stalls every timer and pipe in the process). */
async function ripgrep(args: string[]): Promise<string> {
  if (rgRunning >= RG_MAX_CONCURRENT) await new Promise<void>((r) => rgQueue.push(r));
  rgRunning++;
  try {
    return await new Promise<string>((resolve, reject) => {
      const proc = spawn("rg", args, { stdio: ["ignore", "pipe", "pipe"] });
      const out: Buffer[] = [];
      let outBytes = 0;
      let err = "";
      proc.stdout.on("data", (b: Buffer) => {
        outBytes += b.length;
        if (outBytes > RG_MAX_OUTPUT) proc.kill("SIGKILL");
        else out.push(b);
      });
      proc.stderr.on("data", (b: Buffer) => {
        if (err.length < 300) err += b.toString();
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (outBytes > RG_MAX_OUTPUT) reject(new Error("grep failed: output too large"));
        else if (code === 2) reject(new Error(`grep failed: ${err.slice(0, 300)}`));
        else resolve(Buffer.concat(out).toString());
      });
    });
  } finally {
    rgRunning--;
    rgQueue.shift()?.();
  }
}

type Embedder = (texts: string[], opts: { pooling: "cls"; normalize: boolean }) => Promise<{ data: Float32Array }>;

export class Corpus {
  readonly db: Database;
  private vectors: Float32Array;
  private chunkMsg: string[];
  private embedder: Promise<Embedder>;

  constructor() {
    this.db = openDb();
    const rows = this.db.query("SELECT rowid, msg_id FROM chunks ORDER BY rowid").all() as { rowid: number; msg_id: string }[];
    this.chunkMsg = new Array(rows.length + 1);
    for (const r of rows) this.chunkMsg[r.rowid] = r.msg_id;
    const buf = existsSync(VEC_PATH) ? readFileSync(VEC_PATH) : null;
    this.vectors = buf ? new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) : new Float32Array(0);
    this.embedder = pipeline("feature-extraction", EMBED_MODEL, { dtype: "fp32" }) as unknown as Promise<Embedder>;
  }

  get embeddedChunks(): number {
    return this.vectors.length / DIMS;
  }

  private filterSql(f: Filter): { where: string; args: string[] } {
    const clauses: string[] = [];
    const args: string[] = [];
    if (f.from) {
      clauses.push("(m.from_addr LIKE ? OR m.from_name LIKE ?)");
      args.push(`%${f.from.toLowerCase()}%`, `%${f.from}%`);
    }
    if (f.to) {
      clauses.push("m.id IN (SELECT id FROM recipients WHERE addr LIKE ?)");
      args.push(`%${f.to.toLowerCase()}%`);
    }
    if (f.involves) {
      clauses.push("(m.from_addr LIKE ? OR m.id IN (SELECT id FROM recipients WHERE addr LIKE ?))");
      args.push(`%${f.involves.toLowerCase()}%`, `%${f.involves.toLowerCase()}%`);
    }
    if (f.after) {
      clauses.push("m.date >= ?");
      args.push(new Date(f.after).toISOString());
    }
    if (f.before) {
      clauses.push("m.date < ?");
      args.push(new Date(f.before).toISOString());
    }
    if (f.subjectContains) {
      clauses.push("m.subject LIKE ?");
      args.push(`%${f.subjectContains}%`);
    }
    return { where: clauses.length ? clauses.join(" AND ") : "1=1", args };
  }

  private allowedIds(f: Filter): Set<string> | null {
    const { where, args } = this.filterSql(f);
    if (where === "1=1") return null;
    return new Set((this.db.query(`SELECT m.id FROM messages m WHERE ${where}`).all(...args) as { id: string }[]).map((r) => r.id));
  }

  keywordChunks(query: string, k: number, filter: Filter): number[] {
    const terms = query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'.@-]*/gu) ?? [];
    if (terms.length === 0) return [];
    const match = [...new Set(terms)].map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
    const { where, args } = this.filterSql(filter);
    const sql = `SELECT chunks_fts.rowid AS rowid FROM chunks_fts JOIN chunks c ON c.rowid = chunks_fts.rowid JOIN messages m ON m.id = c.msg_id
                 WHERE chunks_fts MATCH ? AND ${where} ORDER BY bm25(chunks_fts) LIMIT ?`;
    return (this.db.query(sql).all(match, ...args, k) as { rowid: number }[]).map((r) => r.rowid);
  }

  async embed(text: string): Promise<Float32Array> {
    const fe = await this.embedder;
    return (await fe([text], { pooling: "cls", normalize: true })).data;
  }

  semanticChunks(q: Float32Array, k: number, allowed: Set<string> | null): number[] {
    const n = this.vectors.length / DIMS;
    const top: { row: number; s: number }[] = [];
    let floor = -Infinity;
    for (let i = 0; i < n; i++) {
      if (allowed && !allowed.has(this.chunkMsg[i + 1])) continue;
      let s = 0;
      const off = i * DIMS;
      for (let d = 0; d < DIMS; d++) s += this.vectors[off + d] * q[d];
      if (top.length < k || s > floor) {
        top.push({ row: i + 1, s });
        top.sort((a, b) => b.s - a.s);
        if (top.length > k) top.pop();
        floor = top[top.length - 1].s;
      }
    }
    return top.map((t) => t.row);
  }

  async search(query: string, opts: Filter & { k?: number; mode?: SearchMode } = {}): Promise<SearchHit[]> {
    const k = Math.min(opts.k ?? 10, 50);
    const mode = opts.mode ?? "hybrid";
    const allowed = this.allowedIds(opts);
    const lists: number[][] = [];
    if (mode !== "semantic") lists.push(this.keywordChunks(query, POOL, opts));
    if (mode !== "keyword") lists.push(this.semanticChunks(await this.embed(query), POOL, allowed));
    const fused = new Map<number, number>();
    for (const list of lists) list.forEach((row, rank) => fused.set(row, (fused.get(row) ?? 0) + 1 / (RRF_K + rank + 1)));
    const bestChunk = new Map<string, { row: number; score: number }>();
    for (const [row, score] of [...fused].sort((a, b) => b[1] - a[1])) {
      const id = this.chunkMsg[row];
      if (!bestChunk.has(id)) bestChunk.set(id, { row, score });
      if (bestChunk.size >= k) break;
    }
    const ids = [...bestChunk.keys()];
    const msgs = new Map(loadMessages(this.db, ids).map((m) => [m.id, m]));
    const snip = this.db.query("SELECT text FROM chunks WHERE rowid = ?");
    return ids.flatMap((id) => {
      const m = msgs.get(id);
      const b = bestChunk.get(id);
      if (!m || !b) return [];
      const text = (snip.get(b.row) as { text: string }).text;
      return [{ ...m, score: Number(b.score.toFixed(4)), snippet: text.slice(0, 700) }];
    });
  }

  /** In-flight scans by pattern and case flag: concurrent greps for the same pattern (with any filters) share one rg run. */
  private scans = new Map<string, Promise<Map<string, string>>>();

  /** The first matching line of every message that matches, by message id. Callers must not mutate the map. */
  private scan(pattern: string, caseSensitive: boolean): Promise<Map<string, string>> {
    const key = JSON.stringify([pattern, caseSensitive]);
    let p = this.scans.get(key);
    if (!p) {
      const args = ["--no-ignore", "--no-heading", "-n", "-m", "1", "--max-columns", "300", "-e", pattern, FILES_DIR];
      if (!caseSensitive) args.unshift("-i");
      p = ripgrep(args)
        .then((stdout) => {
          const lineFor = new Map<string, string>();
          for (const l of stdout.split("\n")) {
            const m = l.match(/\/(E[0-9a-f]{12})\.txt:\d+:(.*)$/);
            if (m) lineFor.set(m[1], m[2].trim().slice(0, 300));
          }
          return lineFor;
        })
        .finally(() => this.scans.delete(key));
      this.scans.set(key, p);
    }
    return p;
  }

  async grep(pattern: string, opts: Filter & { limit?: number; caseSensitive?: boolean } = {}): Promise<{ totalFiles: number; hits: GrepHit[] }> {
    const lineFor = await this.scan(pattern, Boolean(opts.caseSensitive));
    let ids = [...lineFor.keys()];
    const allowed = this.allowedIds(opts);
    if (allowed) ids = ids.filter((id) => allowed.has(id));
    const limit = Math.min(opts.limit ?? 50, 500);
    const hits = loadMessages(this.db, ids.slice(0, limit)).map((m) => ({ ...m, line: lineFor.get(m.id) ?? "" }));
    return { totalFiles: ids.length, hits };
  }

  messages(f: Filter & { limit?: number } = {}): Message[] {
    const { where, args } = this.filterSql(f);
    const limit = Math.min(f.limit ?? 100, 5000);
    const ids = (this.db.query(`SELECT m.id FROM messages m WHERE ${where} ORDER BY m.date LIMIT ${limit}`).all(...args) as { id: string }[]).map((r) => r.id);
    return loadMessages(this.db, ids);
  }

  count(f: Filter = {}): number {
    const { where, args } = this.filterSql(f);
    return (this.db.query(`SELECT count(*) AS n FROM messages m WHERE ${where}`).get(...args) as { n: number }).n;
  }

  people(q: string): { email: string; names: string[]; sent: number; received: number }[] {
    const like = `%${q.toLowerCase()}%`;
    const rows = this.db
      .query("SELECT from_addr AS email, group_concat(DISTINCT from_name) AS names, count(*) AS sent FROM messages WHERE lower(from_addr) LIKE ? OR lower(from_name) LIKE ? GROUP BY from_addr ORDER BY sent DESC LIMIT 10")
      .all(like, like) as { email: string; names: string | null; sent: number }[];
    const recv = this.db.query("SELECT count(*) AS n FROM recipients WHERE addr = ?");
    return rows.map((r) => ({ email: r.email, names: (r.names ?? "").split(",").filter(Boolean).slice(0, 3), sent: r.sent, received: (recv.get(r.email) as { n: number }).n }));
  }

  read(id: string): (Message & { body: string }) | null {
    const [m] = loadMessages(this.db, [id]);
    const body = readBody(this.db, id);
    return m && body !== null ? { ...m, body: body.slice(0, 20000) } : null;
  }
}

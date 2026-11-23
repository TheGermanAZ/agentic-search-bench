// Parses the Enron maildir, dedupes copies of the same message across folders,
// and writes: one text file per message (for grep agents), and a SQLite index
// with message metadata, recipients, chunks and an FTS5 table over the chunks.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { DATA, DB_PATH, FILES_DIR, type MessageWithBody, fileFor, openDb, renderFile } from "./corpus";

const MAILDIR = join(DATA, "raw", "maildir");
const CHUNK_CHARS = 1200;
const MAX_CHUNKS = 4;

function parseHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const split = raw.indexOf("\n\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 2);
  const headers = new Map<string, string>();
  let last = "";
  for (const line of head.split("\n")) {
    if (/^\s/.test(line) && last) {
      headers.set(last, `${headers.get(last)} ${line.trim()}`);
      continue;
    }
    const i = line.indexOf(":");
    if (i <= 0) continue;
    last = line.slice(0, i).toLowerCase();
    headers.set(last, line.slice(i + 1).trim());
  }
  return { headers, body };
}

function addrs(v: string | undefined): string[] {
  if (!v) return [];
  return [...new Set(v.split(",").map((s) => s.trim().toLowerCase().replace(/^<|>$/g, "")).filter((s) => s.includes("@")))];
}

function toIso(d: string | undefined): string {
  const t = d ? Date.parse(d.replace(/\s*\([A-Z]+\)\s*$/, "")) : Number.NaN;
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

function chunkBody(m: MessageWithBody): string[] {
  const head = `Subject: ${m.subject}\nFrom: ${m.fromName || m.from}\n`;
  const paras = m.body.replace(/\r/g, "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length > CHUNK_CHARS) {
      chunks.push(cur);
      cur = "";
      if (chunks.length === MAX_CHUNKS) break;
    }
    cur = cur ? `${cur}\n\n${p.slice(0, CHUNK_CHARS * 2)}` : p.slice(0, CHUNK_CHARS * 2);
  }
  if (cur && chunks.length < MAX_CHUNKS) chunks.push(cur);
  if (chunks.length === 0) chunks.push("");
  return chunks.map((c) => head + c);
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

rmSync(FILES_DIR, { recursive: true, force: true });
rmSync(DB_PATH, { force: true });
rmSync(`${DB_PATH}-wal`, { force: true });
rmSync(`${DB_PATH}-shm`, { force: true });
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = openDb(false);
db.exec(`
  CREATE TABLE messages (id TEXT PRIMARY KEY, date TEXT, from_addr TEXT, from_name TEXT, subject TEXT, custodian TEXT, folder TEXT, body TEXT, copies INTEGER);
  CREATE TABLE recipients (id TEXT, addr TEXT, kind TEXT);
  CREATE TABLE chunks (rowid INTEGER PRIMARY KEY, msg_id TEXT, ord INTEGER, text TEXT);
`);
const insMsg = db.prepare("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)");
const bumpCopies = db.prepare("UPDATE messages SET copies = copies + 1 WHERE id = ?");
const insRcp = db.prepare("INSERT INTO recipients VALUES (?, ?, ?)");
const insChunk = db.prepare("INSERT INTO chunks (msg_id, ord, text) VALUES (?, ?, ?)");

const seen = new Set<string>();
let files = 0;
let unique = 0;
const t0 = Date.now();
db.exec("BEGIN");
for (const path of walk(MAILDIR)) {
  files++;
  const raw = readFileSync(path, "latin1").replace(/\r\n/g, "\n");
  const { headers, body } = parseHeaders(raw);
  const from = addrs(headers.get("from"))[0] ?? "";
  const date = toIso(headers.get("date"));
  const subject = headers.get("subject") ?? "";
  const key = createHash("sha1").update(`${from}\u0000${date}\u0000${subject}\u0000${body.trim()}`).digest("hex");
  const id = `E${key.slice(0, 12)}`;
  if (seen.has(id)) {
    bumpCopies.run(id);
    continue;
  }
  seen.add(id);
  unique++;
  const parts = relative(MAILDIR, path).split(sep);
  const m: MessageWithBody = {
    id,
    date,
    from,
    fromName: (headers.get("x-from") ?? "").replace(/<.*?>/g, "").replace(/"/g, "").trim(),
    to: addrs(headers.get("to")),
    cc: addrs(headers.get("cc")),
    subject,
    custodian: parts[0] ?? "",
    folder: parts.slice(1, -1).join("/"),
    body: body.trim(),
  };
  insMsg.run(m.id, m.date, m.from, m.fromName, m.subject, m.custodian, m.folder, m.body);
  for (const a of m.to) insRcp.run(id, a, "to");
  for (const a of m.cc) insRcp.run(id, a, "cc");
  chunkBody(m).forEach((c, i) => insChunk.run(id, i, c));
  const f = fileFor(id);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, renderFile(m));
  if (files % 50000 === 0) {
    db.exec("COMMIT; BEGIN");
    console.log(`${files} files, ${unique} unique, ${Math.round((Date.now() - t0) / 1000)}s`);
  }
}
db.exec("COMMIT");
db.exec(`
  CREATE INDEX recipients_addr ON recipients(addr, id);
  CREATE INDEX recipients_id ON recipients(id);
  CREATE INDEX messages_from ON messages(from_addr, date);
  CREATE INDEX messages_date ON messages(date);
  CREATE INDEX chunks_msg ON chunks(msg_id);
  CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='rowid', tokenize='porter unicode61');
  INSERT INTO chunks_fts(rowid, text) SELECT rowid, text FROM chunks;
`);
const nChunks = (db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }).n;
console.log(`done: ${files} files, ${unique} unique messages, ${nChunks} chunks, ${Math.round((Date.now() - t0) / 1000)}s`);
db.close();

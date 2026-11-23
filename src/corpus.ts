import { Database } from "./db";
import { join } from "node:path";

export const ROOT = join(import.meta.dirname, "..");
export const DATA = join(ROOT, "data");
export const FILES_DIR = join(DATA, "corpus", "files");
export const DB_PATH = join(DATA, "index", "corpus.sqlite");
export const VEC_PATH = join(DATA, "index", "vectors.f32");
export const EMBED_MODEL = "Xenova/bge-small-en-v1.5";
export const DIMS = 384;

export type Message = {
  id: string;
  date: string;
  from: string;
  fromName: string;
  to: string[];
  cc: string[];
  subject: string;
  custodian: string;
  folder: string;
};

export type MessageWithBody = Message & { body: string };

export function fileFor(id: string): string {
  return join(FILES_DIR, id.slice(1, 3), `${id}.txt`);
}

export function renderFile(m: MessageWithBody): string {
  return [
    `Id: ${m.id}`,
    `Date: ${m.date}`,
    `From: ${m.fromName ? `${m.fromName} <${m.from}>` : m.from}`,
    `To: ${m.to.join(", ")}`,
    `Cc: ${m.cc.join(", ")}`,
    `Subject: ${m.subject}`,
    `Mailbox: ${m.custodian}/${m.folder}`,
    "",
    m.body,
  ].join("\n");
}

export function openDb(readonly = true): Database {
  const db = new Database(DB_PATH, { readonly });
  db.exec("PRAGMA journal_mode = WAL; PRAGMA cache_size = -200000;");
  return db;
}

type MessageRow = {
  id: string;
  date: string;
  from_addr: string;
  from_name: string;
  subject: string;
  custodian: string;
  folder: string;
};

export function loadMessages(db: Database, ids: string[]): Message[] {
  if (ids.length === 0) return [];
  const rows = new Map<string, MessageRow>();
  const recips = new Map<string, { to: string[]; cc: string[] }>();
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    const qs = slice.map(() => "?").join(",");
    for (const r of db.query(`SELECT id, date, from_addr, from_name, subject, custodian, folder FROM messages WHERE id IN (${qs})`).all(...slice) as MessageRow[]) rows.set(r.id, r);
    for (const r of db.query(`SELECT id, addr, kind FROM recipients WHERE id IN (${qs})`).all(...slice) as { id: string; addr: string; kind: string }[]) {
      const e = recips.get(r.id) ?? { to: [], cc: [] };
      (r.kind === "to" ? e.to : e.cc).push(r.addr);
      recips.set(r.id, e);
    }
  }
  return ids.flatMap((id) => {
    const r = rows.get(id);
    if (!r) return [];
    const rc = recips.get(id) ?? { to: [], cc: [] };
    return [{ id, date: r.date, from: r.from_addr, fromName: r.from_name, to: rc.to, cc: rc.cc, subject: r.subject, custodian: r.custodian, folder: r.folder }];
  });
}

export function readBody(db: Database, id: string): string | null {
  const r = db.query("SELECT body FROM messages WHERE id = ?").get(id) as { body: string } | null;
  return r?.body ?? null;
}

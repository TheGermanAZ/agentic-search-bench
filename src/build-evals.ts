// Builds the graded question set. Aggregation and identifier questions get their
// answers from SQL over the deduped corpus, so their ground truth is exact.
// "Find the email" questions are written by an LLM from a seed message; the gold
// set is the seed plus any message that quotes a long passage of it.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, openDb } from "./corpus";

export type Kind = "aggregate" | "identifier" | "semantic";
export type AnswerType = "count" | "email" | "date" | "message";
export type EvalQuestion = { id: string; kind: Kind; question: string; answerType: AnswerType; answer: string; gold: string[]; note?: string };

const db = openDb();
let seed = 20261121;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
const shuffle = <T>(xs: T[]): T[] => xs.map((x) => [rand(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const day = (iso: string) => iso.slice(0, 10);
const nameOf = (addr: string) => (db.query("SELECT from_name AS n FROM messages WHERE from_addr = ? AND from_name != '' GROUP BY from_name ORDER BY count(*) DESC LIMIT 1").get(addr) as { n: string } | null)?.n ?? addr;
const who = (addr: string) => `${nameOf(addr)} (${addr})`;

function aggregate(): EvalQuestion[] {
  const out: EvalQuestion[] = [];
  const senders = (db.query("SELECT from_addr AS a, count(*) AS n FROM messages WHERE from_addr LIKE '%@enron.com' AND date >= '2000-01-01' GROUP BY from_addr HAVING n BETWEEN 300 AND 4000").all() as { a: string; n: number }[]).map((r) => r.a);

  const pairs = db
    .query(`SELECT m.from_addr AS a, r.addr AS b, substr(m.date,1,7) AS month, count(DISTINCT m.id) AS n FROM messages m JOIN recipients r ON r.id = m.id
            WHERE m.from_addr LIKE '%@enron.com' AND r.addr LIKE '%@enron.com' AND m.from_addr != r.addr AND m.date >= '2000-01-01'
            GROUP BY a, b, month HAVING n BETWEEN 6 AND 40`)
    .all() as { a: string; b: string; month: string; n: number }[];
  for (const p of shuffle(pairs).slice(0, 4)) {
    const start = `${p.month}-01`;
    const end = new Date(Date.UTC(+p.month.slice(0, 4), +p.month.slice(5, 7), 1)).toISOString().slice(0, 10);
    out.push({ id: "", kind: "aggregate", answerType: "count", answer: String(p.n), gold: [], question: `How many messages did ${who(p.a)} send to ${p.b} during ${start} to ${end} (end exclusive)? Count each unique message once.` });
  }

  for (const a of shuffle(senders)) {
    if (out.length >= 8) break;
    const month = (db.query("SELECT substr(date,1,7) AS m FROM messages WHERE from_addr = ? AND date >= '2000-01-01' GROUP BY m ORDER BY count(*) DESC LIMIT 3").all(a) as { m: string }[]).map((r) => r.m);
    const m = pick(month);
    const rows = db.query(`SELECT r.addr AS b, count(DISTINCT m.id) AS n FROM messages m JOIN recipients r ON r.id = m.id WHERE m.from_addr = ? AND substr(m.date,1,7) = ? AND r.addr != ? GROUP BY b ORDER BY n DESC LIMIT 2`).all(a, m, a) as { b: string; n: number }[];
    if (rows.length < 2 || rows[0].n - rows[1].n < 3) continue;
    out.push({ id: "", kind: "aggregate", answerType: "email", answer: rows[0].b, gold: [], note: `${rows[0].n} vs ${rows[1].n}`, question: `In ${m} (UTC), which address did ${who(a)} send the most messages to? Count unique messages, To and Cc both count.` });
  }

  for (const a of shuffle(senders)) {
    if (out.length >= 12) break;
    const anchor = db.query("SELECT date FROM messages WHERE from_addr = ? AND date >= '2000-06-01' ORDER BY random() LIMIT 1").get(a) as { date: string } | null;
    if (!anchor) continue;
    const end = day(anchor.date);
    const start = new Date(Date.parse(end) - 7 * 86400000).toISOString().slice(0, 10);
    const rows = db.query(`SELECT m.from_addr AS s, count(DISTINCT m.id) AS n FROM messages m JOIN recipients r ON r.id = m.id WHERE r.addr = ? AND m.date >= ? AND m.date < ? AND m.from_addr != ? GROUP BY s ORDER BY n DESC LIMIT 2`).all(a, start, end, a) as { s: string; n: number }[];
    if (rows.length < 2 || rows[0].n < 4 || rows[0].n - rows[1].n < 2) continue;
    out.push({ id: "", kind: "aggregate", answerType: "email", answer: rows[0].s, gold: [], note: `${rows[0].n} vs ${rows[1].n}`, question: `In the 7 days before ${end} (from ${start} up to but not including ${end}, UTC), who sent the most messages to ${who(a)}? Count unique messages, To and Cc both count.` });
  }

  for (const a of shuffle(senders)) {
    if (out.length >= 15) break;
    const m = (db.query("SELECT substr(date,1,7) AS m FROM messages WHERE from_addr = ? AND date >= '2000-01-01' GROUP BY m ORDER BY count(*) DESC LIMIT 1").get(a) as { m: string }).m;
    const rows = db.query("SELECT substr(date,1,10) AS d, count(*) AS n FROM messages WHERE from_addr = ? AND substr(date,1,7) = ? GROUP BY d ORDER BY n DESC LIMIT 2").all(a, m) as { d: string; n: number }[];
    if (rows.length < 2 || rows[0].n - rows[1].n < 3) continue;
    out.push({ id: "", kind: "aggregate", answerType: "date", answer: rows[0].d, gold: [], note: `${rows[0].n} vs ${rows[1].n}`, question: `On which UTC date in ${m} did ${who(a)} send the most messages? Answer as YYYY-MM-DD.` });
  }
  return out;
}

function identifiers(): EvalQuestion[] {
  const phone = /\b\(?(\d{3})\)?[-. ](\d{3})[-.](\d{4})\b/g;
  const code = /\b([A-Z]{2,5}-\d{4,7})\b/g;
  const counts = new Map<string, { kind: "phone" | "code"; ids: Set<string> }>();
  for (const r of db.query("SELECT id, body FROM messages WHERE length(body) BETWEEN 200 AND 6000").iterate() as Iterable<{ id: string; body: string }>) {
    for (const m of r.body.matchAll(phone)) {
      const k = `${m[1]}-${m[2]}-${m[3]}`;
      const e = counts.get(k) ?? { kind: "phone" as const, ids: new Set<string>() };
      e.ids.add(r.id);
      counts.set(k, e);
    }
    for (const m of r.body.matchAll(code)) {
      const e = counts.get(m[1]) ?? { kind: "code" as const, ids: new Set<string>() };
      e.ids.add(r.id);
      counts.set(m[1], e);
    }
  }
  const out: EvalQuestion[] = [];
  const singles = shuffle([...counts].filter(([, v]) => v.ids.size === 1));
  for (const want of [{ kind: "phone", n: 6 }, { kind: "code", n: 4 }] as const) {
    let got = 0;
    for (const [token, v] of singles) {
      if (got >= want.n) break;
      if (v.kind !== want.kind) continue;
      const id = [...v.ids][0];
      const m = db.query("SELECT from_addr, body FROM messages WHERE id = ?").get(id) as { from_addr: string; body: string };
      // The token must appear in exactly one message under any common formatting, so grep and keyword search are judged on the same truth.
      const digits = token.replace(/\D/g, "");
      const variants = v.kind === "phone" ? [token, `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`, `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`, `${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6)}`] : [token];
      const total = variants.reduce((n, t) => n + (db.query("SELECT count(*) AS n FROM messages WHERE instr(body, ?) > 0").get(t) as { n: number }).n, 0);
      if (total !== 1 || !m.from_addr) continue;
      const shown = v.kind === "phone" ? token : token;
      out.push({ id: "", kind: "identifier", answerType: "message", answer: m.from_addr, gold: [id], question: v.kind === "phone" ? `One message in the corpus mentions the phone number ${shown}. Which message is it, and who sent it?` : `One message in the corpus mentions the reference ${shown}. Which message is it, and who sent it?` });
      got++;
    }
  }
  return out;
}

async function semantic(n: number): Promise<EvalQuestion[]> {
  const candidates = db
    .query(`SELECT id, date, from_addr, subject, body FROM messages WHERE folder LIKE '%sent%' AND from_addr LIKE '%@enron.com' AND length(body) BETWEEN 400 AND 2500
            AND body NOT LIKE '%Original Message%' AND body NOT LIKE '%Forwarded by%' AND subject != '' ORDER BY id`)
    .all() as { id: string; date: string; from_addr: string; subject: string; body: string }[];
  const out: EvalQuestion[] = [];
  for (const c of shuffle(candidates)) {
    if (out.length >= n) break;
    const prompt = `Here is one email from a large corpus of a company's email.

Date: ${c.date}
From: ${c.from_addr}
Subject: ${c.subject}

${c.body}

Write one question an investigator might ask whose answer is a specific fact stated in this email, so that finding this email is the way to answer it. Rules:
- Paraphrase. Do not copy any phrase of 3 or more words from the email, and avoid its rarest words.
- You may name the sender, and say roughly when (month and year).
- The question must be answerable from this email alone and should not be answerable from generic knowledge.
- If the email is boilerplate, a newsletter, or has no specific fact, reply SKIP.
Reply with JSON only: {"question": "...", "answer": "..."} or SKIP.`;
    let text = "";
    for await (const m of query({ prompt, options: { model: "claude-sonnet-5-5", tools: [], allowedTools: [], maxTurns: 1, settingSources: [], persistSession: false } })) {
      if (m.type === "result" && m.subtype === "success") text = m.result;
    }
    if (/^\s*SKIP/i.test(text)) continue;
    const json = text.match(/\{[\s\S]*\}/)?.[0];
    if (!json) continue;
    const q = JSON.parse(json) as { question: string; answer: string };
    const probe = c.body.replace(/\s+/g, " ").trim().slice(40, 160);
    const quoting = (db.query("SELECT id, body FROM messages WHERE instr(body, ?) > 0").all(probe.slice(0, 60)) as { id: string; body: string }[])
      .filter((r) => r.body.replace(/\s+/g, " ").includes(probe))
      .map((r) => r.id);
    out.push({ id: "", kind: "semantic", answerType: "message", answer: q.answer, gold: [...new Set([c.id, ...quoting])], question: q.question });
    console.log(`semantic ${out.length}/${n}: ${q.question}`);
  }
  return out;
}

const all = [...aggregate(), ...identifiers(), ...(await semantic(15))].map((q, i) => ({ ...q, id: `${q.kind.slice(0, 3)}-${String(i + 1).padStart(2, "0")}` }));
mkdirSync(join(ROOT, "evals"), { recursive: true });
writeFileSync(join(ROOT, "evals", "questions.json"), `${JSON.stringify(all, null, 2)}\n`);
console.log(`wrote ${all.length} questions:`, Object.groupBy(all, (q) => q.kind) && Object.fromEntries(Object.entries(Object.groupBy(all, (q) => q.kind)).map(([k, v]) => [k, v?.length])));

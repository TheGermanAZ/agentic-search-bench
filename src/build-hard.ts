import { spawnSync } from "node:child_process";
// Adds a hard tier to evals/questions.json: aggregation over messages selected by text, and
// two-hop questions. Truth comes from ripgrep over the same message files the agents search,
// joined with message metadata in SQL, so it is exact. Rerunning replaces the hard tier.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvalQuestion } from "./build-evals";
import { FILES_DIR, ROOT, openDb } from "./corpus";

const db = openDb();
const path = join(ROOT, "evals", "questions.json");
const existing = (JSON.parse(readFileSync(path, "utf8")) as EvalQuestion[]).filter((q) => !q.id.startsWith("hrd-"));

function idsContaining(text: string): string[] {
  const p = spawnSync("rg", ["--no-ignore", "-i", "-F", "-l", "-e", text, FILES_DIR], { maxBuffer: 1 << 30 });
  return [...p.stdout.toString().matchAll(/(E[0-9a-f]{12})\.txt/g)].map((m) => m[1]);
}

function withMeta(ids: string[]): { id: string; date: string; from_addr: string }[] {
  const out: { id: string; date: string; from_addr: string }[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500);
    out.push(...(db.query(`SELECT id, date, from_addr FROM messages WHERE id IN (${slice.map(() => "?").join(",")})`).all(...slice) as { id: string; date: string; from_addr: string }[]));
  }
  return out;
}

const tally = <T>(xs: T[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>())].sort((a, b) => b[1] - a[1]);
const nextMonth = (m: string) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 1)).toISOString().slice(0, 7);
const scope = (kw: string) => `contain the text "${kw}" (case-insensitive, anywhere in the message including headers)`;

const hard: Omit<EvalQuestion, "id">[] = [];
const keywords = ["Raptor", "LJM", "Dabhol", "Azurix", "Blockbuster", "Whitewing", "Andersen", "Dynegy", "Cuiaba", "Northern Natural"];
const used = { senders: 0, top: 0, day: 0 };
for (const kw of keywords) {
  const hits = withMeta(idsContaining(kw));
  const months = tally(hits.map((h) => h.date.slice(0, 7))).filter(([, n]) => n >= 25 && n <= 300);
  if (months.length === 0) continue;
  const [month] = months[Math.floor(months.length / 2)];
  const inMonth = hits.filter((h) => h.date.startsWith(month));
  const window = `${month}-01 up to but not including ${nextMonth(month)}-01, UTC`;
  if (used.senders < 3) {
    const n = new Set(inMonth.map((h) => h.from_addr)).size;
    hard.push({ kind: "aggregate", answerType: "count", answer: String(n), gold: [], note: `${inMonth.length} messages`, question: `How many distinct sender addresses sent at least one message during ${window} that ${scope(kw)}?` });
    used.senders++;
    continue;
  }
  if (used.top < 3) {
    const t = tally(inMonth.map((h) => h.from_addr));
    if (t.length < 2 || t[0][1] - t[1][1] < 2) continue;
    hard.push({ kind: "aggregate", answerType: "email", answer: t[0][0], gold: [], note: `${t[0][1]} vs ${t[1][1]}`, question: `During ${window}, which sender address sent the most messages that ${scope(kw)}? Count unique messages.` });
    used.top++;
    continue;
  }
  if (used.day < 2) {
    const t = tally(inMonth.map((h) => h.date.slice(0, 10)));
    if (t.length < 2 || t[0][1] - t[1][1] < 2) continue;
    hard.push({ kind: "aggregate", answerType: "date", answer: t[0][0], gold: [], note: `${t[0][1]} vs ${t[1][1]}`, question: `On which UTC date during ${window} were the most messages sent that ${scope(kw)}? Answer as YYYY-MM-DD.` });
    used.day++;
  }
}

for (const q of existing.filter((q) => q.kind === "identifier").slice(0, 2)) {
  const sender = q.answer;
  const [{ date }] = db.query("SELECT date FROM messages WHERE id = ?").all(q.gold[0]) as { date: string }[];
  const month = date.slice(0, 7);
  const n = (db.query("SELECT count(*) AS n FROM messages WHERE from_addr = ? AND substr(date,1,7) = ?").get(sender, month) as { n: number }).n;
  const token = q.question.match(/(?:number|reference) (\S+)\./)?.[1] ?? "";
  hard.push({ kind: "aggregate", answerType: "count", answer: String(n), gold: [], note: `sender ${sender}, ${month}`, question: `Find the message that mentions ${token}. How many messages in total did its sender send during that same UTC calendar month?` });
}

const all = [...existing, ...hard.map((q, i) => ({ ...q, id: `hrd-${String(i + 1).padStart(2, "0")}` }))];
writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
for (const q of hard) console.log(q.answerType, q.answer, q.note, "|", q.question);

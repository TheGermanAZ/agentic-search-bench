// The JavaScript corpus API shown to the model, and runCode() for callers that predate the engine registry.
// Engines live in src/engines/; the shared host contract is src/engines/host.ts.
import { getEngine } from "./engines";
import type { Corpus } from "./search";

const FILTER_AND_MESSAGE = `type Filter = {
  from?: string;            // substring of sender address or display name
  to?: string;              // substring of a To or Cc address
  involves?: string;        // substring of sender or any recipient address
  after?: string;           // ISO date, inclusive
  before?: string;          // ISO date, exclusive
  subjectContains?: string;
};
type Message = { id: string; date: string; from: string; fromName: string; to: string[]; cc: string[]; subject: string; custodian: string; folder: string };`;

/** The corpus API in TypeScript. `async` wraps every return type in a Promise for engines with an async bridge. */
export function corpusApi(async: boolean): string {
  const R = (t: string) => (async ? `Promise<${t}>` : t);
  return `declare const corpus: {
  /** Ranked search. mode "hybrid" (default) fuses BM25 keyword search and embedding search with reciprocal rank fusion.
   *  "keyword" is BM25 only, "semantic" is embeddings only. Filters narrow before ranking. k defaults to 10, max 50. */
  search(query: string, opts?: Filter & { k?: number; mode?: "hybrid" | "keyword" | "semantic" }): ${R("Array<Message & { score: number; snippet: string }>")};
  /** Regex over the full text of every message (headers and body), ripgrep syntax, case-insensitive unless caseSensitive.
   *  totalFiles counts every matching message after filters; hits holds the first \`limit\` (default 50, max 500) with the first matching line. */
  grep(pattern: string, opts?: Filter & { limit?: number; caseSensitive?: boolean }): ${R("{ totalFiles: number; hits: Array<Message & { line: string }> }")};
  /** Metadata query, no text matching. Sorted by date. limit defaults to 100, max 5000. */
  messages(filter: Filter & { limit?: number }): ${R("Message[]")};
  /** Exact number of messages matching a metadata filter (no limit). */
  count(filter: Filter): ${R("number")};
  /** Resolve a name or address fragment to sender addresses, most active first. */
  people(nameOrEmail: string): ${R("Array<{ email: string; names: string[]; sent: number; received: number }>")};
  /** One full message, body capped at 20k chars. */
  read(id: string): ${R("(Message & { body: string }) | null")};
};
${FILTER_AND_MESSAGE}`;
}

export const CORPUS_API = corpusApi(false);

/** The system-prompt paragraph for a JavaScript engine. */
export function jsGuide(async: boolean): string {
  const how = async
    ? "Every corpus function returns a Promise: use `await`, and `Promise.all` to run independent calls at the same time. Top-level await works."
    : "The corpus functions are synchronous.";
  return `You have one tool, execute. It runs JavaScript in a sandbox where a global \`corpus\` object exposes this API:

\`\`\`ts
${corpusApi(async)}
\`\`\`

${how} Write a program that does the whole search in one call when you can: filter, loop, count and join in code, then console.log only what you need to see. Only printed output comes back to you. The sandbox has no network or filesystem.`;
}

/** Runs a program on the engine named by CODEMODE_ENGINE (default vercel-run; see src/engines/index.ts). */
export async function runCode(code: string, corpus: Corpus): Promise<string> {
  return (await getEngine()).run(code, corpus);
}

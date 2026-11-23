import { type Options, type SDKMessage, createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { z } from "zod";
import { FILES_DIR } from "./corpus";
import { getEngine } from "./engines";
import type { Engine } from "./engines/types";
import type { Corpus } from "./search";

export const STRATEGIES = ["rag", "agentic", "tools", "codemode"] as const;
export type Strategy = (typeof STRATEGIES)[number];

export type RunResult = {
  answer: string;
  sources: string[];
  finalText: string;
  turns: number;
  toolCalls: number;
  toolResultChars: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  error?: string;
  trace: { tool: string; input: string; resultChars: number }[];
};

const ANSWER_FORMAT = `End your reply with exactly these two lines:
ANSWER: <the short answer. For a count, only the number. For a person, their email address.>
SOURCES: <comma-separated ids of up to 5 messages that support the answer, like E1a2b3c4d5e6f>`;

const CORPUS_INTRO = (n: number) =>
  `You answer an investigator's questions over a seized email corpus: ${n.toLocaleString("en-US")} unique messages from Enron, 1998 to 2002. Every message has an id like E1a2b3c4d5e6f. Dates are UTC. "Sent to" means the address is in To or Cc.`;

const AGENTIC_GUIDE = `The current directory holds one text file per message at <2 hex chars>/<id>.txt. Each file starts with header lines (Id, Date, From, To, Cc, Subject, Mailbox), a blank line, then the body. There are hundreds of thousands of files, so use Grep (files_with_matches or count modes, glob filters) to narrow down before you Read.`;

const TOOL_OUTPUT_CAP = 8000;

function baseOptions(model: string): Options {
  return {
    model,
    settingSources: [],
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: 30,
    env: { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: "agentic-search-bench/0.1" },
  };
}

// TRACE_EXECUTE=1 logs each execute call's duration and output size to stderr, for diagnosing engine latency.
async function timedRun(engine: Engine, code: string, corpus: Corpus): Promise<string> {
  const t = performance.now();
  const text = await engine.run(code, corpus);
  if (process.env.TRACE_EXECUTE) console.error(`[execute ${engine.name}] ${Math.round(performance.now() - t)} ms, ${text.length} chars: ${text.slice(0, 120).replace(/\n/g, " | ")}`);
  return text;
}

function strategyOptions(strategy: Strategy, corpus: Corpus, nMessages: number, model: string, engine?: Engine): { options: Options; prompt: (q: string) => Promise<string> } {
  const intro = CORPUS_INTRO(nMessages);
  switch (strategy) {
    case "rag":
      return {
        options: { ...baseOptions(model), tools: [], allowedTools: [], maxTurns: 1, systemPrompt: `${intro}\nAnswer only from the retrieved messages you are given. If they do not contain the answer, say so and give your best guess.\n${ANSWER_FORMAT}` },
        prompt: async (q) => {
          const hits = await corpus.search(q, { k: 8 });
          const ctx = hits.map((h) => `[${h.id}] ${h.date} From: ${h.from} To: ${h.to.slice(0, 5).join(", ")} Subject: ${h.subject}\n${h.snippet}`).join("\n\n---\n\n");
          return `Retrieved messages (hybrid BM25 + embedding search, top 8):\n\n${ctx}\n\nQuestion: ${q}`;
        },
      };
    case "agentic":
      return {
        options: {
          ...baseOptions(model),
          cwd: FILES_DIR,
          tools: ["Grep", "Glob", "Read"],
          // Not in allowedTools on purpose: every call goes through canUseTool, which keeps the agent
          // inside the corpus (and the SDK's own saved tool output) so it can never read the answer key.
          canUseTool: async (_name, input) => {
            const p = [input.path, input.file_path].find((v): v is string => typeof v === "string");
            const abs = p === undefined ? FILES_DIR : resolve(FILES_DIR, p);
            return abs.startsWith(FILES_DIR) || abs.includes("/tool-results/") ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: "Only the corpus directory is readable." };
          },
          systemPrompt: `${intro}\n${AGENTIC_GUIDE}\n${ANSWER_FORMAT}`,
        },
        prompt: async (q) => q,
      };
    case "tools": {
      const filter = {
        from: z.string().optional().describe("substring of sender address or display name"),
        to: z.string().optional().describe("substring of a To or Cc address"),
        involves: z.string().optional().describe("substring of sender or any recipient address"),
        after: z.string().optional().describe("ISO date, inclusive"),
        before: z.string().optional().describe("ISO date, exclusive"),
        subjectContains: z.string().optional(),
      };
      const json = (v: unknown) => {
        const text = JSON.stringify(v);
        return { content: [{ type: "text" as const, text: text.length > TOOL_OUTPUT_CAP ? `${text.slice(0, TOOL_OUTPUT_CAP)}\n[output truncated: ${text.length - TOOL_OUTPUT_CAP} more chars. Narrow the query.]` : text }] };
      };
      const server = createSdkMcpServer({
        name: "corpus",
        version: "0.1.0",
        tools: [
          tool("search", "Ranked search. mode hybrid (default) fuses BM25 and embedding search with reciprocal rank fusion; keyword is BM25 only; semantic is embeddings only. k defaults to 10, max 50.", { query: z.string(), k: z.number().optional(), mode: z.enum(["hybrid", "keyword", "semantic"]).optional(), ...filter }, async ({ query: q, ...o }) => json(await corpus.search(q, o))),
          tool("grep", "Regex over the full text of every message, ripgrep syntax, case-insensitive unless caseSensitive. Returns totalFiles and the first limit hits (default 50, max 500).", { pattern: z.string(), limit: z.number().optional(), caseSensitive: z.boolean().optional(), ...filter }, async ({ pattern, ...o }) => json(await corpus.grep(pattern, o))),
          tool("messages", "Metadata query, no text matching. Sorted by date. limit defaults to 100, max 5000.", { ...filter, limit: z.number().optional() }, async (f) => json(corpus.messages(f))),
          tool("count", "Exact number of messages matching a metadata filter.", filter, async (f) => json(corpus.count(f))),
          tool("people", "Resolve a name or address fragment to sender addresses, most active first.", { nameOrEmail: z.string() }, async ({ nameOrEmail }) => json(corpus.people(nameOrEmail))),
          tool("read", "One full message, body capped at 20k chars.", { id: z.string() }, async ({ id }) => json(corpus.read(id))),
        ],
      });
      return {
        options: { ...baseOptions(model), tools: [], mcpServers: { corpus: server }, allowedTools: ["search", "grep", "messages", "count", "people", "read"].map((t) => `mcp__corpus__${t}`), systemPrompt: `${intro}\nUse the corpus tools to find the answer.\n${ANSWER_FORMAT}` },
        prompt: async (q) => q,
      };
    }
    case "codemode": {
      const lang = engine!.language === "python" ? "Python" : "JavaScript";
      const server = createSdkMcpServer({
        name: "corpus",
        version: "0.1.0",
        tools: [
          tool("execute", `Run ${lang} against the corpus API. What comes back is described in the system prompt.`, { code: z.string().describe(`${lang} source.`) }, async ({ code }) => ({
            content: [{ type: "text", text: await timedRun(engine!, code, corpus) }],
          })),
        ],
      });
      return {
        options: { ...baseOptions(model), tools: [], mcpServers: { corpus: server }, allowedTools: ["mcp__corpus__execute"], systemPrompt: `${intro}\n${engine!.guide}\n${ANSWER_FORMAT}` },
        prompt: async (q) => q,
      };
    }
  }
}

function parseFinal(text: string): { answer: string; sources: string[] } {
  const answer = [...text.matchAll(/^\s*\**ANSWER:?\**\s*:?\s*(.+)$/gim)].at(-1)?.[1]?.trim() ?? "";
  const srcLine = [...text.matchAll(/^\s*\**SOURCES:?\**\s*:?\s*(.+)$/gim)].at(-1)?.[1] ?? "";
  return { answer, sources: [...new Set(srcLine.match(/E[0-9a-f]{12}/g) ?? [])] };
}

export async function runStrategy(strategy: Strategy, question: string, corpus: Corpus, nMessages: number, model: string): Promise<RunResult> {
  const engine = strategy === "codemode" ? await getEngine() : undefined;
  const { options, prompt } = strategyOptions(strategy, corpus, nMessages, model, engine);
  const t0 = performance.now();
  const trace: RunResult["trace"] = [];
  const pending = new Map<string, number>();
  let finalText = "";
  let result: Extract<SDKMessage, { type: "result" }> | undefined;
  let error: string | undefined;
  try {
    for await (const msg of query({ prompt: await prompt(question), options })) {
      if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text") finalText = block.text;
          if (block.type === "tool_use") {
            pending.set(block.id, trace.length);
            trace.push({ tool: block.name, input: JSON.stringify(block.input).slice(0, 4000), resultChars: 0 });
          }
        }
      } else if (msg.type === "user" && Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (typeof block === "object" && block.type === "tool_result") {
            const i = pending.get(block.tool_use_id);
            const c = block.content;
            const chars = typeof c === "string" ? c.length : Array.isArray(c) ? c.reduce((n, p) => n + ("text" in p && typeof p.text === "string" ? p.text.length : 0), 0) : 0;
            if (i !== undefined) trace[i].resultChars = chars;
          }
        }
      } else if (msg.type === "result") {
        result = msg;
        if (msg.subtype === "success" && msg.result) finalText = msg.result;
        if (msg.subtype !== "success") error = msg.subtype;
      }
    }
  } catch (e) {
    error = String((e as Error).message ?? e).slice(0, 500);
  }
  const usage = result?.usage;
  return {
    ...parseFinal(finalText),
    finalText: finalText.slice(-3000),
    turns: result?.num_turns ?? 0,
    toolCalls: trace.length,
    toolResultChars: trace.reduce((n, t) => n + t.resultChars, 0),
    inputTokens: usage ? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) : 0,
    outputTokens: usage?.output_tokens ?? 0,
    costUsd: result?.total_cost_usd ?? 0,
    latencyMs: Math.round(performance.now() - t0),
    error,
    trace,
  };
}

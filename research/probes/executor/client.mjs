import { readFileSync } from "node:fs";
import { join } from "node:path";

const here = new URL(".", import.meta.url).pathname;
export const SRC = join(here, "../../impls/executor/src");
export const BASE = process.env.PROBE_EXECUTOR_URL ?? "http://127.0.0.1:4399";
export const KEY = JSON.parse(readFileSync(join(SRC, ".local/dev/keys.json"), "utf8")).apiKey;

const headers = (session) => ({
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(session ? { "mcp-session-id": session, "mcp-protocol-version": "2025-06-18" } : {}),
});

const parse = async (res) => {
  const text = await res.text();
  if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const messages = text
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => JSON.parse(line.slice(5)));
    return messages.find((m) => "result" in m || "error" in m) ?? messages.at(-1);
  }
  return text ? JSON.parse(text) : null;
};

let id = 0;
export const connect = async (query = "") => {
  const res = await fetch(`${BASE}/mcp${query}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
    }),
  });
  const session = res.headers.get("mcp-session-id");
  const init = await parse(res);
  await fetch(`${BASE}/mcp${query}`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const request = async (method, params, signal) =>
    parse(
      await fetch(`${BASE}/mcp${query}`, {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal,
      }),
    );
  return {
    init,
    session,
    request,
    tool: (name, args, signal) => request("tools/call", { name, arguments: args }, signal),
    execute: (code, signal) => request("tools/call", { name: "execute", arguments: { code } }, signal),
  };
};

export const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.text() };
};

import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DIR = process.env.HARDENED_DIR;
if (!DIR) throw new Error("set HARDENED_DIR to the directory hardened-start-server.sh used");
export const BASE = `http://127.0.0.1:${process.env.HARDENED_PORT ?? 41840}`;
export const KEY = readFileSync(join(DIR, "keys.env"), "utf8").match(/EXECUTOR_API_KEY=(\w+)/)[1];
export const SERVER_PID = Number(readFileSync(join(DIR, "server.pid"), "utf8"));

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
export const connect = async () => {
  const res = await fetch(`${BASE}/mcp`, {
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
  await parse(res);
  await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: headers(session),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  const request = async (method, params, signal) =>
    parse(
      await fetch(`${BASE}/mcp`, {
        method: "POST",
        headers: headers(session),
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal,
      }),
    );
  return {
    session,
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

export const deploy = async () => {
  const dir = new URL("./app/", import.meta.url).pathname;
  const files = ["index.ts", "package.json"].map((path) => ({ path, content: readFileSync(join(dir, path), "utf8") }));
  return api("POST", "/v1/apps/deploy", { owner: "executor-local", name: "probe", files });
};

// Minimal newline-delimited JSON-RPC MCP client over a child process's stdio.
import { spawn } from "node:child_process";

export class McpProc {
  constructor(cmd, args, opts = {}) {
    this.t0 = performance.now();
    this.proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], ...opts });
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = "";
    this.notifications = [];
    this.exited = null;
    let buf = "";
    this.proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { this.stderr += "[non-json stdout] " + line.slice(0, 500) + "\n"; continue; }
        if (msg.id !== undefined && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          p.resolve(msg);
        } else this.notifications.push(msg);
      }
    });
    this.proc.stderr.on("data", (d) => { this.stderr += d; if (this.stderr.length > 2e6) this.stderr = this.stderr.slice(-1e6); });
    this.proc.on("exit", (code, sig) => {
      this.exited = { code, sig, at: performance.now() };
      for (const p of this.pending.values()) p.resolve({ transportClosed: true, exit: this.exited });
      this.pending.clear();
    });
  }
  request(method, params, timeoutMs = 125000) {
    const id = this.nextId++;
    return new Promise((resolve) => {
      if (this.exited) return resolve({ transportClosed: true, exit: this.exited });
      const timer = setTimeout(() => { this.pending.delete(id); resolve({ harnessTimeout: true, ms: timeoutMs }); }, timeoutMs);
      this.pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m); } });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }
  notify(method, params) { this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); }
  async init() {
    const r = await this.request("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "asb-probe", version: "1" } }, 60000);
    this.notify("notifications/initialized", {});
    return r;
  }
  async call(name, args, timeoutMs) {
    const t = performance.now();
    const resp = await this.request("tools/call", { name, arguments: args }, timeoutMs);
    return { resp, ms: performance.now() - t };
  }
  kill() { if (!this.exited) this.proc.kill("SIGKILL"); }
}

import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool } from "@cloudflare/codemode/ai";
import { tool } from "ai";
import { z } from "zod";

interface Env {
  LOADER: WorkerLoader;
  PROBE_SECRET?: string;
}

let hostCalls = 0;

const tools = {
  lookup: tool({
    description: "Look up a value by id",
    inputSchema: z.object({ id: z.number() }),
    execute: async ({ id }: { id: number }) => {
      hostCalls++;
      await new Promise((r) => setTimeout(r, 200));
      return { id, value: id * 2 };
    }
  })
};

async function runTool(env: Env, code: string) {
  const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
  const codemode = createCodeTool({ tools, executor });
  try {
    const output = await codemode.execute!({ code }, { toolCallId: "probe", messages: [] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, thrown: err instanceof Error ? err.message : String(err) };
  }
}

async function runRaw(env: Env, code: string) {
  const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
  const { resolveProvider } = await import("@cloudflare/codemode/ai");
  return executor.execute(code, [resolveProvider({ tools })]);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/noop") return Response.json({ ok: true });
    if (url.pathname === "/description") {
      const executor = new DynamicWorkerExecutor({ loader: env.LOADER });
      return new Response(createCodeTool({ tools, executor }).description ?? "");
    }
    if (url.pathname === "/host-env") {
      return Response.json({ hostWorkerSeesProbeSecret: env.PROBE_SECRET ?? null });
    }
    if (url.pathname === "/run") {
      const { code, mode } = (await request.json()) as { code: string; mode: "tool" | "raw" };
      const before = hostCalls;
      const t0 = Date.now();
      const res = mode === "raw" ? await runRaw(env, code) : await runTool(env, code);
      return Response.json({ mode, res, hostCalls: hostCalls - before, hostMs: Date.now() - t0 });
    }
    if (url.pathname === "/bench") {
      const n = Number(url.searchParams.get("n") ?? 20);
      const times: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = Date.now();
        await runTool(env, "1+1");
        times.push(Date.now() - t0);
      }
      return Response.json({ times });
    }
    return new Response("not found", { status: 404 });
  }
};

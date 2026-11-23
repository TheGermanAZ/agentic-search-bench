import { DynamicWorkerExecutor } from "@cloudflare/codemode";
import { createCodeTool, resolveProvider } from "@cloudflare/codemode/ai";
import { tool } from "ai";
import { z } from "zod";

interface Env {
  LOADER: WorkerLoader;
  PROBE_SECRET?: string;
}

// Strictest public DynamicWorkerExecutor options (executor.ts:263-290, README.md:552-557).
// timeout is a free numeric knob; 10 s is our choice. globalOutbound null and no
// modules/bindings are the defaults, restated so the config is explicit.
const HARDENED = { timeout: 10_000, globalOutbound: null, modules: {}, bindings: {} } as const;

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

const executorFor = (env: Env) => new DynamicWorkerExecutor({ loader: env.LOADER, ...HARDENED });

// Supplementary only, NOT the hardened config: codemode exposes no way to pass the
// Worker Loader `limits` field, so this wraps the binding to see whether local
// workerd would enforce it at all.
function loaderWithLimits(env: Env, limits: { cpuMs?: number; subRequests?: number }): WorkerLoader {
  return {
    load: (code: WorkerLoaderWorkerCode) => env.LOADER.load({ ...code, limits }),
    get: (name: string | null, getCode: () => WorkerLoaderWorkerCode | Promise<WorkerLoaderWorkerCode>) =>
      env.LOADER.get(name, async () => ({ ...(await getCode()), limits }))
  } as WorkerLoader;
}

async function runTool(executor: DynamicWorkerExecutor, code: string) {
  const codemode = createCodeTool({ tools, executor });
  try {
    const output = await codemode.execute!({ code }, { toolCallId: "probe", messages: [] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, thrown: err instanceof Error ? err.message : String(err) };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/noop") return Response.json({ ok: true });
    if (url.pathname === "/config") return Response.json({ executorOptions: { loader: "env.LOADER", ...HARDENED } });
    if (url.pathname === "/host-env") {
      return Response.json({ hostWorkerSeesProbeSecret: env.PROBE_SECRET ?? null });
    }
    if (url.pathname === "/run" || url.pathname === "/run-loader-limits") {
      const { code, mode, cpuMs } = (await request.json()) as { code: string; mode: "tool" | "raw"; cpuMs?: number };
      const executor =
        url.pathname === "/run"
          ? executorFor(env)
          : new DynamicWorkerExecutor({ loader: loaderWithLimits(env, { cpuMs: cpuMs ?? 1000 }), ...HARDENED });
      const before = hostCalls;
      const t0 = Date.now();
      const res = mode === "raw" ? await executor.execute(code, [resolveProvider({ tools })]) : await runTool(executor, code);
      return Response.json({ mode, res, hostCalls: hostCalls - before, hostMs: Date.now() - t0 });
    }
    return new Response("not found", { status: 404 });
  }
};

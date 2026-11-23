// Runs one model-written program in quickjs-ng (quickjs-emscripten sync build), inside a worker thread the host can
// terminate. Corpus functions return QuickJS promises that the worker resolves when the host answers, then it drains
// the job queue, so `await Promise.all([...])` overlaps corpus calls.
import QuickJSNG from "@jitl/quickjs-ng-wasmfile-release-sync";
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSDeferredPromise, type QuickJSHandle } from "quickjs-emscripten";
import { parentPort } from "node:worker_threads";

const port = parentPort!;

export type ToWorker =
  | { type: "run"; code: string; file: string; names: string[]; wasm: WebAssembly.Module; memoryBytes: number; cpuMs: number; maxOutput: number }
  | { type: "result"; id: number; json: string };
export type FromWorker =
  | { type: "call"; id: number; name: string; args: string }
  | { type: "log"; text: string }
  | { type: "done"; error?: string; value?: string; dropped: number };

const WASM_PAGE = 64 * 1024;
/** Caps on what this worker forwards to the main thread, whatever the guest produced. */
const MAX_ARGS_CHARS = 1024 * 1024;
const MAX_ERROR_CHARS = 4000;
const post = (m: FromWorker) => port.postMessage(m);
const pending = new Map<number, (json: string) => void>();

port.on("message", async (msg: ToWorker) => {
  if (msg.type === "result") {
    const settle = pending.get(msg.id);
    pending.delete(msg.id);
    settle?.(msg.json);
    return;
  }

  // QuickJS's setMemoryLimit is not enforced in these WASM builds (no malloc_usable_size), so the cap is the
  // WebAssembly memory's maximum: the allocator cannot grow past it.
  const variant = newVariant(QuickJSNG, {
    wasmModule: msg.wasm,
    wasmMemory: new WebAssembly.Memory({ initial: (16 * 1024 * 1024) / WASM_PAGE, maximum: msg.memoryBytes / WASM_PAGE }),
  });
  const mod = await newQuickJSWASMModuleFromVariant(variant);
  const vm = mod.newContext();
  vm.runtime.setModuleLoader(() => {
    throw new Error("imports are disabled in this sandbox");
  });

  // Guest CPU: only time spent inside QuickJS counts, not time waiting for corpus calls.
  let used = 0;
  let sliceStart = 0;
  let inGuest = false;
  vm.runtime.setInterruptHandler(() => inGuest && used + (performance.now() - sliceStart) > msg.cpuMs);
  const inside = <T>(fn: () => T): T => {
    inGuest = true;
    sliceStart = performance.now();
    try {
      return fn();
    } finally {
      used += performance.now() - sliceStart;
      inGuest = false;
    }
  };

  // Output is counted as it is produced and stops at the cap, so a log flood cannot grow host memory.
  let sent = 0;
  let dropped = 0;
  const emit = (text: string) => {
    const line = `${text}\n`;
    const room = msg.maxOutput - sent;
    if (line.length > room) dropped += line.length - Math.max(room, 0);
    if (room <= 0) return;
    const part = line.slice(0, room);
    sent += part.length;
    post({ type: "log", text: part });
  };
  const show = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? String(v)));

  let finished = false;
  const finish = (m: Omit<Extract<FromWorker, { type: "done" }>, "type" | "dropped">) => {
    if (finished) return;
    finished = true;
    // The interrupt handler's InternalError is uncatchable in the guest; name the limit instead.
    if (m.error !== undefined && used > msg.cpuMs) m = { error: `stopped at the ${msg.cpuMs / 1000} s CPU limit. Do less per execution.` };
    const value = m.value?.slice(0, msg.maxOutput);
    if (m.value !== undefined && m.value.length > msg.maxOutput) dropped += m.value.length - msg.maxOutput;
    post({ type: "done", error: m.error?.slice(0, MAX_ERROR_CHARS), value, dropped });
  };
  const fault = (e: unknown) =>
    finish({ error: `the sandbox stopped this program (memory or time limit, or an engine fault): ${e instanceof Error ? e.message : String(e)}` });
  const describe = (h: QuickJSHandle) => {
    const e = vm.dump(h) as { name?: string; message?: string; stack?: string } | string;
    if (typeof e !== "object" || e === null) return `Uncaught ${show(e)}`;
    return `${e.name ?? "Error"}: ${e.message ?? ""}\n${e.stack ?? ""}`.trim();
  };

  let main: QuickJSHandle | undefined;
  // Runs queued promise jobs, then reports the program's outcome once its promise settles.
  const drive = () => {
    try {
      step();
    } catch (e) {
      fault(e);
    }
  };
  const step = () => {
    if (finished || !main) return;
    const jobs = inside(() => vm.runtime.executePendingJobs());
    if (jobs.error) {
      finish({ error: describe(jobs.error) });
      jobs.error.dispose();
      return;
    }
    const state = vm.getPromiseState(main);
    if (state.type === "fulfilled") {
      const v = vm.dump(state.value);
      if (!state.notAPromise) state.value.dispose();
      finish({ value: v === undefined ? undefined : show(v) });
    } else if (state.type === "rejected") {
      finish({ error: describe(state.error) });
      state.error.dispose();
    } else if (pending.size === 0) {
      finish({ error: "the program is waiting on a promise that nothing will settle" });
    }
  };

  try {
    const log = vm.newFunction("log", (...args) => emit(args.map((a) => show(vm.dump(a))).join(" ")));
    const con = vm.newObject();
    for (const k of ["log", "info", "warn", "error", "debug"]) vm.setProp(con, k, log);
    vm.setProp(vm.global, "console", con);
    log.dispose();
    con.dispose();

    let nextId = 0;
    const host = vm.newFunction("__host", (nameH, argsH) => {
      const id = nextId++;
      const deferred: QuickJSDeferredPromise = vm.newPromise();
      const args = vm.getString(argsH);
      if (args.length > MAX_ARGS_CHARS) {
        const err = vm.newError("corpus call arguments are too large");
        deferred.reject(err);
        err.dispose();
        return deferred.handle;
      }
      pending.set(id, (json) => {
        if (finished) return deferred.dispose();
        const s = vm.newString(json);
        deferred.resolve(s);
        s.dispose();
        drive();
      });
      post({ type: "call", id, name: vm.getString(nameH), args });
      return deferred.handle;
    });
    vm.setProp(vm.global, "__host", host);
    host.dispose();
    // The bridge is captured by the prelude and removed from globals, so guest code cannot call it with arbitrary names.
    const prelude = `(() => {
      const bridge = globalThis.__host;
      delete globalThis.__host;
      const api = {};
      for (const name of ${JSON.stringify(msg.names)}) {
        api[name] = async (...args) => {
          const r = JSON.parse(await bridge(name, JSON.stringify(args)));
          if (r && r.__error) throw new Error(r.__error);
          return r;
        };
      }
      globalThis.corpus = Object.freeze(api);
    })();`;
    inside(() => vm.unwrapResult(vm.evalCode(prelude))).dispose();

    // An async function body: top-level await works and `return x` prints x. One wrapper line precedes the model's code.
    const result = inside(() => vm.evalCode(`(async () => {\n${msg.code}\n})()`, msg.file));
    if (result.error) {
      finish({ error: describe(result.error) });
      result.error.dispose();
    } else {
      main = result.value;
      drive();
    }
  } catch (e) {
    // At the memory cap QuickJS can fail inside its own error path and throw a null or a WebAssembly trap.
    fault(e);
  }
});

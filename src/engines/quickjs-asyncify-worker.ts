// Runs one model-written program in QuickJS, inside a worker thread that the host can terminate.
// The host (src/sandbox.ts) owns the corpus, the wall-clock deadline and the output cap; this side owns the guest.
import { stripAwait } from "../strip-await";
import { newQuickJSAsyncWASMModuleFromVariant, newVariant, RELEASE_ASYNC, shouldInterruptAfterDeadline } from "quickjs-emscripten";

import { parentPort } from "node:worker_threads";

const port = parentPort!;

export type ToWorker =
  | { type: "run"; code: string; names: string[]; wasm: WebAssembly.Module; memoryBytes: number; cpuMs: number; maxOutput: number }
  | { type: "result"; id: number; json: string };
export type FromWorker =
  | { type: "call"; id: number; name: string; args: string }
  | { type: "log"; text: string }
  | { type: "done"; error?: string; value?: string; dropped: number };

const WASM_PAGE = 64 * 1024;
const pending = new Map<number, (json: string) => void>();
let nextId = 0;
const post = (m: FromWorker) => port.postMessage(m);

port.on("message", async (msg: ToWorker) => {
  if (msg.type === "result") {
    pending.get(msg.id)?.(msg.json);
    pending.delete(msg.id);
    return;
  }
  // QuickJS's setMemoryLimit is inert in this WASM build, so the cap is the WebAssembly memory's maximum.
  const variant = newVariant(RELEASE_ASYNC, {
    wasmModule: msg.wasm,
    wasmMemory: new WebAssembly.Memory({ initial: (16 * 1024 * 1024) / WASM_PAGE, maximum: msg.memoryBytes / WASM_PAGE }),
  });
  const mod = await newQuickJSAsyncWASMModuleFromVariant(variant);
  const vm = mod.newContext();
  vm.runtime.setModuleLoader(() => {
    throw new Error("imports are disabled in this sandbox");
  });
  vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + msg.cpuMs));

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
  const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 0) ?? String(v));
  let done: FromWorker = { type: "done", dropped: 0 };
  try {
    const log = vm.newFunction("log", (...args) => emit(args.map((a) => show(vm.dump(a))).join(" ")));
    const con = vm.newObject();
    vm.setProp(con, "log", log);
    vm.setProp(con, "error", log);
    vm.setProp(vm.global, "console", con);
    log.dispose();
    con.dispose();
    // The bridge is captured by the prelude and then removed from globals, so guest code cannot call it with arbitrary names.
    const host = vm.newAsyncifiedFunction("__host", async (nameH, argsH) => {
      const id = nextId++;
      const reply = new Promise<string>((resolve) => pending.set(id, resolve));
      post({ type: "call", id, name: vm.getString(nameH), args: vm.getString(argsH) });
      return vm.newString(await reply);
    });
    vm.setProp(vm.global, "__host", host);
    host.dispose();
    const prelude = `(() => {
      const bridge = globalThis.__host;
      delete globalThis.__host;
      const api = {};
      for (const name of ${JSON.stringify(msg.names)}) {
        api[name] = (...args) => {
          const r = JSON.parse(bridge(name, JSON.stringify(args)));
          if (r && r.__error) throw new Error(r.__error);
          return r;
        };
      }
      globalThis.corpus = Object.freeze(api);
    })();`;
    vm.unwrapResult(vm.evalCode(prelude)).dispose();

    // The corpus API is synchronous inside the sandbox, so `await` keywords are removed outside strings and comments.
    const result = await vm.evalCodeAsync(stripAwait(msg.code));
    if (result.error) {
      const e = vm.dump(result.error) as { message?: string; stack?: string } | string;
      done = { type: "done", error: typeof e === "string" ? e : `${e.message ?? ""}\n${e.stack ?? ""}`.trim(), dropped };
      result.error.dispose();
    } else {
      const v = vm.dump(result.value);
      done = { type: "done", value: v === undefined ? undefined : show(v), dropped };
      result.value.dispose();
    }
  } catch (e) {
    // At the memory cap QuickJS can fail inside its own error path and throw a null or a WebAssembly trap.
    done = { type: "done", error: `the sandbox stopped this program (memory or time limit, or an engine fault): ${e instanceof Error ? e.message : String(e)}`, dropped };
  }
  post(done);
});


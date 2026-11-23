// Runs SPEC.md probes against OpenCode 2.3.2 Code Mode with fixed code, no model.
// Copied into packages/core/probe/ by run.sh so `@opencode/core/*` and `@opencode/codemode` resolve to the pinned clone.
//   mode "default":  OpenCode's real `execute` tool (CodeModeTool.create), as Tool.snapshot builds it, permission allow.
//   mode "deny":     the same tool with every permission assert failing, as a `webfetch` deny rule does.
//   mode "hardened": @opencode/codemode public API, CodeMode.make({ tools, limits }), no extensions.
// Usage: bun probe/harness.ts <mode> <probe>
import { CodeModeTool } from "@opencode/core/codemode/tool"
import { Permission } from "@opencode/core/permission"
import { Tool as CoreTool } from "@opencode/core/tool"
import { execute as runTool } from "@opencode/core/tool/runtime"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import type { Info } from "@opencode/schema/tool"
import { CodeMode, Tool } from "@opencode/codemode"
import { Effect, Fiber, Layer, Schema } from "effect"

const [mode, probe] = process.argv.slice(2)
const HARDENED_LIMITS = { timeoutMs: 30_000, maxToolCalls: 20, maxOutputBytes: 32 * 1024 }

let hostCalls = 0
const LookupIn = Schema.Struct({ id: Schema.Number })
const LookupOut = Schema.Struct({ id: Schema.Number, value: Schema.Number })
const lookupEffect = (id: number) =>
  Effect.sync(() => void hostCalls++).pipe(
    Effect.andThen(Effect.sleep("200 millis")),
    Effect.as({ id, value: id * 2 }),
  )

// The documented base policy (https://opencode.ai/docs/permissions/), evaluated with OpenCode's own Permission.evaluate.
// "deny" mode appends the rule a user writes to block web access.
const BASE_POLICY = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
  { action: "read", resource: "*.env.*", effect: "ask" },
  { action: "read", resource: "*.env.example", effect: "allow" },
] as const
const DENY_WEBFETCH = [...BASE_POLICY, { action: "webfetch", resource: "*", effect: "deny" }] as const

const permission = (rules: ReadonlyArray<any>) => {
  const check = (input: { action: string; resources: ReadonlyArray<string> }) => {
    const denied = input.resources.some((r) => Permission.evaluate(input.action, r, rules as any).effect === "deny")
    return denied
      ? Effect.fail(
          new Permission.BlockedError({
            rules: rules.filter((rule) => rule.action === input.action) as any,
            permission: input.action,
            resources: [...input.resources],
          }) as never,
        )
      : Effect.void
  }
  return Effect.runSync(
    Effect.gen(function* () {
      return yield* Permission.Service
    }).pipe(
      Effect.provide(
        Layer.mock(Permission.Service, {
          close: Effect.void,
          nested: () => Effect.void,
          assert: check as any,
          assertNotDenied: check as any,
        }),
      ),
    ),
  )
}

const context = {
  sessionID: Session.ID.make("ses_probe"),
  agent: Agent.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_probe"),
  id: CoreTool.CallID.make("call_probe"),
  progress: () => Effect.void,
}

let lastFull: any
type Runner = { setupMs: number; run: (code: string) => Promise<unknown> }

function makeRunner(): Runner {
  const t0 = performance.now()
  if (mode === "hardened") {
    const lookup = Tool.make({
      description: "Look up a value by id",
      input: LookupIn,
      output: LookupOut,
      execute: ({ id }) => lookupEffect(id),
    })
    const runtime = CodeMode.make({ tools: { lookup }, limits: HARDENED_LIMITS })
    void runtime.catalog // README shows catalog() but it is an array property at v2.3.2
    return { setupMs: performance.now() - t0, run: (code) => Effect.runPromise(runtime.execute(code)) }
  }
  const lookup: Info = {
    name: "lookup",
    description: "Look up a value by id",
    input: LookupIn,
    output: LookupOut,
    execute: ({ id }: { id: number }) => lookupEffect(id).pipe(Effect.map((output) => ({ output }))),
  }
  const inventory = { tools: new Map<string, Info>([["lookup", lookup]]) }
  const tool = CodeModeTool.create(
    inventory,
    (_name, info, input, ctx) => runTool(info, input, ctx),
    permission(mode === "deny" ? DENY_WEBFETCH : BASE_POLICY),
  )
  CodeModeTool.catalog(inventory)
  return {
    setupMs: performance.now() - t0,
    run: async (code) => {
      const result = await Effect.runPromise(tool.execute({ code }, context) as Effect.Effect<any>)
      lastFull = result
      return result.output
    },
  }
}

const runner = makeRunner()

// What a session step does to every tool result before the model sees it (core/src/session/runner/step.ts:152),
// using OpenCode's ToolOutput service with its data directory under this probe's out/ folder.
async function sessionTruncate(full: any) {
  const { AppNodeBuilder } = await import("@opencode/core/effect/app-node-builder")
  const { LayerNode } = await import("@opencode/util/effect/layer-node")
  const { ToolOutput } = await import("@opencode/core/tool-output")
  const { FSUtil } = await import("@opencode/util/fs-util")
  const { Global } = await import("@opencode/util/global")
  const data = process.env.PROBE_DATA_DIR!
  const layer = AppNodeBuilder.build(LayerNode.group([ToolOutput.node, FSUtil.node]), [
    Global.node.replace(Global.layerWith({ data })),
  ])
  const bounded: any = await Effect.runPromise(
    Effect.gen(function* () {
      const output = yield* ToolOutput.Service
      return yield* output.truncate({ output: full.output, content: full.content, metadata: full.metadata })
    }).pipe(Effect.provide(layer), Effect.scoped) as Effect.Effect<any>,
  )
  const text = bounded.content.flatMap((p: any) => (p.type === "text" ? [p.text] : [])).join("\n")
  return {
    chars: text.length,
    bytes: Buffer.byteLength(text),
    longestRunOfA: (text.match(/A+/g) ?? []).reduce((m: number, x: string) => Math.max(m, x.length), 0),
    returnedVisible: text.includes("RETURNED"),
    tail: text.slice(-260).replace(data, "<data>"),
  }
}

async function timed(code: string) {
  const before = hostCalls
  const t = performance.now()
  try {
    const result = await runner.run(code)
    return { code, ms: +(performance.now() - t).toFixed(2), hostCalls: hostCalls - before, result }
  } catch (error) {
    return { code, ms: +(performance.now() - t).toFixed(2), hostCalls: hostCalls - before, threw: String(error) }
  }
}

function summarize(value: unknown): unknown {
  const text = JSON.stringify(value)
  if (text.length <= 20000) return value
  return { summarizedBecauseChars: text.length, head: text.slice(0, 1500), tail: text.slice(-1500) }
}

const probes: Record<string, () => Promise<unknown>> = {
  P1: () => timed(`const r = await tools.lookup({id: 21}); console.log(r.value)`),
  P2: async () => {
    const out: any[] = []
    for (const code of [`console.log("A".repeat(200000)); "RETURNED"`, `console.log("A".repeat(200000)); return "RETURNED"`]) {
      const r: any = await timed(code)
      const r2 = r.result ?? {}
      const text: string = typeof r2.output === "string" ? r2.output : JSON.stringify(r2.logs ?? "")
      const value = mode === "hardened" ? r2.value : undefined
      const aRun = (text.match(/A+/g) ?? []).reduce((m: number, s: string) => Math.max(m, s.length), 0)
      out.push({
        code,
        ms: r.ms,
        ok: mode === "hardened" ? r2.ok : !r2.error,
        returnedVisible: (mode === "hardened" ? JSON.stringify(value) : text).includes("RETURNED"),
        longestRunOfA: aRun,
        totalChars: text.length,
        truncatedFlag: r2.truncated,
        warnings: r2.warnings,
        outputHead: text.slice(0, 200),
        outputTail: text.slice(-300),
        ...(mode === "hardened" ? {} : { sessionView: await sessionTruncate(lastFull) }),
      })
    }
    return out
  },
  P3: async () => [
    await timed(`const r = await fetch("https://example.com"); return { status: r.status, len: (await r.text()).length }`),
    await timed(`return typeof fetch`),
  ],
  P4: async () => [
    await timed(`return require("fs").readFileSync("/etc/hosts","utf8")`),
    await timed(`const fs = await import("fs"); return fs.readFileSync("/etc/hosts","utf8")`),
    await timed(`return await Deno.readTextFile("/etc/hosts")`),
    await timed(`return await (await fetch("file:///etc/hosts")).text()`),
    await timed(`return [typeof require, typeof Bun, typeof Deno, typeof path, typeof fs]`),
  ],
  P5: async () => [
    await timed(`return process.env.PROBE_SECRET`),
    await timed(`return typeof process`),
  ],
  P6: async () => {
    let ticks = 0
    const tick = setInterval(() => ticks++, 1000)
    const t = performance.now()
    const fiber = Effect.runFork(Effect.promise(() => timed(`while (true) {}`)))
    // A second execution started while the loop runs shows whether the shared host stays usable.
    await new Promise((r) => setTimeout(r, 5000))
    const side = await timed(`1+1`)
    const winner = await Promise.race([
      Effect.runPromise(Fiber.join(fiber)).then((r) => ({ stopped: "by-implementation", r })),
      new Promise((r) => setTimeout(() => r({ stopped: "harness-120s" }), 115_000)),
    ])
    const wallMs = +(performance.now() - t).toFixed(0)
    if ((winner as any).stopped === "harness-120s") await Effect.runPromise(Fiber.interrupt(fiber))
    clearInterval(tick)
    return { winner, wallMs, hostTimerTicksDuringLoop: ticks, concurrentExecutionDuringLoop: side }
  },
  P7: () => timed(`const a = []; while (true) a.push("x".repeat(1e6))`),
  P8: async () => [
    await timed(`globalThis.kept = 7`),
    await timed(`console.log(typeof kept === "undefined" ? "gone" : kept)`),
    await timed(`var kept = 7`),
    await timed(`console.log(typeof kept === "undefined" ? "gone" : kept)`),
    await timed(`kept = 7`),
    await timed(`console.log(typeof kept === "undefined" ? "gone" : kept)`),
  ],
  P9: () =>
    timed(`const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.lookup({id:i}))); console.log(Date.now()-t)`),
  P10: async () => [
    await timed(`throw new Error("probe-boom")`),
    await timed(`const a = 1\nconst b = 2\nthrow new Error("probe-boom")`),
    await timed(`await tools.lookup({id: "x"})`),
  ],
  P11: async () => {
    const times: number[] = []
    for (let i = 0; i < 20; i++) times.push((await timed(`1+1`)).ms)
    const sorted = [...times].sort((a, b) => a - b)
    return {
      setupMs: +runner.setupMs.toFixed(2),
      timesMs: times,
      medianMs: (sorted[9] + sorted[10]) / 2,
      p90Ms: sorted[17],
    }
  },
  P12: async () => [
    await timed(`return this.constructor.constructor("return process")()`),
    await timed(`return (function(){return this})().process`),
    await timed(`return [].constructor.constructor("return process")()`),
    await timed(`return Function("return process")()`),
    await timed(`return eval("process")`),
    await timed(`return typeof globalThis + ":" + Object.keys(globalThis).join(",")`),
    await timed(`return tools.lookup.constructor("return process")()`),
    await timed(`return console.log.constructor("return process")()`),
    await timed(`const p = tools.lookup({id:1}); return p.constructor.constructor("return process")()`),
    await timed(`const o = await tools.lookup({id:1}); return o.constructor.constructor("return process")()`),
    await timed(`return Object.getPrototypeOf(tools).constructor.constructor("return process")()`),
    await timed(`const cp = require("child_process"); return cp.execSync("echo PWNED").toString()`),
    await timed(`({}).__proto__.polluted = "yes"; return ({}).polluted`),
    await timed(`const r = await fetch("https://example.com"); return r.text.constructor("return process")()`),
    await timed(`const r = await fetch("https://example.com"); return r.constructor.constructor("return process")()`),
    await timed(`const r = await fetch("https://example.com"); return [typeof r.body, Object.keys(r), typeof r.headers.constructor]`),
  ],
}

// A canary on the host realm: P12 checks whether anything in it leaks into programs.
;(globalThis as any).__HOST_CANARY = "host"
const result = await probes[probe]()
console.log(
  JSON.stringify(
    {
      mode,
      probe,
      runtime: `bun ${Bun.version}`,
      hostCallsTotal: hostCalls,
      hostPolluted: (({}) as any).polluted ?? null,
      result: summarize(result),
    },
    null,
    2,
  ),
)
process.exit(0)

import { http, HttpResponse, delay } from 'msw'
import { beforeEach, describe, it } from 'vitest'
import { API_BASE, cfSuccess, mockIdentityProbe } from './helpers/cloudflare-api'
import { callTool } from './helpers/mcp'
import { server } from './setup/msw'

const ACCOUNT_ID = '00000000000000000000000000000001'
const API_TOKEN = 'probe-dummy-token'
let hostCalls = 0

function emit(id: string, data: unknown) {
  console.log(`PROBE_RESULT ${JSON.stringify({ id, data })}`)
}

async function call(tool: 'execute' | 'search', code: string) {
  const before = hostCalls
  const t0 = Date.now()
  const res = await callTool(API_TOKEN, tool, { code })
  return {
    tool,
    code,
    ms: Date.now() - t0,
    hostCalls: hostCalls - before,
    isError: res.result?.isError ?? false,
    text: res.result?.content?.map((c) => c.text).join('\n') ?? null,
    rpcError: res.error ?? null
  }
}

const brief = (r: Awaited<ReturnType<typeof call>>) => ({ ...r, textChars: r.text?.length, text: r.text && r.text.length > 2000 ? r.text.slice(0, 1000) + ' ...[harness elided]... ' + r.text.slice(-500) : r.text })

beforeEach(() => {
  mockIdentityProbe({ accounts: [{ id: ACCOUNT_ID, name: 'Acc' }] })
  server.use(
    http.get(`${API_BASE}/lookup/:id`, async ({ params }) => {
      hostCalls++
      await delay(200)
      const id = Number(params.id)
      return HttpResponse.json(cfSuccess({ id, value: id * 2 }))
    })
  )
})

const LOOKUP = (id: string) => `cloudflare.request({ method: "GET", path: "/lookup/" + ${id} })`

describe('cloudflare-codemode-mcp probes', { timeout: 120_000 }, () => {
  it('P1', async () => {
    emit('P1', {
      specCode: await call('execute', `async () => { const r = await ${LOOKUP('21')}; console.log(r.result.value) }`),
      returnVariant: await call('execute', `async () => { const r = await ${LOOKUP('21')}; return r.result.value }`)
    })
  })
  it('P2', async () => {
    const exec = await call('execute', `async () => { console.log("A".repeat(200000)); return "RETURNED" }`)
    const big = await call('execute', `async () => "A".repeat(200000)`)
    const bareSpecForm = await call('execute', `console.log("A".repeat(200000)); "RETURNED"`)
    emit('P2', { exec: brief(exec), bigReturn: brief(big), bareSpecForm: brief(bareSpecForm), search: brief(await call('search', `async () => { console.log("A".repeat(200000)); return "RETURNED" }`)) })
  })
  it('P3', async () => {
    emit('P3', {
      execute: await call('execute', `async () => { const r = await fetch("https://example.com"); return { status: r.status, body: await r.text() } }`),
      search: await call('search', `async () => { const r = await fetch("https://example.com"); return r.status }`)
    })
  })
  it('P4', async () => {
    const out: Record<string, unknown> = {}
    for (const tool of ['execute', 'search'] as const) {
      out[`${tool}_require`] = await call(tool, `async () => require("fs").readFileSync("/etc/hosts","utf8")`)
      out[`${tool}_importNodeFs`] = await call(tool, `async () => { const fs = await import("node:fs"); return fs.readFileSync("/etc/hosts","utf8") }`)
      out[`${tool}_deno`] = await call(tool, `async () => Deno.readTextFile("/etc/hosts")`)
    }
    emit('P4', out)
  })
  it('P5', async () => {
    const code = `async () => ({ processType: typeof process, env: typeof process === "undefined" ? null : process.env?.PROBE_SECRET ?? Object.keys(process.env ?? {}), globalSecret: globalThis.PROBE_SECRET ?? null, thisEnvKeys: Object.keys(globalThis.env ?? {}) })`
    emit('P5', { execute: await call('execute', code), search: await call('search', code) })
  })
  it('P8', async () => {
    emit('P8', {
      execute: [await call('execute', `async () => { globalThis.kept = 7; return 7 }`), await call('execute', `async () => typeof kept === "undefined" ? "gone" : kept`)],
      search: [await call('search', `async () => { globalThis.kept = 7; return 7 }`), await call('search', `async () => typeof kept === "undefined" ? "gone" : kept`)]
    })
  })
  it('P9', async () => {
    emit('P9', await call('execute', `async () => { const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => ${LOOKUP('i')})); return Date.now() - t }`))
  })
  it('P10', async () => {
    emit('P10', {
      execute: await call('execute', `async () => { throw new Error("probe-boom") }`),
      search: await call('search', `async () => { throw new Error("probe-boom") }`),
      syntaxError: await call('execute', `async () => { this is not js }`)
    })
  })
  it('P11', async () => {
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b)
      return { raw: xs, median: s[Math.floor(s.length / 2)], p90: s[Math.floor(s.length * 0.9)] }
    }
    const exec: number[] = []
    const search: number[] = []
    for (let i = 0; i < 20; i++) exec.push((await call('execute', `async () => 1+1`)).ms)
    for (let i = 0; i < 20; i++) search.push((await call('search', `async () => 1+1`)).ms)
    emit('P11', { executeMs: stats(exec), searchMs: stats(search), note: 'ms per full MCP tools/call through the real worker (auth, MCP transport, sandbox), Date.now() in workerd' })
  })
  it('P12', async () => {
    const report = `p === undefined ? "undefined" : { type: typeof p, platform: p.platform, envKeys: Object.keys(p.env ?? {}) }`
    const out: Record<string, unknown> = {}
    for (const tool of ['execute', 'search'] as const) {
      out[`${tool}_functionConstructor`] = await call(tool, `async () => { const p = this.constructor.constructor("return process")(); return ${report} }`)
      out[`${tool}_sloppyThis`] = await call(tool, `async () => { const p = (function(){return this})().process; return ${report} }`)
      out[`${tool}_thisShape`] = await call(tool, `async () => ({ thisType: typeof this, ctor: this?.constructor?.name ?? null })`)
    }
    emit('P12', out)
  })
})

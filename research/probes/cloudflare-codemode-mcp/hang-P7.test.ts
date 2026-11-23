import { it } from 'vitest'
import { mockIdentityProbe } from './helpers/cloudflare-api'
import { callTool } from './helpers/mcp'

it('P7', { timeout: 125_000 }, async () => {
  mockIdentityProbe({ accounts: [{ id: '00000000000000000000000000000001', name: 'Acc' }] })
  const t0 = Date.now()
  const res = await callTool('probe-dummy-token', '__TOOL__', { code: `async () => { const a = []; while (true) a.push("x".repeat(1e6)) }` })
  console.log('PROBE_RESULT ' + JSON.stringify({ id: 'P7___TOOL__', data: { ms: Date.now() - t0, res } }))
})

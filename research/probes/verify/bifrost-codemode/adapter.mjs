// Bifrost MCP gateway Code Mode (Starlark), maximhq/bifrost:v2.6.0 in Docker. Same entry point as the worker
// harness (research/probes/bifrost-codemode/config.mjs + docker-mcp-gateway-codemode/lib): an MCP client calls
// Bifrost's own /mcp endpoint `executeToolCode` with the local virtual key.
// Shared instance: ONE gateway container (bifrost-codemode-verify, 127.0.0.1:42410), restarted in make() so every
// test starts from a fresh gateway; each execution opens its own MCP client session (a separate user).
// Host tools: an HTTP MCP server inside this process on 127.0.0.1:42411 (Bifrost's MCP client `probe` points at
// host.docker.internal:42411), so rcore's host counters see every call. It must be up before the gateway starts.
// Guest language is Starlark: no async, no try/except, no regex, no promises. The JS test codes are replaced with
// Starlark of the same intent through extraTests; R4, R7a, R9d have no Starlark form (notApplicable).
import http from 'node:http';
import { execFileSync, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const NM = fileURLToPath(new URL('../../bifrost-codemode/node_modules/', import.meta.url));
const req = createRequire(NM);
const { McpServer } = await import(req.resolve('@modelcontextprotocol/sdk/server/mcp.js'));
const { StreamableHTTPServerTransport } = await import(req.resolve('@modelcontextprotocol/sdk/server/streamableHttp.js'));
const { Client } = await import(req.resolve('@modelcontextprotocol/sdk/client/index.js'));
const { StreamableHTTPClientTransport } = await import(req.resolve('@modelcontextprotocol/sdk/client/streamableHttp.js'));
const { z } = await import(req.resolve('zod'));
const NAME = 'bifrost-codemode-verify';

function toolServer(host) {
  const srv = http.createServer(async (rq, res) => {
    if (!rq.url.startsWith('/mcp')) { res.writeHead(404).end(); return; }
    let body = '';
    for await (const c of rq) body += c;
    const s = new McpServer({ name: 'probe', version: '1.0.0' });
    const wrap = (fn) => async (args) => {
      const v = await fn(args); // a host throw becomes an MCP isError result inside the SDK
      let text; try { text = JSON.stringify(v); } catch { text = String(v); }
      return { content: [{ type: 'text', text: text ?? String(v) }] };
    };
    s.registerTool('lookup', { description: 'Look up a record by id. Returns {id, value}.', inputSchema: { id: z.number() } }, wrap(({ id }) => host.lookup(id)));
    s.registerTool('failing', { description: 'Always fails.', inputSchema: {} }, wrap(() => host.failing()));
    s.registerTool('rich', { description: 'Returns a rich object.', inputSchema: {} }, wrap(() => host.rich()));
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { t.close(); s.close(); });
    await s.connect(t);
    await t.handleRequest(rq, res, body ? JSON.parse(body) : undefined);
  });
  return new Promise((r) => srv.listen(42411, '127.0.0.1', () => r(srv)));
}

const containerRssMb = () => new Promise((resolve) => {
  execFile('docker', ['exec', NAME, 'sh', '-c', 'grep VmRSS /proc/$(pgrep -f /app/main | head -1)/status'], { timeout: 5000 }, (e, out) => {
    const m = String(out ?? '').match(/(\d+)/); resolve(e || !m ? null : Math.round(Number(m[1]) / 1024));
  });
});

const ST = {
  call: (a) => `probe.lookup(${a})`,
  LOOP: 'while True:\n    pass',
  BOMB: 'a = []\nwhile True:\n    a.append("x" * 1000000)',
  FLOOD: 'while True:\n    print("x" * 1000000)',
};

export default async (config, host) => {
  const srv = await toolServer(host);
  const g0 = Date.now();
  await new Promise((res, rej) => execFile(`${HERE}start-gateway.sh`, [config === 'hardened' ? 'data-hardened' : 'data'], (e, o, er) => (e ? rej(new Error(String(er))) : res())));
  const gatewayStartMs = Date.now() - g0;
  // Container memory sampler: peak VmRSS of the gateway process; docker kill at 4 GB (container also has --memory=4g).
  let peakMb = 0, lastMb = null, killed = null;
  const samples = [];
  const t0 = Date.now();
  let sampling = true;
  (async () => {
    while (sampling) {
      const mb = await containerRssMb();
      if (mb != null) { lastMb = mb; peakMb = Math.max(peakMb, mb); if (samples.length < 400) samples.push([Date.now() - t0, mb]); }
      if (mb != null && mb > 4096 && !killed) { killed = { atMs: Date.now() - t0, mb }; try { execFileSync('docker', ['kill', NAME]); } catch {} }
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  const baselineMb = await containerRssMb();

  async function exec(code) {
    const client = new Client({ name: 'verify', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:42410/mcp'), { requestInit: { headers: { 'x-bf-vk': 'sk-bf-probe-local-only' } } }));
    try {
      const r = await client.callTool({ name: 'executeToolCode', arguments: { code } }, undefined, { timeout: 115_000, maxTotalTimeout: 115_000 });
      const text = (r.content ?? []).map((c) => (c.type === 'text' ? c.text : JSON.stringify(c))).join('\n');
      return { isError: !!r.isError, textChars: text.length, text };
    } finally { client.close().catch(() => {}); }
  }

  const na = (why) => async () => ({ notApplicable: why });
  return {
    name: 'bifrost-codemode', T: 'probe.lookup', F: 'probe.failing', R: 'probe.rich', ret: false,
    normalCode: `r = ${ST.call('id=21')}\nresult = r["value"]`,
    notes: `maximhq/bifrost:v2.6.0, ${config === 'hardened' ? 'data-hardened' : 'data'}/config.json; gateway restarted for this test (${gatewayStartMs} ms); new MCP client per execution; Starlark codes`,
    exec,
    stats: async () => { sampling = false; return { gatewayStartMs, containerBaselineMb: baselineMb, containerPeakMb: peakMb, containerLastMb: lastMb, containerKilled: killed, containerRssMsMb: samples.filter((_, i) => i % Math.max(1, Math.ceil(samples.length / 60)) === 0) }; },
    close: async () => { srv.close(); },
    extraTests: ({ timed, capped, state, sleep, neighbor }) => ({
      R1: async () => ({ A: await timed('leftover = "A-secret"\nresult = "set"', 'A'), B: await timed('result = leftover', 'B') }),
      R1c: async () => {
        const pA = timed(`leftC = "A-secret"\nr1 = ${ST.call('id=1')}\nr2 = ${ST.call('id=2')}\nresult = "A done"`, 'A');
        await sleep(100);
        const B = await timed('result = leftC', 'B(concurrent)');
        return { A: await pA, B };
      },
      R2a: async () => timed(`r = ${ST.call('id=1')}\nresult = [type(r), dir(r), type(probe), dir(probe), type(probe.lookup), dir(probe.lookup), dir(json), dir(math)]`),
      R2b: async () => timed('r = probe.failing()\nresult = [type(r), str(r), dir(r)]'),
      R2c: async () => timed('r = probe.rich()\nresult = [type(r), str(r)]'),
      R3: async () => ({
        A: await timed('def f(n):\n    return f(n + 1) + 1\nresult = f(0)', 'recursion'),
        deep: await timed('root = []\nx = root\nfor i in range(100000):\n    y = []\n    x.append(y)\n    x = y\nresult = root', 'deep-return'),
        after: await timed('result = "alive"', 'after'),
      }),
      R4: na('no regex module in Starlark'),
      R5: async () => {
        const r = await capped(timed(`rs = [${ST.call('id=i')} for i in range(2000)]\nresult = len(rs)`), 'R5');
        const atReturn = { ...state };
        await sleep(3000);
        return { r, atReturn, after3s: { ...state } };
      },
      R6: async () => capped(timed(`r = ${ST.call('id=1')}\n${ST.LOOP}`), 'R6'),
      R7a: na('Starlark has no promises or async; nothing can wait without a tool call'),
      R7b: async () => {
        const r = await capped(timed(`rs = [${ST.call('id=i')} for i in range(5)]\n${ST.LOOP}`), 'R7b');
        const atReturn = { ...state };
        await sleep(1500);
        const after = await timed(`r = ${ST.call('id=21')}\nresult = r["value"]`, 'after');
        return { r, atReturn, after1500ms: { ...state }, after };
      },
      R8a: async () => timed('print("x" * (20 * 1024 * 1024))\nresult = "done"'),
      R8b: async () => timed('result = "y" * (20 * 1024 * 1024)'),
      R9a: async () => neighbor(ST.LOOP),
      R9b: async () => neighbor(ST.BOMB),
      R9c: async () => neighbor(ST.FLOOD),
      R9d: na('no regex module in Starlark'),
      R9e: async () => neighbor(ST.LOOP, 8),
      // Extra: recursion is allowed (sandbox.go:170 Recursion: true) and one deep recursion took the gateway from
      // 240 to 650 MB RSS (default-R3). Eight at once, with a neighbor, on the same gateway:
      R9f: async () => neighbor('def f(n):\n    return f(n + 1) + 1\nresult = f(0)', 8),
      // 8 took the gateway to 3.4 GB (default-R9f); 12 at once against the container's 4 GB cgroup limit:
      R9g: async () => neighbor('def f(n):\n    return f(n + 1) + 1\nresult = f(0)', 12),
    }),
  };
};

// OpenClaw Code Mode, QuickJS executor (openclaw@2026.11.6). Same entry points as the worker harness
// (research/probes/openclaw-codemode-node-vm/probe.mjs): createCodeModeTools + applyCodeModeCatalog from the
// published dist, then the model-facing `exec` tool, following `waiting` with the `wait` tool as a model would.
// Shared instance: ONE LegacyPluginSdkResourceHost bound to ONE GatewayScheduler (as the Gateway runs cells, so
// the QuickJS worker pool is shared). Each execution is a separate session (own sessionId, catalog and exec/wait
// tools), i.e. a different user of the same Gateway process.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../../../impls/openclaw-codemode-node-vm/npm/node_modules/openclaw/dist', import.meta.url));
const STATE = fileURLToPath(new URL('./state', import.meta.url));
mkdirSync(STATE, { recursive: true });
// Same isolation as openclaw-codemode-node-vm/env.sh: OpenClaw state/config live in this folder.
Object.assign(process.env, { HOME: STATE, OPENCLAW_HOME: STATE, OPENCLAW_STATE_DIR: `${STATE}/state`, OPENCLAW_CONFIG_PATH: `${STATE}/openclaw.json` });

const { i: createCodeModeTools, n: applyCodeModeCatalog } = await import(`${DIST}/prompt-tool-policy-XiWNJtPU.mjs`);
const { g: createToolSearchCatalogRef } = await import(`${DIST}/tool-search-tPlKa2sf.mjs`);
const { o: setPluginToolMeta } = await import(`${DIST}/tool-metadata-rqUpUHlb.mjs`);
const { t: LegacyPluginSdkResourceHost } = await import(`${DIST}/legacy-sdk-resource-host-BiedXayN.mjs`);
const { t: GatewayScheduler } = await import(`${DIST}/gateway-scheduler-BuCBb32F.mjs`);

// Hardened = the worker's hardened config (results/openclaw-codemode-quickjs-wasi.json "hardened.config").
const HARDENED = { enabled: true, executor: 'quickjs', timeoutMs: 5000, memoryLimitBytes: 16 * 1024 * 1024, maxOutputBytes: 8192, maxSnapshotBytes: 1024 * 1024, maxPendingToolCalls: 8, snapshotTtlSeconds: 60 };
const DEFAULT = { enabled: true, executor: 'quickjs' };
const MAX_WAITS = 64; // a model would keep calling wait while status is `waiting`; stop after 64 rounds

export default async (config, host) => {
  const codeMode = config === 'hardened' ? HARDENED : DEFAULT;
  const mk = (name, description, properties, required, fn) => {
    const t = {
      name, label: name, description,
      parameters: { type: 'object', properties, required },
      execute: async (_id, input) => {
        const details = await fn(input);
        return { content: [{ type: 'text', text: (() => { try { return JSON.stringify(details); } catch { return String(details); } })() }], details };
      },
    };
    setPluginToolMeta(t, { pluginId: 'probe', optional: true });
    return t;
  };
  const tools = [
    mk('lookup', 'Look up a record by id. Returns {id, value}.', { id: { type: 'number', description: 'record id' } }, ['id'], (i) => host.lookup(i.id)),
    mk('failing', 'Always fails.', {}, [], () => host.failing()),
    mk('rich', 'Returns a rich object.', {}, [], () => host.rich()),
  ];
  const rh = new LegacyPluginSdkResourceHost();
  rh.bindScheduler(new GatewayScheduler());
  const cfg = { tools: { codeMode } };
  let seq = 0;
  const waitsSeen = [];
  async function exec(code) {
    const n = ++seq;
    const catalogRef = createToolSearchCatalogRef();
    const ctx = { config: cfg, runtimeConfig: cfg, sessionId: `verify-${n}`, sessionKey: `agent:main:verify-${n}`, runId: `verify-run-${n}`, catalogRef };
    const [execTool, waitTool] = createCodeModeTools(ctx);
    applyCodeModeCatalog({ ...ctx, tools: [execTool, waitTool, ...tools] });
    let r = await rh.run(() => execTool.execute(`verify-${n}`, { code }));
    let waits = 0;
    while (r?.details?.status === 'waiting' && waits < MAX_WAITS) r = await rh.run(() => waitTool.execute(`verify-${n}-w${waits++}`, { runId: r.details.runId }));
    waitsSeen.push(waits);
    const text = (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    const d = r?.details ?? {};
    return { status: d.status, code: d.code, waits, value: d.value, error: d.error, output: d.output, textChars: text.length, text };
  }
  return {
    name: 'openclaw-codemode-quickjs-wasi', T: 'lookup', F: 'failing', R: 'rich', ret: true,
    notes: `tools.codeMode=${JSON.stringify(codeMode)}; one resource host + GatewayScheduler shared; new session (exec/wait tools) per execution; 'waiting' followed with wait up to ${MAX_WAITS} times`,
    exec,
    stats: async () => ({ waitsPerExec: waitsSeen }),
    // R9e (8 loops) failed the neighbor; the shared QuickJS pool is a 'compute' WorkerTaskPool of
    // min(4, availableParallelism-1) workers. 3 and 4 concurrent loops bracket that size.
    extraTests: ({ neighbor }) => ({ R9e3: () => neighbor('while (true) {}', 3), R9e4: () => neighbor('while (true) {}', 4) }),
  };
};

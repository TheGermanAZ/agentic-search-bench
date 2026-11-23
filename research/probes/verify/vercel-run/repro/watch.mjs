// Runs one probe in a child process, samples the child's RSS with ps, and enforces the SPEC kill rules
// (4 GB host RSS or 120 s). Writes out/<label>.txt with the probe's own JSON record, the child's raw
// stdout/stderr (guest console output that leaked to the host process lands here), and the watcher stats.
// Usage: node watch.mjs <label> <command> [args...]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const [label, cmd, ...args] = process.argv.slice(2);
const KILL_RSS_KB = 4 * 1024 * 1024;
const KILL_MS = 120_000;
const recordPath = `${HERE}out/${label}.json`;
if (existsSync(recordPath)) rmSync(recordPath);

const t0 = performance.now();
const child = spawn(cmd, args, { cwd: HERE, env: { ...process.env, PROBE_RECORD: recordPath }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => (stdout += d));
child.stderr.on('data', (d) => (stderr += d));
let peakKb = 0;
let killedFor = null;
const sampler = setInterval(() => {
  try {
    const kb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(child.pid)]).toString().trim());
    if (kb > peakKb) peakKb = kb;
    if (kb > KILL_RSS_KB && !killedFor) {
      killedFor = `host RSS over 4 GB (${kb} KB)`;
      child.kill('SIGKILL');
    }
  } catch {}
}, 50);
const timer = setTimeout(() => {
  killedFor = 'no-limit-within-120s';
  child.kill('SIGKILL');
}, KILL_MS);

child.on('exit', (code, signal) => {
  clearInterval(sampler);
  clearTimeout(timer);
  const wallMs = Math.round(performance.now() - t0);
  const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null;
  const clip = (s) => (s.length > 2000 ? `${s.slice(0, 600)}\n...[${s.length} chars total, clipped by watch.mjs]...\n${s.slice(-600)}` : s);
  const countA = (s) => (s.match(/A/g) || []).length;
  const text = [
    `label: ${label}`,
    `command: ${cmd} ${args.join(' ')}`,
    `child exit: code=${code} signal=${signal}${killedFor ? ` killed by watcher: ${killedFor}` : ''}`,
    `child wall ms (process start to exit): ${wallMs}`,
    `peak child RSS: ${(peakKb / 1024).toFixed(1)} MB (ps every 50 ms)`,
    `child stdout length: ${stdout.length} chars, 'A' count: ${countA(stdout)}`,
    `child stderr length: ${stderr.length} chars`,
    '--- probe record ---',
    record ? JSON.stringify(record, null, 2) : '(no record written: the probe process died before reporting)',
    '--- child stdout ---',
    clip(stdout),
    '--- child stderr ---',
    clip(stderr),
  ].join('\n');
  writeFileSync(`${HERE}out/${label}.txt`, text + '\n');
  console.log(`${label}: exit=${code}/${signal} wall=${wallMs}ms peakRSS=${(peakKb / 1024).toFixed(0)}MB ${killedFor ?? ''} ${record ? JSON.stringify(record.summary ?? '') : 'NO RECORD'}`);
});

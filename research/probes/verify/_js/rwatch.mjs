// Runs one command, samples the RSS of its whole process tree every 50 ms (and its macOS phys_footprint every
// 100 ms through footprint.py), kills the tree at 4 GB of either or 120 s.
// Writes <outfile> (JSON): the @@RECORD@@ line the child printed, plus peak RSS, kill reason and output tails.
// Usage: node rwatch.mjs <outfile.json> <cmd> [args...]
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const [outfile, cmd, ...args] = process.argv.slice(2);
const LIMIT_KB = 4 * 1024 * 1024;
const LIMIT_MS = 120_000;
const t0 = Date.now();
import { readFileSync, rmSync } from 'node:fs';
const RECORD_FILE = outfile + '.rec';
rmSync(RECORD_FILE, { force: true });
const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, RECORD_FILE } });
let stdout = '';
let stderr = '';
let recordSeenAt = null;
child.stdout.on('data', (d) => {
  stdout += d;
  if (recordSeenAt === null && stdout.includes('@@RECORD@@') && stdout.slice(stdout.indexOf('@@RECORD@@')).includes('\n')) recordSeenAt = Date.now();
  if (stdout.length > 4e6 && recordSeenAt === null) stdout = stdout.slice(-2e6);
});
child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 4e6) stderr = stderr.slice(-2e6); });

function tree() {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' }).trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const pids = new Set([child.pid]);
  let grew = true;
  while (grew) { grew = false; for (const [p, pp] of rows) if (pids.has(pp) && !pids.has(p)) { pids.add(p); grew = true; } }
  let rss = 0;
  for (const [p, , r] of rows) if (pids.has(p)) rss += r;
  return { pids: [...pids], rssKb: rss };
}
let peakKb = 0;
let kill = null;
// macOS: RSS misses compressed pages, so also sample the tree's phys_footprint through footprint.py.
let peakFpMb = 0;
let fpMb = 0;
const fp = spawn('python3', [new URL('./footprint.py', import.meta.url).pathname, String(child.pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
let fpBuf = '';
fp.stdout.on('data', (d) => { fpBuf += d; const ls = fpBuf.split('\n'); fpBuf = ls.pop(); for (const l of ls) { const n = Number(l); if (n) { fpMb = n; peakFpMb = Math.max(peakFpMb, n); } } });
const samples = [];
const timer = setInterval(() => {
  let t;
  try { t = tree(); } catch { return; }
  peakKb = Math.max(peakKb, t.rssKb);
  if (samples.length < 4000) samples.push([Date.now() - t0, Math.round(t.rssKb / 1024), fpMb]);
  const over = t.rssKb > LIMIT_KB ? 'rss>4GB' : fpMb > 4096 ? 'footprint>4GB' : Date.now() - t0 > LIMIT_MS ? 'wall>120s' : recordSeenAt && Date.now() - recordSeenAt > 3000 ? 'exit-hang-after-record(3s)' : null;
  if (over && !kill) {
    kill = { reason: over, atMs: Date.now() - t0, rssMb: Math.round(t.rssKb / 1024), footprintMb: fpMb };
    for (const p of t.pids.reverse()) { try { process.kill(p, 'SIGKILL'); } catch {} }
  }
}, 50);

child.on('exit', (code, signal) => {
  clearInterval(timer);
  try { fp.kill('SIGKILL'); } catch {}
  const line = stdout.split('\n').find((l) => l.startsWith('@@RECORD@@'));
  let record = null;
  try { record = JSON.parse(readFileSync(RECORD_FILE, 'utf8')); rmSync(RECORD_FILE, { force: true }); } catch {
    try { record = line ? JSON.parse(line.slice(10)) : null; } catch (e) { record = { parseError: String(e) }; }
  }
  const rest = stdout.split('\n').filter((l) => !l.startsWith('@@RECORD@@')).join('\n');
  const thin = samples.filter((_, i) => i % Math.max(1, Math.ceil(samples.length / 80)) === 0);
  const result = {
    cmd: [cmd, ...args].join(' '),
    exit: { code, signal },
    wallMs: Date.now() - t0,
    peakTreeRssMb: Math.round(peakKb / 1024),
    peakTreeFootprintMb: peakFpMb,
    watchKill: kill,
    record,
    childStdoutOtherChars: rest.length,
    childStdoutHead: rest.slice(0, 1500),
    childStderrTail: stderr.slice(-2500),
    rssSamplesMsMb: thin, // [ms, rssMb, footprintMb]
  };
  writeFileSync(outfile, JSON.stringify(result, null, 2) + '\n');
  const d = record?.data;
  console.log(`${outfile.split('/').slice(-3).join('/')}: exit=${code}/${signal} wall=${result.wallMs}ms peak=${result.peakTreeRssMb}MB fp=${peakFpMb}MB kill=${kill?.reason ?? '-'} lag=${record?.hostMaxEventLoopLagMs}ms :: ${JSON.stringify(d ?? record?.harnessError ?? null).slice(0, 600)}`);
});

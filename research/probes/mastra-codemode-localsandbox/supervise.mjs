// Supervises one probe child process: samples the RSS of its whole process tree, kills the
// tree at 4 GB RSS or 120 s after the child prints "@@start", and saves the child's JSON record
// (or the kill/crash facts) to an out file. Used by both Mastra and codemode-unified harnesses.
// export: supervise({ cmd, args, env, outFile, memLock })
import { spawn, execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const KILL_RSS_KB = 4 * 1024 * 1024;
const KILL_MS = 120_000;
const MEM_LOCK = new URL('../mem-lock.sh', import.meta.url).pathname;

function psRows() {
  try {
    return execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' });
  } catch {
    return '';
  }
}

function descendants(rootPid) {
  const rows = psRows().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const out = [];
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    for (const [pid, ppid] of rows) if (ppid === p) { out.push(pid); stack.push(pid); }
  }
  return out;
}

function treeRssKb(rootPid) {
  const out = psRows();
  if (!out) return 0;
  const rows = out.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid] of rows) {
    if (!kids.has(ppid)) kids.set(ppid, []);
    kids.get(ppid).push(pid);
  }
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  let total = 0;
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    total += rss.get(p) || 0;
    for (const c of kids.get(p) || []) stack.push(c);
  }
  return total;
}

export function supervise({ cmd, args, env, outFile, memLock = false }) {
  mkdirSync(dirname(outFile), { recursive: true });
  const fullCmd = memLock ? MEM_LOCK : cmd;
  const fullArgs = memLock ? [cmd, ...args] : args;
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(fullCmd, fullArgs, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let probeStart = null;
    let peakKb = 0;
    let killedFor = null;
    const killTree = (why) => {
      if (killedFor) return;
      killedFor = why;
      // Under mem-lock.sh, spare the lock script itself so its EXIT trap releases the shared lock.
      if (memLock) {
        for (const pid of descendants(child.pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {}
        }
        return;
      }
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    };
    const sampler = setInterval(() => {
      const kb = treeRssKb(child.pid);
      if (kb > peakKb) peakKb = kb;
      if (kb > KILL_RSS_KB) killTree('host-rss-over-4GB');
      if (probeStart && Date.now() - probeStart > KILL_MS) killTree('harness-120s');
    }, 100);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (!probeStart && stdout.includes('@@start')) probeStart = Date.now();
    });
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code, signal) => {
      clearInterval(sampler);
      const lines = stdout.trim().split('\n');
      let record = null;
      try {
        record = JSON.parse(lines[lines.length - 1]);
      } catch {}
      const facts = {
        exitCode: code,
        signal,
        killedByHarness: killedFor,
        msSinceProbeStart: probeStart ? Date.now() - probeStart : null,
        totalWallMs: Date.now() - started,
        peakTreeRssMB: +(peakKb / 1024).toFixed(1),
        stderrTail: stderr.slice(-3000),
        stdoutTailIfNoRecord: record ? undefined : stdout.slice(-3000),
      };
      writeFileSync(outFile, JSON.stringify({ supervisor: facts, ...(record || {}) }, null, 2) + '\n');
      resolve({ facts, record });
    });
  });
}

// Stall investigation (PY-ENGINES.md): replays the four programs of the bad run runs/engines-hard-pa3 concurrently,
// without the agent, and reports event-loop stalls. Usage: pnpm exec tsx research/probes/engines/stall-replay.ts <engine>
import { getEngine } from "../../../src/engines";
import { Corpus } from "../../../src/search";

const name = process.argv[2] ?? "py-pydantic-ai";
const engine = await getEngine(name);
const corpus = new Corpus();
const T0 = Date.now();
const ts = () => `+${((Date.now() - T0) / 1000).toFixed(1)}s`;

// Event-loop stall monitor: a 50 ms tick that reports gaps over 300 ms.
let last = Date.now();
let maxGap = 0;
const mon = setInterval(() => {
  const gap = Date.now() - last - 50;
  if (gap > 300) console.error(`[loop] ${ts()} event loop blocked ${gap} ms`);
  maxGap = Math.max(maxGap, gap);
  last = Date.now();
}, 50);

const P = {
  hrd01: `r=await grep(pattern="raptor",opts={"after":"2001-11-01","before":"2001-12-01","limit":500})\nprint(r["totalFiles"],len(r["hits"]))`,
  hrd04: `r=await grep(pattern="azurix",opts={"after":"2000-12-01","before":"2001-01-01","limit":500})\nprint(r["totalFiles"],len(r["hits"]))`,
  hrd07: `import asyncio, datetime\nd0=datetime.date(2000,5,1)\ndays=[d0+datetime.timedelta(i) for i in range(31)]\nrs=await asyncio.gather(*[grep(pattern="dynegy",opts={"after":str(d),"before":str(d+datetime.timedelta(1)),"limit":1}) for d in days])\nprint(sorted([(r["totalFiles"],str(d)) for r,d in zip(rs,days)],reverse=True)[:5])`,
  hrd09: `r=await grep(pattern=r"703\\D{0,3}227\\D{0,3}8777")\nprint(r["totalFiles"])`,
  hrd09count: `print(await count(filter={"from":"bryant.frihart@enron.com","after":"2001-08-01","before":"2001-09-01"}))`,
};
const JS = {
  hrd01: `const r = await corpus.grep("raptor", {after:"2001-11-01", before:"2001-12-01", limit:500}); console.log(r.totalFiles, r.hits.length)`,
  hrd04: `const r = await corpus.grep("azurix", {after:"2000-12-01", before:"2001-01-01", limit:500}); console.log(r.totalFiles, r.hits.length)`,
  hrd07: `const days=[...Array(31)].map((_,i)=>new Date(Date.UTC(2000,4,1+i)).toISOString().slice(0,10)); const nx=(d)=>new Date(Date.parse(d)+864e5).toISOString().slice(0,10); const rs=await Promise.all(days.map(d=>corpus.grep("dynegy",{after:d,before:nx(d),limit:1}))); console.log(JSON.stringify(rs.map((r,i)=>[r.totalFiles,days[i]]).sort((a,b)=>b[0]-a[0]).slice(0,5)))`,
  hrd09: `const r = await corpus.grep("703\\\\D{0,3}227\\\\D{0,3}8777"); console.log(r.totalFiles)`,
  hrd09count: `console.log(await corpus.count({from:"bryant.frihart@enron.com", after:"2001-08-01", before:"2001-09-01"}))`,
};
const progs = engine.language === "python" ? P : JS;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function go(label: keyof typeof P, delay: number) {
  await sleep(delay);
  const t = Date.now();
  console.error(`[run] ${ts()} start ${label}`);
  const out = await engine.run(progs[label], corpus);
  console.error(`[run] ${ts()} end ${label} after ${Date.now() - t} ms: ${out.slice(0, 110).replace(/\n/g, " | ")}`);
  return Date.now() - t;
}
// Warm the engine first so startup is not counted.
await engine.run(engine.language === "python" ? "print(1)" : "console.log(1)", corpus);
const t1 = Date.now();
const durs = await Promise.all([go("hrd01", 0), go("hrd04", 100), go("hrd07", 500), go("hrd09", 1000), go("hrd09count", 3000)]);
const tail = await go("hrd09count", 0); // a later execution on the same sidecar
console.error(`[summary] total ${Date.now() - t1} ms, per-run ${durs.join(",")}, tail ${tail} ms, max loop gap ${maxGap} ms`);
clearInterval(mon);
await engine.close?.();

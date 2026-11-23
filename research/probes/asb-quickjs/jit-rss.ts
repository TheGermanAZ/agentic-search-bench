import { runCode } from "../../../src/sandbox";
for (const ms of [3000, 3000, 10000]) console.log(ms, (await runCode(`const t = Date.now(); let n = 0; while (Date.now() - t < ${ms}) n++; console.log(n)`, {} as any)));

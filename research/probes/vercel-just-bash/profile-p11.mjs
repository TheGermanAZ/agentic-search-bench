// Explain-the-number helper for P11: runs many echo execs on one instance so a CPU profile can name the hot code.
// Usage: node --cpu-prof --cpu-prof-dir=<dir> profile-p11.mjs ; then node top-self-time.mjs <file.cpuprofile>
import { Bash } from "just-bash";

const bash = new Bash();
for (let i = 0; i < 300; i += 1) await bash.exec("echo 2");
const start = performance.now();
for (let i = 0; i < 5000; i += 1) await bash.exec("echo 2");
console.log(JSON.stringify({ execs: 5000, msPerExec: (performance.now() - start) / 5000 }));

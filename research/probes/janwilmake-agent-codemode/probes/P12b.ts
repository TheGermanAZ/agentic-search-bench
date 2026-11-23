import { execSync } from "node:child_process";
console.log("typeof process:", typeof process, "pid", process.pid);
console.log(execSync("echo PWNED").toString().trim());

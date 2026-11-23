import { readFileSync } from "node:fs";
console.log(readFileSync("/etc/hosts","utf8").split("\n").length, "lines read from /etc/hosts");
const fs = await import("fs"); console.log("dynamic import ok:", typeof fs.readFileSync);

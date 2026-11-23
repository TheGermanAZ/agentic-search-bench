import { readFileSync } from "node:fs";
import { join } from "node:path";
import { api } from "./client.mjs";

const dir = new URL("./app/", import.meta.url).pathname;
const files = ["index.ts", "package.json"].map((path) => ({ path, content: readFileSync(join(dir, path), "utf8") }));
const res = await api("POST", "/v1/apps/deploy", { owner: "executor-local", name: "probe", files });
console.log(res.status, res.body.slice(0, 3000));

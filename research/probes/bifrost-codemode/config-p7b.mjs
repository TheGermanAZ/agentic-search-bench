// P7 variants that allocate with few interpreter steps, to see whether the 64 MiB allocation budget or the step budget stops them.
export * from "./config.mjs";
import { probes as base } from "./config.mjs";
export const probes = { ...base, P7: [`a = [None] * 100000000\nresult = len(a)`, `s = "x"\nfor i in range(40):\n    s = s + s\nresult = len(s)`, `d = {}\nfor i in range(10000000):\n    d[i] = i\nresult = len(d)`] };

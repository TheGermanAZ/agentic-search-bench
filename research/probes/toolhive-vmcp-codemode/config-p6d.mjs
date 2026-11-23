export * from "./config.mjs";
// P6d: CPU inside builtins with few steps: 1 GB string, 1,000 count() calls (~7k steps, under the hardened 10k).
export const probes = { P6d: [`s = "x" * 1000000000\nfor i in range(1000):\n    s.count("xy")\nreturn "done"`] };

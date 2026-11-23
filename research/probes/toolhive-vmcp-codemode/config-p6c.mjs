export * from "./config.mjs";
// P6c: builtin-heavy script sized to finish after the decorator's 1-minute defaultScriptTimeout but before the 120 s cap.
export const probes = { P6c: [`s = "x" * 100000000\nfor i in range(2000):\n    s.count("xy")\nreturn "done after the 60 s script timeout?"`] };

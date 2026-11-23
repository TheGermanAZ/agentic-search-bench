export * from "./config.mjs";
export const probes = {
  CAL2: [`s = "x" * 100000000\nfor i in range(10):\n    s.count("xy")\nreturn "done"`, `s = "x" * 100000000\nfor i in range(10):\n    s.find("y")\nreturn "done"`],
};

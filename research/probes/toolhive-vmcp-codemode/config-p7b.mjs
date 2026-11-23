export * from "./config.mjs";
// Low-step allocation variants: each line allocates up to 1 GiB inside one builtin call, charged as one step.
export const probes = {
  P7: [`s = "x" * (1 << 31)\nreturn len(s)`,
        `a = ["x" * (1 << 29) + str(i) for i in range(16)]\nreturn len(a)`],
};

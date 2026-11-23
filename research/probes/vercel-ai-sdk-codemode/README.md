# vercel-ai-sdk-codemode probe harness

Runs the SPEC probes against `@ai-sdk/code-mode` 1.0.136 (with `ai` 7.0.179 and `run` 2.1.13; source at
vercel/ai `d55f3cfc456d1b7bc7db3a4b70fbf602ddc8647d`, `packages/code-mode`). The probe builds the tool with
`experimental_createCodeModeTool({ lookup, failing }, options)` and calls the tool's own
`execute({ js }, { toolCallId, messages })`, which is what `generateText` calls after a model tool call. No
model is involved. The hardened run passes `executionPolicy` with the run docs' strict budget.

## Rerun

```bash
(cd ../../impls/vercel-ai-sdk-codemode/pkg && npm ci --ignore-scripts)   # or: npm i @ai-sdk/code-mode@1.0.136 ai@7.0.179 zod@4 --ignore-scripts
./run-all.sh
node watch.mjs P9 node probe.mjs P9
```

`watch.mjs` and the P6/P7 sibling checks work as in `../vercel-run/README.md`. Guest `console.log` output
shows up in the child stdout section of `out/<label>.txt`, never in the tool result.

The `lookup` tool uses `jsonSchema()` without a validator, so P10d shows no input validation. That is a
harness choice: code mode validates input only when the schema carries a `validate` function
(`packages/code-mode/src/tool-invocation.ts:183-194`), as zod schemas do.

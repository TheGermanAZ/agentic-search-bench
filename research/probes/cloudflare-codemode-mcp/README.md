# cloudflare-codemode-mcp probes

Runs the SPEC probes against the cloudflare/mcp server (commit b8602d6) through the repo's own vitest + workerd test harness. The real Worker runs with a dummy token. MSW mocks the Cloudflare API, including `GET /lookup/:id`, which stands in for the `lookup` host tool.

```sh
# one-time: install the clone's locked dependencies
(cd ../../impls/cloudflare-codemode-mcp/mcp && npm ci)
node run.mjs fast            # P1-P5, P8-P12 -> out/P*.json
node run.mjs hang            # P6 and P7 for execute and search, killed at 135 s or 4 GB of workerd RSS
```

`run.mjs` copies `probes.test.ts` or a `hang-P*.test.ts` into the clone's `tests/`, runs vitest, and deletes the copy afterwards. Results come back as `PROBE_RESULT` lines in the vitest output.

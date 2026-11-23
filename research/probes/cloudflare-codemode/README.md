# cloudflare-codemode probes

Runs the SPEC probes against `@cloudflare/codemode@0.5.6` (`createCodeTool` plus `DynamicWorkerExecutor`) inside local `wrangler dev`. It needs no Cloudflare account and no login.

```sh
# one-time: install the pinned packages next to the cloned source
(cd ../../impls/cloudflare-codemode && npm i)
# all probes (P6 and P7 each get their own wrangler session); outputs land in out/
node run-probes.mjs            # or: node run-probes.mjs P1 P9 P12
```

`harness.ts` is the host Worker. It registers the `lookup` tool and serves `/run`, `/bench`, `/description` and `/host-env`. `node_modules` is a symlink to `research/impls/cloudflare-codemode/node_modules`.

# tanstack-ai-codemode-daytona-e2b

Not run. The TanStack Code Mode drivers `@tanstack/ai-isolate-daytona` (1.1.1) and `@tanstack/ai-isolate-e2b`
(1.1.0) execute code in remote sandboxes that the application creates with a hosted account: a Daytona
sandbox from `new Daytona()` (docs/code-mode/code-mode-isolates.md:260) and an E2B sandbox that needs
`E2B_API_KEY` (code-mode-isolates.md:295). Per SPEC, no credentials were looked for or used, so every probe
is `blocked-needs-credentials`. The Node, QuickJS, QuickJS Bun and Cloudflare (local wrangler) drivers were
probed in their own folders.

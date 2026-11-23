# Blog quotes, fetched 2026-11-22 (published 2026-04-23)
Source: https://devblogs.microsoft.com/agent-framework/codeact-with-hyperlight/

- "CodeAct ships in the new agent-framework-hyperlight (alpha) package, which runs the model-generated code in a fresh, locally isolated Hyperlight micro-VM per call."
- "When that sandboxed program calls call_tool("name", ...), Hyperlight bridges the call back out to your runtime, runs your tool there, and returns the result into the sandbox."
- "Allowed domains are enforced at the sandbox boundary, not by convention."
- "Each execute_code call runs in a fresh guest with its own memory, no access to the host filesystem beyond what you explicitly mount, and no network access beyond the domains you allow. Guest startup is measured in milliseconds"
- "Because every execute_code call gets its own freshly created micro-VM, with only the mounts and domains you opted into, the sandbox is cheap enough to be disposable and strict enough to be the default."
- "The backend is available for Linux and Windows today. macOS support is on the way."

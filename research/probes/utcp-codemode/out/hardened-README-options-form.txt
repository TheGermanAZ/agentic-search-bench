{
  "config": {
    "timeoutMs": 10000,
    "memoryLimitMB": 64,
    "call": "client.callToolChain(code, 10000, 64)"
  },
  "probe": "README options-object form",
  "call": "client.callToolChain(code, { timeout: 10000, memoryLimit: 64 })",
  "rows": {
    "P1": {
      "code": "const r = await host.lookup({id: 21}); console.log(r.value)",
      "wallMs": 6.3,
      "hostCalls": 0,
      "result": null,
      "logs": [
        "[ERROR] Code execution failed: Script execution timeout after [object Object]ms"
      ],
      "threw": null
    },
    "P6": {
      "code": "while (true) {}",
      "wallMs": 4,
      "hostCalls": 0,
      "result": null,
      "logs": [
        "[ERROR] Code execution failed: Script execution timeout after [object Object]ms"
      ],
      "threw": null
    }
  }
}

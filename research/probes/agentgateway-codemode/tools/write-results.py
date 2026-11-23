import json, sys
O = "research/probes/agentgateway-codemode/out/"
DOC = "https://docs.solo.io/agentgateway/kubernetes/latest/documentation/mcp/tool-mode/"
BLOG = "https://www.solo.io/blog/agentgateway-code-mode-for-openapi-to-mcp"
LAB = "https://github.com/solo-io/fe-enterprise-agentgateway-workshop/blob/main/labs/mcp/mcp-tool-mode-code.md"
DOCKER = "https://docs.solo.io/agentgateway/standalone/latest/documentation/setup/install/docker/"
blk = lambda: {"outcome": "blocked-needs-credentials", "display": "blocked-needs-credentials", "detail": "Code mode ships only in Solo Enterprise for agentgateway, which refuses to start without a license key (out/no-license-start.txt). Not probed.", "evidence": O + "no-license-start.txt"}
d = {
 "impl": "agentgateway-codemode",
 "name": "agentgateway code mode (run_code), Solo Enterprise for agentgateway",
 "source": "Closed: Solo Enterprise for agentgateway image us-docker.pkg.dev/solo-public/enterprise-agentgateway/agentgateway-enterprise. Not in the OSS repo https://github.com/agentgateway/agentgateway.",
 "pinned": "Enterprise image 2026.11.1 (image sha256:10fefd738b2831e8559b3dc972974b566f9e55e485487907ff29db765c886d1d, /app/agentgateway sha256:48a80b0c47e723bc6d945fcdef2621401e21969e742a1eb3104e40aaf052f284). OSS repo checked at 888badbbe91f2a57ec8e7bf5a5ef3acda34b1fe5 (2026-11-20).",
 "language": "JS",
 "engine": "QuickJS through the rquickjs Rust bindings (git checkout rquickjs aa311a3, plus rquickjs-serde 0.5.0), in-process in the gateway, async context, run on a worker. Named from crate paths and symbols compiled into the enterprise binary (agentgateway::mcp::ent_code_mode::execute_js_script_inner), not from source, because the source is closed.",
 "how_run": "Not run. Pulled the public enterprise image (registry needs no credentials) and started it with an inline config and --network none: \"license refused startup: no license key configured\". A license needs a Solo trial or sales contact, which is outside this task's rules.",
 "probes": {k: blk() for k in ["P1","P2","P3","P4","P5","P6","P7","P8","P9","P10","P11","P12"]},
 "hardened": None,
 "defaults": {
  "time": "Docs: wall-clock 60 s default (entMcp.codeMode.timeout), CPU time 1 s default (entMcp.codeMode.cpuTimeout). The workshop lab says the wall-clock default is 5 s. Binary has the messages \"Code mode execution timed out after\" and \"Code mode execution exceeded CPU time limit of\". Not measured.",
  "memory": "Docs: 4 MiB, not configurable; stack 256 KiB, not configurable. Not measured.",
  "output": "Docs and binary: the final expression is the return value; only that value goes back. No output cap documented. Not measured.",
  "tool_calls": "Docs: 20 per execution, not configurable; binary has \"Code mode exceeded the maximum of\". Not measured.",
  "hardened_null_reason": "Could not run without a license key."
 },
 "source_notes": [
  {"topic": "Availability", "finding": "The OSS agentgateway repo has no code mode: no run_code, no QuickJS or other JS engine dependency, no entMcp/toolMode config (the only grep hits are the substring \"codemode\" inside encode_model_path_segment). Code mode is an enterprise feature configured as entMcp.toolMode: Code | CodeSearch on an EnterpriseAgentgatewayBackend. The blog is tagged Agentgateway Enterprise.", "evidence": O + "oss-search.txt; " + DOC + "; " + BLOG},
  {"topic": "Engine (isolation boundary)", "finding": "QuickJS via rquickjs, compiled into the gateway binary, module mcp::ent_code_mode. Solo's own docs say: \"Code mode currently runs in an in-process JavaScript runtime. It is not yet a fully sandboxed runtime that gives each session its own credentials, filesystem, and network.\" The blog instead says \"Host, filesystem, and network access are restricted.\"", "evidence": O + "engine-strings.txt; " + DOC},
  {"topic": "API shape", "finding": "One MCP tool run_code {code}. Its description holds a typed JS API rendered from the descriptions, input and output schemas of the tools the caller is authorized to use (symbols render_run_code_description, render_tool_api_definition, schema_to_js_hint). Each tool is an async function; top-level await is available; the final expression is the return value and top-level return is not allowed.", "evidence": O + "engine-strings.txt; " + DOC},
  {"topic": "Discovery", "finding": "Code mode puts every authorized tool's signature in the run_code description upfront. A separate CodeSearch mode pairs get_tool search with run_code (symbol list_tools_with_search), which is the variant that scales past 100 tools.", "evidence": DOC + "; " + O + "engine-strings.txt"},
  {"topic": "Bridge and authorization", "finding": "Host functions are installed into the QuickJS context (install_host_functions, invoke_bound_tool, call_bound_tool_value). Docs and blog: denied tools are omitted from the generated API and also rejected at runtime by the same authorization check as direct tools/call. Upstream API credentials stay in the gateway (blog: the model never sees API keys or OAuth tokens).", "evidence": O + "engine-strings.txt; " + DOC + "; " + BLOG},
  {"topic": "Limits", "finding": "Memory 4 MiB and 20 tool calls and 256 KiB stack fixed; wall-clock and CPU time configurable. Exceeding a limit returns an error result, not a failed session (docs). Wall-clock default is 60 s in the docs and 5 s in Solo's workshop lab.", "evidence": DOC + "; " + LAB},
  {"topic": "Licensing", "finding": "The image is public, but the proxy refuses to start without a valid key and there is no grace period for an installation that never held one.", "evidence": O + "no-license-start.txt; " + DOCKER},
 ],
 "surprises": [
  "The parent brief and missed-implementations.md point at the OSS repo, but code mode is enterprise-only and absent from github.com/agentgateway/agentgateway.",
  "Solo's docs say the runtime is in-process and \"not yet a fully sandboxed runtime\", while the blog says host, filesystem and network access are restricted.",
  "Two different wall-clock defaults are published: 60 s (docs) and 5 s (Solo workshop lab).",
  "The engine is QuickJS (rquickjs), the same family as the most common engine in this survey, which the blog does not name.",
 ],
}
json.dump(d, open(sys.argv[1], "w"), indent=2)

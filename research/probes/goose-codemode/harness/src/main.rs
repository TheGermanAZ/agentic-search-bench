mod platform_extensions {
    // goose's own Boa executor, compiled verbatim from the pinned clone. code_execution.rs:123
    // calls javascript::execute; that file needs goose's agent and MCP stack, so the harness
    // stands in for it with the same callback contract and default timeout.
    pub mod javascript {
        include!("../../../../impls/goose-codemode/src/crates/goose/src/agents/platform_extensions/javascript.rs");
    }

    use javascript::{ToolCallback, ToolFuture};
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tokio_util::sync::CancellationToken;

    // goose::config::DEFAULT_EXTENSION_TIMEOUT, read by code_execution.rs execution_timeout().
    const DEFAULT_TIMEOUT: Duration = Duration::from_secs(300);

    pub struct Host {
        pub calls: Arc<AtomicUsize>,
        callback: ToolCallback,
    }

    impl Host {
        pub fn new() -> Self {
            let calls = Arc::new(AtomicUsize::new(0));
            let rt = tokio::runtime::Handle::current();
            let counter = calls.clone();
            let callback: ToolCallback = Arc::new(move |name: String, args: Value| -> ToolFuture {
                if name != "lookup" {
                    return Box::pin(async move { Err(format!("Unknown tool {name:?}")) });
                }
                let counter = counter.clone();
                let rt = rt.clone();
                // Like code_execution.rs dispatch_tool, the tool runs on the host runtime.
                Box::pin(async move {
                    rt.spawn(async move {
                        counter.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(200)).await;
                        let id = &args["id"];
                        let value = match (id.as_i64(), id.as_f64()) {
                            (Some(i), _) => json!(i * 2),
                            (None, Some(f)) => json!(f * 2.0),
                            _ => return Err("lookup requires {id: number}".to_string()),
                        };
                        Ok(json!({ "id": id, "value": value }))
                    })
                    .await
                    .unwrap_or_else(|e| Err(format!("Callback task failed: {e}")))
                })
            });
            Host { calls, callback }
        }

        pub async fn exec(&self, code: &str) -> Value {
            let cancellation = CancellationToken::new();
            let dispatch = cancellation.child_token();
            let calls_before = self.calls.load(Ordering::SeqCst);
            let start = Instant::now();
            let result = javascript::execute(
                code.to_string(),
                self.callback.clone(),
                DEFAULT_TIMEOUT,
                cancellation,
                dispatch,
            )
            .await;
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
            // What the model receives, per CodeExecutionClient::call_tool.
            let (is_error, text) = match result {
                Ok(text) => (false, text),
                Err(error) => (true, javascript::limit_error(format!("Error: {error}"))),
            };
            json!({
                "is_error": is_error,
                "elapsed_ms": elapsed_ms,
                "host_calls": self.calls.load(Ordering::SeqCst) - calls_before,
                "text": text,
            })
        }
    }
}

fn probe(id: &str) -> Vec<String> {
    let f = |body: &str| format!("async function run() {{\n{body}\n}}");
    match id {
        "P1" => vec![f("const r = await tools.call(\"lookup\", {id: 21}); console.log(r.value)")],
        "P2" => vec![f("console.log(\"A\".repeat(200000)); return \"RETURNED\";")],
        "P3" => vec![f("await fetch(\"https://example.com\")")],
        "P4" => vec![
            f("return require(\"fs\").readFileSync(\"/etc/hosts\", \"utf8\")"),
            f("return (await import(\"fs\")).readFileSync(\"/etc/hosts\", \"utf8\")"),
            f("return await Deno.readTextFile(\"/etc/hosts\")"),
        ],
        "P5" => vec![f("return process.env.PROBE_SECRET")],
        "P6" => vec![f("while (true) {}")],
        "P7" => vec![f("const a = []; while (true) a.push(\"x\".repeat(1e6))")],
        "P8" => vec![
            f("globalThis.kept = 7"),
            f("console.log(typeof kept === \"undefined\" ? \"gone\" : kept)"),
        ],
        "P9" => vec![f(
            "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.call(\"lookup\", {id: i}))); console.log(Date.now() - t)",
        )],
        "P10" => vec![f("throw new Error(\"probe-boom\")")],
        "P11" => vec![f("return 1+1"); 21],
        "P12" => vec![
            f("return this.constructor.constructor(\"return process\")()"),
            f("return (function(){return this})().process"),
            f("return Object.getOwnPropertyNames(globalThis).filter(n => !/^[A-Z]/.test(n))"),
        ],
        // Variants: the spec's repeat() calls trip Boa's per-frame loop limit before the
        // probe's real question is asked, so these build the same data without repeat().
        "P2b" => vec![f("let s = \"A\"; while (s.length < 200000) s += s; console.log(s.slice(0, 200000)); return \"RETURNED\";")],
        "P6b" => vec![f("return /^(a+)+$/.test(\"a\".repeat(40) + \"b\")")],
        "P7b" => vec![f("let s = \"x\"; while (s.length < 1e6) s += s; const a = []; while (true) a.push(s + a.length)")],
        "P7c" => vec![f("const a = []; while (true) a.push(new ArrayBuffer(1e8))")],
        other => panic!("unknown probe {other}"),
    }
}

#[tokio::main]
async fn main() {
    let id = std::env::args().nth(1).expect("usage: goose-codemode-probe <P1..P12>");
    let host = platform_extensions::Host::new();
    for (index, code) in probe(&id).iter().enumerate() {
        let mut record = host.exec(code).await;
        record["probe"] = id.clone().into();
        record["exec"] = index.into();
        record["code"] = code.clone().into();
        println!("{record}");
    }
}

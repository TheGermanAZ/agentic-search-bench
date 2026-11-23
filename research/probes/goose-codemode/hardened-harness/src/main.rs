mod platform_extensions {
    // goose's own Boa executor, compiled verbatim from the pinned clone, as in ../harness.
    // The one difference from ../harness: the timeout comes from GOOSE_DEFAULT_EXTENSION_TIMEOUT
    // the way code_execution.rs execution_timeout() reads it (Config::get_param: the environment
    // variable wins, value in seconds, 300 when unset).
    pub mod javascript {
        include!("../../../../impls/goose-codemode/src/crates/goose/src/agents/platform_extensions/javascript.rs");
    }

    use javascript::{ToolCallback, ToolFuture};
    use serde_json::{json, Value};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tokio_util::sync::CancellationToken;

    pub fn execution_timeout() -> Duration {
        let secs = std::env::var("GOOSE_DEFAULT_EXTENSION_TIMEOUT")
            .ok()
            .and_then(|v| v.trim().parse::<u64>().ok())
            .unwrap_or(300);
        Duration::from_secs(secs)
    }

    #[derive(Clone)]
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
                execution_timeout(),
                cancellation,
                dispatch,
            )
            .await;
            let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;
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

use serde_json::{json, Value};

const TRIVIAL: &str = "async function run() {\nreturn 1+1\n}";
const REGEX: &str = "async function run() {\nreturn /^(a+)+$/.test(\"a\".repeat(40) + \"b\")\n}";

fn wrap(body: &str) -> String {
    format!("async function run() {{\n{body}\n}}")
}

fn probe(id: &str) -> Vec<String> {
    let f = wrap;
    match id {
        "P1" => vec![f("const r = await tools.call(\"lookup\", {id: 21}); console.log(r.value)")],
        "P3" => vec![f("await fetch(\"https://example.com\")")],
        "P4" => vec![
            f("return require(\"fs\").readFileSync(\"/etc/hosts\", \"utf8\")"),
            f("return (await import(\"fs\")).readFileSync(\"/etc/hosts\", \"utf8\")"),
            f("return await Deno.readTextFile(\"/etc/hosts\")"),
        ],
        "P5" => vec![f("return process.env.PROBE_SECRET")],
        "P6" => vec![f("while (true) {}"), TRIVIAL.into()],
        "P7" => vec![f("const a = []; while (true) a.push(\"x\".repeat(1e6))"), TRIVIAL.into()],
        "P9" => vec![f(
            "const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => tools.call(\"lookup\", {id: i}))); console.log(Date.now() - t)",
        )],
        "P12" => vec![
            f("return this.constructor.constructor(\"return process\")()"),
            f("return (function(){return this})().process"),
            f("return Object.getOwnPropertyNames(globalThis).filter(n => !/^[A-Z]/.test(n))"),
        ],
        // Variant, not SPEC: P7 data built without repeat(), so Boa's loop guard does not stop it first.
        "P7b" => vec![
            f("let s = \"x\"; while (s.length < 1e6) s += s; const a = []; while (true) a.push(s + a.length)"),
            TRIVIAL.into(),
        ],
        other => panic!("unknown probe {other}"),
    }
}

fn process_cpu_seconds() -> f64 {
    let out = std::process::Command::new("ps")
        .args(["-o", "time=", "-p", &std::process::id().to_string()])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    // macOS ps time is [[hh:]mm:]ss.cc
    out.split(':').fold(0.0, |acc, part| acc * 60.0 + part.parse::<f64>().unwrap_or(0.0))
}

fn thread_count() -> usize {
    std::process::Command::new("ps")
        .args(["-M", "-p", &std::process::id().to_string()])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).lines().count().saturating_sub(1))
        .unwrap_or(0)
}

fn emit(probe: &str, exec: usize, code: &str, mut record: Value) {
    record["probe"] = probe.into();
    record["exec"] = exec.into();
    record["code"] = code.into();
    println!("{record}");
}

// Does the deadline stop the worker thread? Runs a regex that Boa's instruction and loop
// guards do not count, then measures whether the process keeps burning CPU after the caller
// got its timeout, and whether stuck threads use up goose's 4 process-wide worker slots.
async fn deadline_thread(host: &platform_extensions::Host) {
    let first = host.exec(REGEX).await;
    emit("P6b-thread", 0, REGEX, first);
    let cpu0 = process_cpu_seconds();
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    let cpu1 = process_cpu_seconds();
    println!(
        "{}",
        json!({"probe": "P6b-thread", "exec": "after-first", "cpu_seconds_used_in_5s_after_timeout": cpu1 - cpu0, "os_threads": thread_count()})
    );
    let runs = (0..4).map(|_| {
        let host = host.clone();
        async move { host.exec(REGEX).await }
    });
    let results = futures::future::join_all(runs).await;
    for (i, r) in results.into_iter().enumerate() {
        emit("P6b-thread", i + 1, REGEX, r);
    }
    let cpu2 = process_cpu_seconds();
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    let cpu3 = process_cpu_seconds();
    println!(
        "{}",
        json!({"probe": "P6b-thread", "exec": "after-batch", "cpu_seconds_used_in_3s": cpu3 - cpu2, "os_threads": thread_count()})
    );
    let trivial = host.exec(TRIVIAL).await;
    emit("P6b-thread", 5, TRIVIAL, trivial);
}

#[tokio::main]
async fn main() {
    let id = std::env::args().nth(1).expect("usage: goose-codemode-hardened-probe <probe>");
    let host = platform_extensions::Host::new();
    println!(
        "{}",
        json!({"probe": id, "exec": "config", "timeout_seconds": platform_extensions::execution_timeout().as_secs()})
    );
    if id == "P6b-thread" {
        deadline_thread(&host).await;
        std::process::exit(0);
    }
    for (index, code) in probe(&id).iter().enumerate() {
        let record = host.exec(code).await;
        emit(&id, index, code, record);
    }
}

// Probe harness for go-utcp v1.12.3 CodeMode, the runtime Protocol-Lattice/go-agent (ebf73f2) wires in
// through adk.WithCodeModeUtcp. Calls CodeModeUTCP.Execute with Timeout 20000, the call
// go-agent's CodeMode.CallTool makes after its LLM planning step (plugins/codemode/orchestrator.go:44).
// Runs inside Docker (golang image). Prints one JSON line per probe.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	utcp "github.com/universal-tool-calling-protocol/go-utcp"
	"github.com/universal-tool-calling-protocol/go-utcp/src/plugins/codemode"
	"github.com/universal-tool-calling-protocol/go-utcp/src/transports"
)

var calls int64

type fakeClient struct{ utcp.UtcpClientInterface }

func (fakeClient) CallTool(ctx context.Context, name string, args map[string]any) (any, error) {
	if name != "lookup" {
		return nil, fmt.Errorf("unknown tool %q", name)
	}
	atomic.AddInt64(&calls, 1)
	time.Sleep(200 * time.Millisecond)
	id, _ := args["id"].(int)
	if f, ok := args["id"].(float64); ok {
		id = int(f)
	}
	return map[string]any{"id": id, "value": id * 2}, nil
}

func (fakeClient) CallToolStream(ctx context.Context, name string, args map[string]any) (transports.StreamResult, error) {
	return nil, fmt.Errorf("no streams")
}

type res struct {
	Probe   string `json:"probe"`
	Code    string `json:"code"`
	Value   any    `json:"value"`
	Stdout  string `json:"stdout"`
	Stderr  string `json:"stderr"`
	Err     string `json:"err"`
	Ms      float64 `json:"ms"`
	Calls   int64  `json:"host_calls"`
	RSSMB   float64 `json:"rss_mb"`
	Extra   string `json:"extra,omitempty"`
}

func rssMB() float64 {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, l := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(l, "VmRSS:") {
			var kb float64
			fmt.Sscanf(strings.TrimSpace(strings.TrimPrefix(l, "VmRSS:")), "%f", &kb)
			return kb / 1024
		}
	}
	return 0
}

func run(cm *codemode.CodeModeUTCP, probe, code string, timeoutMs int) res {
	c0 := atomic.LoadInt64(&calls)
	t0 := time.Now()
	r, err := cm.Execute(context.Background(), codemode.CodeModeArgs{Code: code, Timeout: timeoutMs})
	out := res{Probe: probe, Code: code, Value: r.Value, Stdout: r.Stdout, Stderr: r.Stderr, Ms: float64(time.Since(t0).Microseconds()) / 1000, Calls: atomic.LoadInt64(&calls) - c0, RSSMB: rssMB()}
	if err != nil {
		out.Err = err.Error()
	}
	if s, ok := out.Value.(string); ok && len(s) > 300 {
		out.Extra = fmt.Sprintf("value is a string of %d chars", len(s))
		out.Value = s[:300]
	}
	return out
}

func emit(r res) {
	b, _ := json.Marshal(r)
	fmt.Println(string(b))
}

func main() {
	os.Setenv("PROBE_SECRET", "s3cr3t")
	go func() { // SPEC watchdog: stop at 4 GB RSS or 120 s
		t0 := time.Now()
		for {
			time.Sleep(50 * time.Millisecond)
			if m := rssMB(); m > 4096 || time.Since(t0) > 120*time.Second {
				fmt.Printf("{\"probe\":\"WATCHDOG\",\"err\":\"harness stopped the process at %.0f MB RSS after %.1f s\"}\n", m, time.Since(t0).Seconds())
				os.Exit(0)
			}
		}
	}()
	cm := codemode.NewCodeModeUTCP(fakeClient{}, nil)
	T := 20000
	if len(os.Args) > 2 {
		fmt.Sscanf(os.Args[2], "%d", &T)
	}
	probes := map[string]string{
		"P1":   `let r = codemode.CallTool("lookup", {"id": 21}); r.value`,
		"P1b":  `let r = codemode.CallTool("lookup", {"id": 21}); codemode.Get(r, "value")`,
		"P2":   `print(repeat("A", 200000)); "RETURNED"`,
		"P2b":  `repeat("A", 200000)`,
		"P3":   `fetch("https://example.com")`,
		"P3b":  `http.Get("https://example.com")`,
		"P4":   `readFile("/etc/hosts")`,
		"P4b":  `os.ReadFile("/etc/hosts")`,
		"P5":   `env("PROBE_SECRET")`,
		"P5b":  `os.Getenv("PROBE_SECRET")`,
		"P6":   `reduce(1..2000000000, #acc + 1, 0)`,
		"P6b":  `len(filter(1..1000000, len(filter(1..1000000, true)) > 0))`,
		"P6c":  `reduce(1..1000, reduce(1..1000, reduce(1..1000, #acc + 1, 0), 0), 0)`,
		"P6d":  `let a = 1..900; reduce(a, reduce(a, reduce(a, reduce(a, #acc + 1, 0), 0), 0), 0)`,
		"P7":   `map(1..100000, repeat("x", 1000000))`,
		"P7b":  `reduce(1..100000, #acc + repeat("x", 1000000), "")`,
		"P7c":  `let a = 1..900; map(a, map(a, map(a, #)))`,
		"P8a":  `let kept = 7; kept`,
		"P8b":  `kept`,
		"P9":   `map([1, 2, 3, 4, 5], codemode.CallTool("lookup", {"id": #}))`,
		"P10":  `let x = 1; [1, 2][x + 5]`,
		"P10b": `codemode.CallTool("nope", {"id": 1})`,
		"P11":  `1 + 1`,
		"P12a": `codemode.client`,
		"P12b": `codemode.CallTool`,
		"P12c": `type(codemode)`,
		"P12d": `$env`,
	}
	want := strings.Split(os.Args[1], ",")
	if os.Args[1] == "all" {
		want = nil
		for k := range probes {
			want = append(want, k)
		}
		sort.Strings(want)
	}
	for _, p := range want {
		switch p {
		case "P11":
			var xs []float64
			for i := 0; i < 20; i++ {
				xs = append(xs, run(cm, "P11", probes["P11"], T).Ms)
			}
			sort.Float64s(xs)
			emit(res{Probe: "P11", Code: probes["P11"], Extra: fmt.Sprintf("ms sorted %v median %.3f p90 %.3f", xs, (xs[9]+xs[10])/2, xs[17])})
		case "P8":
			emit(run(cm, "P8a", probes["P8a"], T))
			emit(run(cm, "P8b", probes["P8b"], T))
		case "P6", "P6b", "P6c", "P6d", "P7", "P7b", "P7c":
			r := run(cm, p, probes[p], T)
			emit(r)
			time.Sleep(3 * time.Second)
			var ms runtime.MemStats
			runtime.ReadMemStats(&ms)
			emit(res{Probe: p + "-after", Extra: fmt.Sprintf("3 s after Execute returned: goroutines=%d rss_mb=%.0f heap_mb=%.0f", runtime.NumGoroutine(), rssMB(), float64(ms.HeapAlloc)/1048576)})
		default:
			emit(run(cm, p, probes[p], T))
		}
	}
}

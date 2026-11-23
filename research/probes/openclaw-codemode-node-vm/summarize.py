# Prints a compact view of each result in a probe output file: status, value/error, output entries (text lengths, markers).
import sys, json
for path in sys.argv[1:]:
    print("==", path)
    lines = open(path).read().split("\n")
    i = 0
    for n, l in enumerate(lines):
        if l.startswith("content text ("):
            clen = l.split("(")[1].split(" ")[0]
            body = lines[n + 1]
            try:
                d = json.loads(body)
            except Exception:
                print("  content", clen, "chars (not single-line JSON)", body[:120]); continue
            i += 1
            outs = []
            for o in d.get("output", []):
                if o.get("type") == "text": outs.append(("text", len(o["text"]), o["text"][-60:] if len(o["text"]) > 60 else o["text"]))
                else: outs.append({k: (v if k != "prefix" else f"<{len(v)} chars>") for k, v in o.items()})
            v = d.get("value", d.get("error"))
            vs = json.dumps(v)
            print(f"  #{i} content={clen} status={d['status']} code={d.get('code','')} value={vs[:150]}{'...('+str(len(vs))+')' if len(vs)>150 else ''} output={outs}")

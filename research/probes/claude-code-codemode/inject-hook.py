"""PreToolUse hook for the REPL tool: when out/.inject.js exists, replace the script with its contents once.

Used only after the model refused to type a probe itself; the model is told the hook exists and calls REPL with 1+1.
"""
import json
import sys
from pathlib import Path

pending = Path(__file__).resolve().parent / "out" / ".inject.js"
event = json.load(sys.stdin)
if event.get("tool_name") == "REPL" and pending.exists():
    code = pending.read_text()
    pending.unlink()
    tool_input = dict(event.get("tool_input") or {})
    tool_input["code"] = code
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow", "updatedInput": tool_input}}))

"""The SPEC host tool written the way the langgraph-codeact examples write tools: a plain
module-level function whose imports live at module level (math_example.py's sin uses the
module's `import math`)."""
import time

from probe_core import log_call


def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    start = time.time()
    time.sleep(0.2)
    log_call(id, start, time.time())
    return {"id": id, "value": id * 2}



"""`lookup` with its import inside the body, so inspect.getsource(lookup) runs on its own inside
Pyodide (the pyodide example copies tool source, not the tool's module)."""


def lookup(id: int) -> dict:
    """Waits 200 ms, then returns {id, value: id * 2}."""
    import time

    time.sleep(0.2)
    return {"id": id, "value": id * 2}

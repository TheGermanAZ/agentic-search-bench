"""The same probe server as adapter.py, served over stdio (the default `fastmcp run` transport)."""
import sys

sys.path.insert(0, __import__("os").path.dirname(__file__))
from adapter import make_server  # noqa: E402

if __name__ == "__main__":
    make_server("default").run()

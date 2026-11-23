// The Python corpus API shown to the model by the py-* engines: the Python counterpart of corpusApi() in src/sandbox.ts.
// Same functions, arguments and results as the JavaScript API. Filters are dicts because `from` is a Python keyword.

const FILTER_AND_MESSAGE = `# Filter: a dict, every key optional
#   "from":            substring of sender address or display name
#   "to":              substring of a To or Cc address
#   "involves":        substring of sender or any recipient address
#   "after":           ISO date, inclusive
#   "before":          ISO date, exclusive
#   "subjectContains": substring of the subject
# Message: {"id": str, "date": str, "from": str, "fromName": str, "to": list[str], "cc": list[str],
#           "subject": str, "custodian": str, "folder": str}`;

/** Positional style (py-monty): the filter dict is the first positional argument after any query or pattern. */
export const PY_API_POSITIONAL = `${FILTER_AND_MESSAGE}

async def search(query: str, opts: dict | None = None) -> list[dict]:
    """Ranked search. opts holds Filter keys plus "k" (default 10, max 50) and "mode": "hybrid" (default) fuses
    BM25 keyword search and embedding search with reciprocal rank fusion, "keyword" is BM25 only, "semantic" is
    embeddings only. Filters narrow before ranking. Each result is a Message plus "score" and "snippet"."""

async def grep(pattern: str, opts: dict | None = None) -> dict:
    """Regex over the full text of every message (headers and body), ripgrep syntax, case-insensitive unless
    opts["caseSensitive"]. opts holds Filter keys plus "limit" (default 50, max 500) and "caseSensitive".
    Returns {"totalFiles": int, "hits": list[Message + "line"]}: totalFiles counts every matching message after
    filters; hits holds the first limit with the first matching line."""

async def messages(filter: dict | None = None) -> list[dict]:
    """Metadata query, no text matching. Sorted by date. filter may also hold "limit" (default 100, max 5000)."""

async def count(filter: dict | None = None) -> int:
    """Exact number of messages matching a metadata filter (no limit)."""

async def people(name_or_email: str) -> list[dict]:
    """Resolve a name or address fragment to sender addresses, most active first.
    Each: {"email": str, "names": list[str], "sent": int, "received": int}."""

async def read(id: str) -> dict | None:
    """One full message (a Message plus "body", capped at 20k chars), or None."""

# Example: await count({"from": "vince.kaminski", "after": "2001-04-01", "before": "2001-05-01"})
# Keyword arguments are merged into the dict too: await count(after="2001-04-01", from_="vince.kaminski").`;

/** Keyword-only style (py-pydantic-ai): Pydantic AI Harness CodeMode refuses positional arguments. */
export const PY_API_KEYWORD = `${FILTER_AND_MESSAGE}
# All parameters are keyword-only.

async def search(*, query: str, opts: dict | None = None) -> list[dict]:
    """Ranked search. opts holds Filter keys plus "k" (default 10, max 50) and "mode": "hybrid" (default) fuses
    BM25 keyword search and embedding search with reciprocal rank fusion, "keyword" is BM25 only, "semantic" is
    embeddings only. Filters narrow before ranking. Each result is a Message plus "score" and "snippet"."""

async def grep(*, pattern: str, opts: dict | None = None) -> dict:
    """Regex over the full text of every message (headers and body), ripgrep syntax, case-insensitive unless
    opts["caseSensitive"]. opts holds Filter keys plus "limit" (default 50, max 500) and "caseSensitive".
    Returns {"totalFiles": int, "hits": list[Message + "line"]}: totalFiles counts every matching message after
    filters; hits holds the first limit with the first matching line."""

async def messages(*, filter: dict | None = None) -> list[dict]:
    """Metadata query, no text matching. Sorted by date. filter may also hold "limit" (default 100, max 5000)."""

async def count(*, filter: dict | None = None) -> int:
    """Exact number of messages matching a metadata filter (no limit)."""

async def people(*, name_or_email: str) -> list[dict]:
    """Resolve a name or address fragment to sender addresses, most active first.
    Each: {"email": str, "names": list[str], "sent": int, "received": int}."""

async def read(*, id: str) -> dict | None:
    """One full message (a Message plus "body", capped at 20k chars), or None. Check for None before indexing."""

# Example: await count(filter={"from": "vince.kaminski", "after": "2001-04-01", "before": "2001-05-01"})`;

/** FastMCP CodeMode style (py-fastmcp): one function, call_tool(name, params), with flat params per tool. */
export const PY_API_CALL_TOOL = `# Only one function is in scope:
async def call_tool(tool_name: str, params: dict) -> dict: ...

# Tools and their params (flat dicts; Filter keys may be added to search, grep, messages and count):
# Filter keys, all optional:
#   "from": substring of sender address or display name    "to": substring of a To or Cc address
#   "involves": substring of sender or any recipient        "after": ISO date, inclusive
#   "before": ISO date, exclusive                           "subjectContains": substring of the subject
# Message: {"id", "date", "from", "fromName", "to": [..], "cc": [..], "subject", "custodian", "folder"}
#
# "search"   {"query": str, "k"?: int (default 10, max 50), "mode"?: "hybrid" | "keyword" | "semantic", ...Filter}
#            Ranked search; "hybrid" (default) fuses BM25 and embeddings with reciprocal rank fusion.
#            Returns {"result": [Message + "score" + "snippet", ...]}
# "grep"     {"pattern": str, "limit"?: int (default 50, max 500), "caseSensitive"?: bool, ...Filter}
#            Regex (ripgrep syntax, case-insensitive by default) over full message text.
#            Returns {"totalFiles": int, "hits": [Message + "line", ...]}; totalFiles counts every match.
# "messages" {"limit"?: int (default 100, max 5000), ...Filter}   Metadata query sorted by date.
#            Returns {"result": [Message, ...]}
# "count"    {...Filter}   Exact number of matching messages. Returns {"result": int}
# "people"   {"nameOrEmail": str}   Sender addresses, most active first.
#            Returns {"result": [{"email", "names", "sent", "received"}, ...]}
# "read"     {"id": str}   One full message, body capped at 20k chars. Returns {"result": Message + "body" or None}
#
# Example: n = (await call_tool("count", {"from": "vince.kaminski", "after": "2001-04-01", "before": "2001-05-01"}))["result"]`;

const NO_NET = "The sandbox has no network or filesystem and runs a Python subset (Monty): json, re, collections, datetime, math, itertools, functools and asyncio import; most other modules do not.";

export const pyGuide = (api: string, how: string) => `You have one tool, execute. It runs Python in a sandbox where these async functions are already defined (do not import or redefine them):

\`\`\`python
${api}
\`\`\`

${how} ${NO_NET}`;

export const MONTY_HOW =
  "Every corpus function is async: use `await` (top-level await works), and `await asyncio.gather(...)` after `import asyncio` to run independent calls at the same time. Write a program that does the whole search in one call when you can: filter, loop, count and join in code, then print() only what you need to see. Printed output comes back to you, followed by the value of a final bare expression if there is one. State does not persist between executions.";

export const PYDANTIC_AI_HOW =
  "Every corpus function is async and keyword-only: `await count(filter={...})`, never positional. Use `await asyncio.gather(...)` after `import asyncio` to run independent calls at the same time. Each program is type-checked before it runs, and type errors come back to you; `read` can return None, so check before indexing. Write a program that does the whole search in one call when you can, then print() only what you need to see. Printed output comes back to you, followed by the value of a final bare expression if there is one. At most 100 corpus calls per execution. State does not persist between executions.";

export const FASTMCP_HOW =
  "Every call is `await call_tool(name, params)`; use `await asyncio.gather(...)` after `import asyncio` to run independent calls at the same time. Only the value you `return` (or a final bare expression) comes back to you: print() output is discarded. Errors are masked: an uncaught exception comes back only as \"Error calling tool 'execute'\", so wrap risky code in try/except and return the error text yourself. At most 50 call_tool calls per execution. Write a program that does the whole search in one call when you can and return only what you need to see. State does not persist between executions.";

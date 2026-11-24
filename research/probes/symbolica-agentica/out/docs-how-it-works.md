# Symbolica Agentica, "How It Works" (quotes)

Source: https://docs.symbolica.ai/concepts/how-it-works, fetched 2026-11-22. Only the passages this survey cites are quoted here.

From the overview:

> - **Warp bridge**: Functions you pass in scope appear in the sandbox as stubs, but execute in your runtime
> - **Objects are warped**: Return values from your functions are represented as lightweight proxies in the sandbox, not fully serialized

> When you pass async functions from your runtime, they appear in the REPL as functions returning `Future[T]`

From "What Happens Behind the Scenes", step 1, the request to the model includes:

> - The signatures and docstrings of functions in scope
> - The details of the types in scope
> - The details of the expected return type

Step 2:

> The agent interactively writes and evaluates code in a sandboxed REPL environment.

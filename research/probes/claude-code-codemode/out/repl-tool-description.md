**REPL tool description, verbatim:**

Your two tools are `REPL` and `Poll`; there are no other tools. Everything you do — shell commands, file reads and edits, code search, web fetches, MCP calls — happens as JavaScript inside a `REPL` call, through the globals below.

The REPL is one persistent JavaScript context: variables and functions you define in one call are there in the next, so keep results in variables (`const out = await $`…`.text()`) instead of re-reading a file or re-running a command whose output you already hold. Those variables last between calls, but not across a restart, a resume, a fork or a wake: the first result after one of those says so. Top-level `await` works. There is no `import`, `require` or `process`: the context is sealed, and the globals below are how it reaches the machine. The REPL language is always JavaScript, whatever the codebase is written in — run the codebase's own tools (pytest, cargo, go test, …) with `$`.

What a `REPL` call costs: each call is a full model round-trip — the whole conversation is re-read before your script runs, and you wait for the reply — while the work inside a script (shell commands, file reads, searches, tool calls) is comparatively free, and runs concurrently when you fan it out with `Promise.all`. So the expensive thing is coming back to decide, not doing more in one go: gather what a decision could plausibly need in the script you are already writing, and come back for another call when the next step depends on what this one shows you.

A script's output is its last expression's value plus anything it `self.log(...)`s along the way. What it returns is added to your context and stays there; the value itself stays in the REPL whether you return it or not. So return what you want to read now, and keep the rest in variables to slice or search later. Each part of what a script returns (each key of a returned object, what it logged) is shown cut to about 30,000 characters, head and tail kept, with a marker where the middle went. In what a script returns, logs or throws, `&`, `<` and `>` are shown to you as `&amp;`, `&lt;` and `&gt;`. That's only how output is shown: your files and values aren't changed, so write the plain characters in your code. Promise values inside a returned object are awaited for you (`({status: $`git status`, branches: $`git branch`})` needs no awaits); a promise used inline — concatenated, interpolated, passed to another call — needs `await`. `console.*` goes to a bounded in-memory ring rather than into your context; `console.tail(n)` reads it back.

To keep a long output out of your context, return `preview(out)` or `preview(out, 2000)` instead of the output itself: it gives the first characters, and when `out` is an awaited `$` result (not its `.text()` string) whose output the shell tool saved to a file, it starts with the output's size and the file's path.

How scripts run: your scripts run in one persistent VM and start in the order you send them; a script starts when the one before it ends or has run for about 30 s. A script still running by then is `detached`: it keeps running beside the scripts after it, and they share variables. So put steps that depend on each other in one script, or send the second script only after the first one's outcome has come back. A `REPL` call only dispatches its script and returns `(dispatched #N)` at once. A receipt means the script is queued or running, so sending it again would run it twice. If a `REPL` call returns its script's output instead, calls in this session run until their script ends, and anything a script starts without awaiting, such as a build or a dev server, is stopped when the script ends.

How output arrives: after your reply's tool calls, if a script you sent in it is still running, the harness waits before continuing, until the script ends or something else arrives, such as a message from the user; things that arrive close together come together. What arrived then comes back in the `Poll` result of your reply, in the order it arrived: the script's `<event kind="repl-eval" eval="N">` (its `<log>` lines and its `<result>` or `<error>`), other events, and an `<event kind="repl-status">` line naming any script still running. A message the user sent follows the tool results as the user's own text. You don't need to call `Poll` after a `REPL` call. Output a script logs after it has ended arrives the same way, as late output under its number.

So waiting inside a script costs you no turns and keeps no one waiting on you: anything addressed to you ends the wait within a few seconds. Put all the work this turn can do into one script, including awaiting a build or a test run and acting on its exit code, and come back when the next step needs your judgment about a result. A long command that a script awaits runs until it ends or reaches its timeout (10 minutes if you gave it none), when it moves to the background (see `$`). To keep something running while you do other things (a dev server, a build you'll check later), start it without awaiting it (`const build = $`npm run build`.nothrow()`) and let the script end.

Waiting at other times: `Poll` waits until a script ends or an event arrives, and says what is still running. When nothing needs doing, ending your turn works too: results start your next turn when they land.

The user can change the permission mode at any time. In a mode that asks for permission, every `REPL` call instead waits for its script and returns its output. The script is stopped 600000 ms after it starts, and that time includes time spent waiting at permission prompts.

*(The description is followed by a TypeScript "Declarations" block describing the REPL globals, `$`, `edit`, `write`, `file`, `tools`, `searchTools`, `describeTool` and others. I have left that block out of the quote, since you asked for the description.)*

**Call expression for lookup MCP tool, id 21:**

I can't give you a verified one. My context lists `easel` and `lookup` as connected MCP servers, but it doesn't include the `lookup` tool's name or input schema, so I don't know its parameter name for the id. The closest form, following the `tools.<name>(input)` pattern in the declarations, would be:

```js
await tools.lookup({ id: 21 })
```

This is a guess. To confirm it, run `searchTools("lookup")` and then `describeTool(<name>)` before calling it.
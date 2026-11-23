```ts
// The globals of a REPL script, as TypeScript declarations. interface Tools covers the built-in tools a script can call that aren't in your tool list; long doc lines are cut short, and describeTool(name) returns a tool's description and full input schema. searchTools finds the others, such as MCP tools.
/** The shell. The template text goes to the shell as written, except that \` and \${ lose their backslash, so a backtick or ${ the shell should see literally goes in as a ${} value. $ single-quotes each string ${} value itself as one argument (an array: one per item; ${{raw: s}} splices s unquoted), so write ${x} bare: inside quote marks of your own, the quotes $ added no longer protect the value, and shell syntax in it can run. $(cmd, ms) runs a command given as a plain string, with an optional timeout in ms. Resolves to a ShellOutput; .nothrow() hands it back whatever the exit code. A non-zero exit throws a ShellError. An exit 1 from a line whose last command is grep (also rg, egrep, fgrep), find, diff, test or `[`, git diff or git grep is read as that command's outcome (no match, an unreadable directory, files differ, a false test) and does not throw: exitCode is 1 and note gives the reading. The whole output of a command that would not throw even without .nothrow() is yours even when large: file names the spill file, which holds the first 64 MiB, and truncated means stdout holds only the start of the output, the rest being in that file. A failing command's output (with or without .nothrow()) has no file and can come back with its middle cut out; the end of a very long failing output can be missing too. A command with no timeout of its own is awaited for up to 600000 ms; give it a longer one (at most 7200000 ms) to await a long build. Past its timeout the command moves to the background (one that starts with sleep is stopped instead): the await resolves without throwing, with exitCode null and running naming the task and the file its output streams to, and the script goes on. So check running before using its output or exit code, and read that file instead of running the command again. */
declare function $(strings: TemplateStringsArray, ...values: unknown[]): ShellPromise;
declare function $(cmd: string, timeoutMs?: number): ShellPromise;
declare namespace $ {
    function escape(s: string): string;
    const ShellError: new (out: ShellOutput) => ShellError;
}
interface ShellPromise extends Promise<ShellOutput> {
    nothrow(): ShellPromise;
    throws(on: boolean): ShellPromise;
    quiet(): ShellPromise;
    timeout(ms: number): ShellPromise;
    cwd(dir: string): ShellPromise;
    env(vars: Record<string, string>): ShellPromise;
    /** called right after $ with no await in between, as in await $`cmd`.text(), they read the whole output, up to 64 MiB, when Claude Code could read it */
    text(): Promise<string>;
    lines(): Promise<string[]>;
    json(): Promise<unknown>;
    /** once the command has ended: true when none of Claude Code's checks found that these readers return less than the command printed */
    whole?: boolean;
}
interface ShellOutput {
    /** the command's stderr is merged into stdout, so 2>&1 adds nothing; stderr holds the shell tool's own notices, or else the same text as error */
    stdout: string;
    stderr: string;
    /** null while it runs on in the background (running) */
    exitCode: number | null;
    /** they read stdout; each throws a ShellError while the command is still running */
    text(): string;
    lines(): string[];
    json(): unknown;
    /** the text the result shows: stdout, then [stderr], [error] and [exit N] when there are any */
    output: string;
    /** file: the spill file; truncated: stdout holds only the start of the output; whole: none of Claude Code's checks found that the readers return less than the command printed */
    truncated: boolean;
    whole: boolean;
    file?: string;
    bytes?: number;
    /** a PostToolUse hook rewrote the start of a saved output and gave no path to the rest; stdout holds only the hook's text */
    withheld?: true;
    /** outlived its timeout; runs on, output streaming to outputPath */
    running?: {
        taskId: string;
        outputPath: string;
    };
    /** why the call failed outside the command (a denial, a refusal, an interruption); the shell tool's reading of its exit */
    error?: string;
    note?: string;
}
interface ShellError extends Error {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    running?: {
        taskId: string;
        outputPath: string;
    };
}
/** An exact-string edit (next inserted literally; a replacement string given to String.prototype.replace is not, since it expands $&, $`, $', $$ and $1, so s.replace(a, () => b) passes a function, which inserts b as it is); throws on zero or several matches, {all} replaces every match, {soft} resolves {ok: false, error} instead. The batch form checks every anchor, in order, before it writes, so an anchor not found, or found more than once without {all}, leaves the file untouched; a failure after that (a permission denial, say) leaves the edits before it applied. */
declare function edit(path: string, old: string, next: string, opts?: {
    all?: boolean;
    soft?: boolean;
}): Promise<{
    ok: boolean;
    replacements: number;
    error?: string;
}>;
declare function edit(path: string, edits: [old: string, next: string][], opts?: {
    all?: boolean;
    soft?: boolean;
}): Promise<{
    ok: boolean;
    replacements: number;
    error?: string;
}>;
/** Writes a whole file (directories created); resolves the byte count. */
declare function write(path: string, content: string): Promise<number>;
/** One file, read when a method is called; a relative path is from the working directory. */
declare function file(path: string): {
    name: string;
    text(): Promise<string>;
    json(): Promise<unknown>;
    lines(): Promise<string[]>;
    exists(): Promise<boolean>;
    /** lines from the 1-based line offset, at most limit */
    slice(offset?: number, limit?: number): Promise<string>;
};
/** Resolves after ms. */
declare function sleep(ms: number): Promise<void>;
/** The first n chars (200 by default) of the value turned into text with String(), with a …[+N chars] marker when it cuts, so a ShellOutput gives its output field; null and undefined give ''. A $ result whose output the shell tool saved to a file (file and bytes are set) gives that tool's line with the output's size (or the 64 MB limit, when the output reached it) and the file's path instead, then at most n chars from the start of stdout (then ... if cut), then any [stderr], [error] and [exit N] lines. @example preview(await $`bun test`.nothrow(), 2000) @example preview(await file('build.log').text(), 500) */
/** an awaited $ result, or await file(path).text() */
declare function preview(output: ShellOutput | string, n?: number): string;
declare function preview(value: unknown, n?: number): string;
/** The output channel: each call is a line delivered with the result. */
declare function log(...args: unknown[]): void;
/** globalThis, so self.log and self.running are log and running. */
declare const self: typeof globalThis;
/** Scripts still holding work (settled: returned, with calls it did not await still running; self: true for the script that is asking); abort() stops one: its shell commands are killed and its body ends interrupted, and one still waiting for its turn never starts. A command a script started and did not await keeps running after the script returns, and what its .then(self.log) logs arrives later under that eval's number as late output. A shell command that has moved to the background (its output's running field is set) is no longer the script's work: its await has resolved, and abort() does not stop it. */
declare function running(): {
    id: number;
    snippet: string;
    ageMs: number;
    state: 'waiting' | 'running' | 'detached' | 'late';
    settled: boolean;
    self: boolean;
    abort(): true;
}[];
/** A bounded ring, not delivered with the result; tail(n) reads its last n lines back. */
declare var console: {
    log(...args: unknown[]): void;
    info(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    tail(n?: number): string;
    buffer(): string;
    dropped(): number;
};
/** A timer; its callback runs as part of the script that set it, and the timer is cleared when that script ends, so one due after that never fires. */
declare function setTimeout(fn: () => void, ms?: number): number;
/** Cancels a timer. */
declare function clearTimeout(id: number): void;
/** As setTimeout, repeating. */
declare function setInterval(fn: () => void, ms?: number): number;
/** Cancels an interval. */
declare function clearInterval(id: number): void;
/** Base64 to a binary string, one character per byte. */
declare function atob(data: string): string;
/** A binary string to base64; throws on a character above U+00FF. */
declare function btoa(data: string): string;
type JSONSchema = Record<string, unknown>;
/** The tools a script can call, by words from their name or description; input is the tool's parameters written as a TypeScript type, such as {query: string, limit?: number}. Resolves {error} for an empty query. */
declare function searchTools(query: string, max?: number): Promise<{
    name: string;
    about: string;
    input: string;
}[] | {
    error: string;
}>;
/** One tool's description and input schema; {error} for a name no tool has. */
declare function describeTool(name: string): Promise<{
    name: string;
    description: string;
    inputSchema: JSONSchema;
} | {
    error: string;
}>;
/** Every tool of this session by name, with its usual input (each is a bare global too); a built-in resolves {error} on failure; an MCP tool throws (e.message carries the tool error, e.detail the parsed body when it was JSON). In a subagent, or a session run as an agent, Tools can list a file or shell tool that agent isn't given; it is missing from tools.list() and calling it throws, so check tools.list() first. */
declare var tools: Tools & {[name: string]: (input: Record<string, unknown>) => Promise<unknown>} & {list(): string[]}
interface Tools {
  Agent(input: {
    /** A short (3-5 word) description of the task */
    description: string
    /** The task for the agent to perform */
    prompt: string
    /** The type of specialized agent to use for this task */
    subagent_type?: string
    /** Optional model override for this agent. Takes precedence over the agent definition's model frontmatter and the… */
    model?: "sonnet" | "opus" | "haiku" | "fable"
    /** Reasoning effort for this agent. Set this ONLY when the user, or instructions such as CLAUDE.md or a skill, explicitly… */
    effort?: "low" | "medium" | "high" | "xhigh" | "max"
    /** Isolation mode. "worktree" creates a temporary git worktree so the agent works on an isolated copy of the repo. … */
    isolation?: "worktree" | "remote"
  }): Promise<unknown>
  Artifact(input: {
    /** One of 'publish', 'list', 'read', 'delete', 'open', 'pin', 'unpin', 'quickstart'. … */
    action?: "publish" | "list" | "read" | "delete" | "open" | "pin" | "unpin" | "quickstart"
    /** publish: the local page Claude publishes (.html, or .md only when a skill says so). … */
    file_path?: string
    /** publish with `url`: true uploads `file_path` (or each of `file_paths`) to that artifact's asset store instead of… */
    asset?: boolean
    /** publish with `asset: true` only: several local image, video, PDF, font, stylesheet or script files in place of… */
    file_paths?: string[]
    /** publish with `asset: true`, in place of `file_path`: the SOURCE artifact's claude.ai URL — one the person can open. */
    from_url?: string
    /** publish with `asset: true` and `from_url` only: 1–10 distinct asset ids from the source artifact (from a `scope:… */
    asset_ids?: string[]
    /** Deprecated; Claude omits it and uses `icon`. */
    favicon?: string
    /** One short generic word for the artifact's browser-tab icon, such as chart, calendar, recipe, code or map: a plain… */
    icon?: string
    /** Supporting files to publish alongside the page, as a map {"published/path": "source/path" | {from, contentType} |… */
    files?: Array<{
      /** Path relative to the working directory (or to `root`, which may be a folder in your scratchpad directory); the file is… */
      path: string
      /** Servable media type; inferred from the extension for common types (css/js/json/png/…) — pass explicitly otherwise. */
      contentType?: string
    }> | unknown
    /** publish: small changes Claude makes to the file at `file_path` in this same call, instead of editing the file with Edit… */
    edits?: Array<{
      /** Text copied exactly from the file; must occur once. */
      old_str: string
      /** Its replacement; empty deletes old_str. */
      new_str: string
    }>
    /** The base directory that relative `files` sources resolve against, like a bundler root. … */
    root?: string
    /** publish only: true also pins the published artifact to the person's claude.ai sidebar once it is published. … */
    pin?: boolean
    /** list only: the maximum number of artifacts to return (default 25). */
    limit?: number
    /** list only: the `next_page_token` a listing of the same scope gave, to list the artifacts after it. */
    page_token?: string
    /** list: which listing to return. 'mine' is the default. The others are 'shared', 'all', 'types', 'files' (with `url`) and… */
    scope?: "mine" | "shared" | "all" | "types" | "files" | "assets"
    /** list with scope 'types' only: limits the listing to the types whose title or description match this text best, ignoring… */
    type_query?: string
    /** list only: the name of a published Artifact type, as a 'types' listing shows it (case does not matter). … */
    type?: string
    /** quickstart only (required): what is being made — 'document' (writing people will keep editing or pass around as text,… */
    intent?: "document" | "slides" | "design" | "other"
    /** quickstart only: false when a design system's link is already in hand (it is then read with its own call) or one was… */
    design_systems?: boolean
    /** publish: the fallback title for an HTML page whose file has no <title>. … */
    title?: string
    /** publish: one sentence for the subtitle on the gallery card. */
    description?: string
    /** A short name for this publish, at most 60 characters (e.g. "Draft to legal"). Optional. … */
    label?: string
    /** publish with `files` or `root` to an existing artifact: published paths this call may replace or remove although you… */
    overwrite_unread?: string[]
    /** An existing artifact's claude.ai link (claude.ai/artifact/{id} or claude.ai/code/artifact/{uuid}); a chat, project or… */
    url?: string
    /** publish: the Artifact type to create this new, private Artifact from (a link from a 'types' listing). … */
    type_url?: string
    /** Only with `type_url` and no `file_path`: when the new Artifact opens for the person. … */
    auto_open?: "at_create" | "after_first_write"
    /** read, for an artifact shared with the person: what Claude needs from it, which steers the isolated summary. */
    prompt?: string
    /** publish: a last-resort overwrite that **discards** the newer published version. … */
    force?: boolean
    /** read with `path`: the directory to save into. The default is this artifact's folder in Claude's scratchpad directory,… */
    out_dir?: string
    /** read: the file's published path inside the artifact, exactly as a 'files' listing printed it ("index.html" is the page… */
    path?: string
    /** read: several published paths in place of `path`, up to 256 in one call. … */
    paths?: string[]
    /** list with scope 'assets' only: the `next` value from a previous listing, passed to continue it. */
    after?: string
    /** read only: true returns the rendered page in cases where a read otherwise returns something else. … */
    page?: boolean
    /** publish: the runtime capabilities this page declares, as {name: config}. … */
    capabilities?: unknown
    /** publish: the artifact's runtime version. Leaving it out keeps the current version (the default), 'latest' upgrades, and… */
    contract?: "latest" | string
  }): Promise<unknown>
  AskUserQuestion(input: {
    /** Questions to ask the user (1-4 questions) */
    questions: Array<{
      /** The complete question to ask the user. Should be clear, specific, and end with a question mark. … */
      question: string
      /** Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach". */
      header: string
      /** The available choices for this question. Must have 2-4 options. … */
      options: Array<{
        /** The display text for this option that the user will see and select. … */
        label: string
        /** Explanation of what this option means or what will happen if chosen. … */
        description: string
        /** Optional preview content rendered when this option is focused. … */
        preview?: string
      }>
      /** Set to true to allow the user to select multiple options instead of just one. … */
      multiSelect: boolean
    }>
    /** User answers collected by the permission component */
    answers?: unknown
    /** Optional per-question annotations from the user (e.g., notes on preview selections). Keyed by question text. */
    annotations?: unknown
    /** Optional metadata for tracking and analytics purposes. Not displayed to user. */
    metadata?: {
      /** Optional identifier for the source of this question (e.g., "remember" for /remember command). … */
      source?: string
    }
  }): Promise<unknown>
  Edit(input: {
    /** The absolute path to the file to modify */
    file_path: string
    /** The text to replace */
    old_string: string
    /** The text to replace it with (must be different from old_string) */
    new_string: string
    /** Replace all occurrences of old_string (default false) */
    replace_all?: boolean
  }): Promise<unknown>
  ListAgents(input: {
    /** Not available in this build; leave unset. */
    channel?: string
    /** Not available in this build; leave unset. */
    q?: string
  }): Promise<unknown>
  ReportFindings(input: {
    /** Effort level the review ran at */
    level?: "low" | "medium" | "high" | "xhigh" | "max"
    /** Verified findings, most-severe first; empty if none survived */
    findings: Array<{
      /** Repo-relative path of the file the finding is in */
      file: string
      /** 1-indexed line the finding anchors to */
      line?: number
      /** One-sentence statement of the defect */
      summary: string
      /** Compressed label for compact UI (≤60 chars): the claim alone, no rationale or consequence clause */
      short_summary?: string
      /** Concrete inputs/state → wrong output/crash */
      failure_scenario: string
      /** Short kebab-case slug of the finding type, e.g. "correctness", "simplification", "efficiency", "test-coverage" */
      category?: string
      /** Set when a verify pass ran; absent on inline-only reviews */
      verdict?: "CONFIRMED" | "PLAUSIBLE"
      /** Set ONLY when re-reporting after applying fixes: what happened to this finding */
      outcome?: "fixed" | "skipped" | "no_change_needed"
    }>
  }): Promise<unknown>
  ScheduleWakeup(input: {
    /** Seconds from now to wake up. Clamped to [60, 3600] by the runtime. Required unless `stop` is true. */
    delaySeconds?: number
    /** One short sentence explaining the chosen delay. Goes to telemetry and is shown to the user. Be specific. … */
    reason?: string
    /** The /loop input to fire on wake-up. Pass the same /loop input verbatim each turn so the next firing re-enters the skill… */
    prompt?: string
    /** Set to true to end the dynamic loop immediately instead of scheduling another wakeup. … */
    stop?: boolean
    /** true = nothing changed (you checked and there is nothing to report). false = something happened worth keeping (edited a… */
    noop?: boolean
  }): Promise<unknown>
  SendFeedback(input: {
    /** What kind of feedback this is. */
    type: "bug" | "idea" | "missing_capability"
    /** Short, specific one-line summary of the issue. */
    title: string
    /** Labeled bullets, in order: **What happened:** (observed vs. expected, exact error text if short); **What the user… */
    details: string
    /** Optional short tag naming the part of Claude Code this is about (e.g. "hooks config", "/help", "file editing"). … */
    area?: string
    /** When the report is about MODEL BEHAVIOR (not a product bug), the closest failure mode, or `other` when it is a… */
    failure_mode?: "instruction_following" | "destructive_actions" | "code_quality" | "repetition_and_looping" | "model_regression" | "overconfidence_and_hallucination" | "context_and_memory" | "overeager" | "over_correction" | "stopping_short" | "dispute_or_decline" | "subagent_overspawn" | "tone_or_preachiness" | "excessive_questions" | "unwanted_scope" | "other"
    /** What kind of task the session was doing when the issue occurred, or `other` when it is a clear task that fits no listed… */
    task_category?: "code_edit" | "debug" | "explain" | "plan" | "shell" | "search" | "review" | "other"
  }): Promise<unknown>
  Skill(input: {
    /** The name of a skill from the available-skills list. Do not guess names. */
    skill: string
    /** Optional arguments for the skill */
    args?: string
  }): Promise<unknown>
  Workflow(input: {
    /** Self-contained workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal, no… */
    script?: string
    /** Name of a predefined workflow (built-in or from .claude/workflows/). Resolves to a self-contained script. */
    name?: string
    /** Ignored — set the workflow description in the script's `meta` block. */
    description?: string
    /** Ignored — set the workflow title in the script's `meta` block. */
    title?: string
    /** Optional input value exposed to the script as the global `args`, verbatim. … */
    args?: unknown
    /** Path to a workflow script file on disk. Every Workflow invocation persists its script under the session directory and… */
    scriptPath?: string
    /** Run ID of a prior Workflow invocation to resume from. Completed agent() calls with unchanged (prompt, opts) return… */
    resumeFromRunId?: string
  }): Promise<unknown>
  Write(input: {
    /** The absolute path to the file to write (must be absolute, not relative) */
    file_path: string
    /** The content to write to the file */
    content: string
  }): Promise<unknown>
  Read(input: {
    /** The absolute path to the file to read */
    file_path: string
    /** The line number to start reading from. Only provide if the file is too large to read at once */
    offset?: number
    /** The number of lines to read. Only provide if the file is too large to read at once. */
    limit?: number
    /** Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request. */
    pages?: string
    /** Set to true to read a text file, or a line range of one, that is over the usual size limits, up to what still fits in… */
    allow_large?: boolean
  }): Promise<unknown>
  Glob(input: {
    /** The glob pattern to match files against */
    pattern: string
    /** The directory to search in. If not specified, the current working directory will be used. … */
    path?: string
  }): Promise<unknown>
  Grep(input: {
    /** The regular expression pattern to search for in file contents */
    pattern: string
    /** File or directory to search in (rg PATH). Defaults to current working directory. */
    path?: string
    /** Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob */
    glob?: string
    /** Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit),… */
    output_mode?: "content" | "files_with_matches" | "count"
    /** Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise. */
    "-B"?: number
    /** Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise. */
    "-A"?: number
    /** Alias for context. */
    "-C"?: number
    /** Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise. */
    context?: number
    /** Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true. */
    "-n"?: boolean
    /** Case insensitive search (rg -i) */
    "-i"?: boolean
    /** Print only the matched (non-empty) parts of each matching line, one match per output line (rg -o / --only-matching). … */
    "-o"?: boolean
    /** File type to search (rg --type). Common types: js, py, rust, go, java, etc. … */
    type?: string
    /** Limit output to first N lines/entries, equivalent to "| head -N". … */
    head_limit?: number
    /** Skip first N lines/entries before applying head_limit, equivalent to "| tail -n +N | head -N". … */
    offset?: number
    /** Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false. */
    multiline?: boolean
  }): Promise<unknown>
  Bash(input: {
    /** The command to execute */
    command: string
    /** Optional timeout in milliseconds (max 600000 for a foreground command) */
    timeout?: number
    /** Clear, concise description of what this command does in active voice. … */
    description?: string
    /** Set this to true to dangerously override sandbox mode and run commands without sandboxing. */
    dangerouslyDisableSandbox?: boolean
  }): Promise<unknown>
  // Also callable as tools.<name>(input); describeTool(name) returns each one's input schema: ArtifactComments, ArtifactData, CronCreate, CronDelete, CronList, DesignSync, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, Monitor, PushNotification, RemoteTrigger, SendMessage, TaskStop, WebSearch, NotebookEdit
}
```
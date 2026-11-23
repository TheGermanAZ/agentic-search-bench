"""pydantic-ai-harness CodeMode adapter: ONE Agent with the CodeMode capability shared by every execution;
each execution is a separate agent.run() whose scripted model calls run_code once with the prompt as code."""
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart, ToolReturnPart, RetryPromptPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai_harness import CodeMode

HARDENED = {"resource_limits": {"max_duration_seconds": 1.0, "max_memory": 10_000_000, "max_suspensions": 1000}, "max_tool_calls": 100}


class A:
    lang = "py"
    name = "pydantic-ai-harness-codemode"
    T = staticmethod(lambda args: f"lookup({args})")
    F = staticmethod(lambda args: "failing()")
    R = staticmethod(lambda args: "rich()")


async def make(config, host):
    def model(messages, info):
        last = messages[-1]
        for part in getattr(last, "parts", []):
            if isinstance(part, (ToolReturnPart, RetryPromptPart)):
                return ModelResponse(parts=[TextPart("done")])
        prompt = messages[0].parts[-1].content
        return ModelResponse(parts=[ToolCallPart("run_code", {"code": prompt})])

    agent = Agent(FunctionModel(model), capabilities=[CodeMode(**HARDENED) if config == "hardened" else CodeMode()])

    @agent.tool_plain
    async def lookup(id: int) -> dict:
        """Waits 200 ms, then returns {id, value: id * 2}."""
        return await host["lookup"](id)

    @agent.tool_plain
    async def failing() -> dict:
        """Always fails."""
        return await host["failing"]()

    @agent.tool_plain
    async def rich() -> dict:
        """Returns a rich object."""
        return await host["rich"]()

    a = A()
    a.notes = f"one Agent(capabilities=[CodeMode({HARDENED if config == 'hardened' else ''})]); agent.run() per execution"

    async def exec(code):
        r = await agent.run(code)
        outs = []
        for m in r.all_messages():
            for p in getattr(m, "parts", []):
                if isinstance(p, ToolReturnPart):
                    outs.append(p.content if isinstance(p.content, str) else repr(p.content))
                elif isinstance(p, RetryPromptPart):
                    outs.append("RETRY: " + str(p.model_response()))
        return outs

    a.exec = exec
    return a

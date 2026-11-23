"""langchain-quickjs adapter: ONE create_agent + CodeInterpreterMiddleware shared by every execution.
Each execution is a new LangGraph thread_id (a different user/conversation), as a multi-user server would run it.
A scripted model turns the human message into one `eval` call; the returned text is the ToolMessage the model sees."""
import uuid
import warnings

warnings.filterwarnings("ignore")
from langchain.agents import create_agent
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langchain_quickjs import CodeInterpreterMiddleware

CONFIGS = {
    "default": {"ptc": ["lookup", "failing", "rich"]},
    "hardened": {"ptc": ["lookup", "failing", "rich"], "timeout": 1.0, "memory_limit": 16 * 1024 * 1024, "max_ptc_calls": 8, "mode": "call", "subagents": False},
}


class Scripted(BaseChatModel):
    @property
    def _llm_type(self):
        return "scripted"

    def bind_tools(self, tools, **kw):
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kw):
        last = messages[-1]
        if isinstance(last, HumanMessage):
            msg = AIMessage(content="", tool_calls=[{"name": "eval", "args": {"code": last.content}, "id": f"c_{uuid.uuid4().hex[:8]}", "type": "tool_call"}])
        else:
            msg = AIMessage(content="done")
        return ChatResult(generations=[ChatGeneration(message=msg)])

    async def _agenerate(self, messages, stop=None, run_manager=None, **kw):
        return self._generate(messages, stop, run_manager, **kw)


class A:
    lang = "js"
    name = "langchain-quickjs"
    T, F, R = "tools.lookup", "tools.failing", "tools.rich"


async def make(config, host):
    @tool
    async def lookup(id: int) -> dict:
        """Look up a record by id."""
        return await host["lookup"](id)

    @tool
    async def failing() -> dict:
        """Always fails."""
        return await host["failing"]()

    @tool
    async def rich() -> dict:
        """Returns a rich object."""
        return await host["rich"]()

    agent = create_agent(model=Scripted(), tools=[lookup, failing, rich], middleware=[CodeInterpreterMiddleware(**CONFIGS[config])], checkpointer=InMemorySaver())
    a = A()
    a.notes = f"one agent, CodeInterpreterMiddleware({CONFIGS[config]}), new thread_id per execution"

    async def exec(code):
        res = await agent.ainvoke({"messages": [HumanMessage(content=code)]}, config={"configurable": {"thread_id": f"t-{uuid.uuid4().hex[:8]}"}})
        tm = [m for m in res["messages"] if isinstance(m, ToolMessage)]
        return tm[-1].content if tm else None

    a.exec = exec
    return a

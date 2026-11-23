import { defineApp, number, object, query, router } from "apps";
import { always, never } from "apps/operations/approval";

let calls = 0;

const Lookup = object({ id: number() });

const lookup = query(
  { description: "Wait 200 ms and return the id doubled", input: Lookup, approval: never() },
  async (_ctx, { id }) => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { id, value: id * 2, workerCalls: calls };
  },
);

const gated = query(
  { description: "Same as lookup but asks a person first", input: Lookup, approval: always() },
  async (_ctx, { id }) => ({ id, value: id * 2 }),
);

export default defineApp({}, { tools: router({ lookup, gated }) });

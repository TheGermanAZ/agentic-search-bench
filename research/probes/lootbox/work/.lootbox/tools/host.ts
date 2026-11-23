// The SPEC host tool. Lootbox runs this file in its own --allow-all worker process, so calls are counted in a file.
const COUNT_FILE = new URL("../../calls.log", import.meta.url);

export async function lookup(args: { id: number }): Promise<{ id: number; value: number }> {
  await new Promise((r) => setTimeout(r, 200));
  await Deno.writeTextFile(COUNT_FILE, `${Date.now()} ${args.id}\n`, { append: true });
  return { id: args.id, value: args.id * 2 };
}

import { client, lookup } from "./bridge.ts";
const r = await lookup({id: 21}); console.log(r.value)
client.close();

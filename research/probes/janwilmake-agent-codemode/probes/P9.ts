import { client, lookup } from "./bridge.ts";
const t = Date.now(); await Promise.all([1,2,3,4,5].map(i => lookup({id:i}))); console.log(Date.now()-t)
client.close();

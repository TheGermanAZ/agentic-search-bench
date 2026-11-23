// Follow-up P12 attempts through the JS objects that tool results are proxied as.
export * from "./config.mjs";
import { probes as base } from "./config.mjs";
const pre = `local r = probe.lookup({id = 1}):await()\n`;
export const probes = { ...base, P12: [
  pre + `local o = r.__proto__\nresult(type(o) .. " " .. tostring(o))`,
  pre + `local o = r.__proto__\nresult(type(o.constructor) .. " " .. type(o.__lookupGetter__))`,
  pre + `local O = r.constructor\nlocal keys = O.keys(r)\nresult(type(keys))`,
  pre + `local O = r.constructor\nlocal ok, e = pcall(function() return O("x") end)\nresult(tostring(ok) .. " " .. type(e))`,
  pre + `local ok, e = pcall(function() return r.constructor.constructor end)\nresult(tostring(ok) .. " " .. tostring(e))`,
  `local f = load(string.dump(function() return 1 end))\nresult(tostring(f and f()))`,
] };

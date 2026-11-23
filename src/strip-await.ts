/**
 * Removes `await` keywords that are code, leaving strings, comments and template text untouched.
 * The sandbox's corpus API is synchronous, so `await x` is just `x`; a regex over the whole source would also
 * rewrite text inside strings.
 */
export function stripAwait(code: string): string {
  let out = "";
  let i = 0;
  const isId = (c: string | undefined) => !!c && /[\w$]/.test(c);
  while (i < code.length) {
    const c = code[i]!;
    const next = code[i + 1];
    if (c === "/" && next === "/") {
      const end = code.indexOf("\n", i);
      const stop = end === -1 ? code.length : end;
      out += code.slice(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      const stop = end === -1 ? code.length : end + 2;
      out += code.slice(i, stop);
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === "\\" ? 2 : 1;
      out += code.slice(i, j + 1);
      i = j + 1;
    } else if (c === "`") {
      // Template text is kept; each ${ ... } expression is code and is processed recursively.
      out += c;
      let j = i + 1;
      while (j < code.length && code[j] !== "`") {
        if (code[j] === "\\") {
          out += code.slice(j, j + 2);
          j += 2;
        } else if (code[j] === "$" && code[j + 1] === "{") {
          let depth = 1;
          let k = j + 2;
          while (k < code.length && depth > 0) {
            if (code[k] === "{") depth++;
            else if (code[k] === "}") depth--;
            k++;
          }
          out += `\${${stripAwait(code.slice(j + 2, k - 1))}}`;
          j = k;
        } else {
          out += code[j];
          j++;
        }
      }
      out += "`";
      i = j + 1;
    } else if (code.startsWith("await", i) && !isId(code[i - 1]) && !isId(code[i + 5])) {
      i += 5;
      while (code[i] === " " || code[i] === "\t") i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

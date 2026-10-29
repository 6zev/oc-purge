/**
 * 把 `@opencode/plugin` 映到 test/stubs 下的替身。
 * 用法：node --import ./test/register-stubs.mjs --test test/*.test.mjs
 * 这样 CI 只需装 `effect`，不必装整个 OpenCode 宿主。
 */
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stub = new URL("./stubs/@opencode/plugin.mjs", import.meta.url).href;
const map = { "@opencode/plugin": stub };

register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(specifier, context, next) {
  const mapped = ${JSON.stringify(map)}[specifier];
  if (mapped) return { url: mapped, shortCircuit: true };
  return next(specifier, context);
}
`),
  import.meta.url,
);

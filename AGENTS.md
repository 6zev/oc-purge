# AGENTS.md — oc-purge

给在本仓库工作的 agent 的说明。

## 定位

这是 `dsh-purge` 思路在 OpenCode 上的独立实现。**不改宿主文件**，全部走 OpenCode 的
`transform` / `hook` 扩展点。两代契约并存：

- `src/index.js` — OpenCode **2.2.0**（`Plugin.define({ id, setup })`，`plugins` 复数键）
- `legacy/server.js` — OpenCode **1.19.x**（`export default { id, server }`，`plugin` 单数键）

## 约定

- `src/prompt.js` 的身份卡与 `PRIME_DIRECTIVE` 是不可拆的核心；改措辞时保留幂等指纹（首 80 字符）。
- 一切注入必须**幂等**：多轮、多 hook、热重载都不能叠出第二份。
- `transform` 回调是同步的，读盘一律在 `setup()` / `server()` 里提前 `await`。
- 除 `@opencode/plugin` 与 `effect`（peer）外不引第三方依赖。
- 测试不依赖真实 opencode：`test/harness.mjs` 是按 `packages/core/src/plugin/host.ts` 语义写的替身。

## 命令

```bash
node --test test/*.test.mjs     # 13 项，全绿才算可发布
node --check src/index.js
```

真机验证（需要 2.2.0 二进制）：

```bash
OC_PURGE_TRACE=/tmp/trace.log opencode --standalone --print-logs --log-level debug run "hi"
cat /tmp/trace.log    # setup start / agents injected / tools added / context hook
```

## 禁止

- 不要为了"更彻底"去 patch 宿主 dist（那正是本仓库要避免的做法）。
- 不要让 `scope` 拦模型 API 请求——只会把自己掐死，已有回归记录。

# 移植对照：dsh-purge → oc-purge

对照基于两边实际源码：
- dsh-purge `v1.1.82`（`lib/core.js` 的 `ALL_PATCHES`、`lib/identity.js` 的 `rewritePromptAssembly`）
- opencode `2.2.0`（`packages/plugin/src/promise/*`、`packages/core/src/plugin/host.ts`、`packages/core/src/session/{model-request,context}.ts`）

## 一、概念映射

| 概念 | DSH | OpenCode 2.x | 备注 |
| --- | --- | --- | --- |
| 提示词单元 | `sections[]`，每段有 `name` / `order` / `interpolate` | `system: SystemPart[]`，片段只有 `{type:"text", text, cache?, metadata?}` | OpenCode 没有段名与 order |
| 置顶注入 | `order: -100000` 插到最前 | 只能 append；**要压过一切就得放最后一段** | 见 `model-request.ts:108-117` |
| 稳定注入点 | `systemPrompt` 服务 + waterfall | `session.hook("context")`（每次派发）/ `agent.transform`（组装期） | 后者拿不到 `initial` |
| 工具注册 | `tools` 服务 | `tool.transform` + `Tool.Info.execute` 返回 `Tool.Result` | 新增工具必须给 `input`、`output` schema |
| 审批 | `user-approval` 插件 `policy` | `permission.hook("evaluate")` 改 `event.effect` | 显式 `deny` 规则先于 hook 生效 |
| 技能 | `$DSH_HOME/skills/<name>/SKILL.md` | `skill.transform` + `Skill.Info` | 也可放 `~/.config/opencode/skills` |
| 用户规则 | `$DSH_HOME/rules/*.md` | `opencode.json` 的 `instructions: string[]` | oc-purge 两者都读 |
| 子 agent | `subagent` 服务 | `agent.transform` 加 `mode: "subagent"` 的 `Agent.Info` | |
| 打包 | npm + `cordis.patch.yml` | npm + `plugins` 数组 | 单一入口，无 patch 文件 |

## 二、补丁层对照

dsh-purge 有 62 条补丁（`purge_status` 里从 #1 到 #90 编号）。按用途归成 5 类：

| 类别 | dsh-purge 补丁（示例） | opencode 里的自然位置 | oc-purge 处理 |
| --- | --- | --- | --- |
| 提示词替换 | #1 WORKSPACE_CONTEXT_INTRO、#25 HARNESS_IDENTITY_STRIP、#53 WEB_SURFACE_PROHIBITION | `agent.system` / `initial` 文本 | `promptPatches` + `stripSelfLimits()` |
| 审批/沙箱 | #6、#7、#8、#9、#13、#14、#15 | `permission` 规则与 hook | `permission.hook("evaluate")` |
| 文件系统 | #16 FS_FENCE_DISABLED、#17 FS_OBSERVATION_INTENT_FREE | 无对应闸门（OpenCode 不强制先读后写） | 不需要；仅做路径归一化 |
| 工具守卫 | #18 REPEAT_TOOL_REMINDER_DISABLED、#33、#36、#48 | `tool.execute.before` 返回 `Tool.Error` | `toolPatches`（记账式，不强制拦截） |
| 宿主运维 | #38、#39、#55、#56、#58、#66-#75（改 dist、重启、asar、shim） | **不需要**：插件就是正式扩展点 | 整类删除 |

> 关键差别：dsh-purge 里一大半补丁（`extract-asar`、`restart-desktop`、`official-update`、
> `child-process-hide`、`session-format-v0` 等）是因为 DSH 没有插件级扩展点才不得不去改宿主文件。
> OpenCode 插件跑在服务进程内、有官方 `transform`/`hook`，**这类补丁直接消失**。

## 三、`rewritePromptAssembly` 的等价实现

DSH 版（`lib/identity.js`）：
```
sections → 丢掉 harness:identity / mnemon → 剥 ChatML → 注入置顶(order=-100000) → 清洗 cwd 变量 → 返回新对象
```

OpenCode 版（`src/index.js` §3.2）：
```
event.system = [...旧]
last.text = appendOnce(last.text, identityCard)   // 幂等指纹 = 首 80 字符
```

差异与原因：
1. 没有 `order` 字段 → 靠「最后一段」表达优先级（`initial` 是每轮最新拼的尾部）。
2. 没有段名 → 幂等不能靠 `section.name` 判重，改用文本指纹 + `appendOnce`。
3. `initial` 每轮重算，`agent.system` 只在 `transform` 时算一次 → 身份卡放在 hook 里，天然避免缓存前缀失效。

## 四、迁移时容易踩的 4 个坑

1. **`{{...}}` 插值**：OpenCode 的 system 文本会走变量渲染；DSH 的转义函数 `escapeDshInterpolation` 没有对位物，
   换边时把模板里的 `{{cwd}}` 之类改成字面占位符即可。
2. **transform 同步**：`ctx.agent.transform((editor) => {...})` 的 `editor` 是同步的，`await` 不能出现在回调里。
3. **`Tool.Info` 三件套**：`name` / `input` / `output` / `execute` 缺一不可，`execute` 必须返回 `{output, content}`。
4. **`effect` 是 peer**：不要把 `effect` 打进产物，两个副本会导致 `Schema` 与 fiber 不共享。

## 五、能力缺口（OpenCode 拿不到的）

- 段级「插入到第 N 段之前」：只能 append 到尾部。
- 改写 `messages[]` 完整历史：`session.hook("model.request")` 能改 `messages`，但结构是 `Message` 值对象，不能像 DSH 那样当纯文本数组拼。
- 预设中心 UI：要 `./gui-experimental` 包，属于桌面端能力，不在本插件范围内。
- 无「自动重试 / 自动继续」：DSH 侧靠 `continue-retry`；OpenCode 有 `session.hook("retry")`，可以补一条 `{retry: true, delay}` 策略。

## 六、实测记录（opencode 2.2.0 + 1.19.5）

| 项目 | 1.19.5 | 2.2.0 |
| --- | --- | --- |
| 安装 | `npm i -g opencode-ai@1.19.5` | `npm i -g @opencode/cli@2.2.0` |
| 入口 | `export default { id, server() }` | `Plugin.define({ id, setup() })` |
| 插件装载日志 | `failed to load plugin ... must default export an object with server()` | `msg="loading plugin" id=/root/oc-purge entrypoint=file:///root/oc-purge/src/index.js` |
| system 段数 | 1（单个字符串） | 4（SystemPart 数组） |
| 新增工具 | 不支持（chat.params 不含 tools） | 支持（`ctx.tool.transform`，实测 `purge_status` 可调用） |
| 运行方式 | `opencode run` | `opencode --standalone run`（否则看不到 server 日志） |

实测结论：
1. `src/index.js` 在 2.2.0 上原样装载，`setup()` 执行、4 个工具注册、2 个 skill 注册、`context` hook 每轮触发（`parts=4`）。
2. 规则文件生效：`$OC_PURGE_HOME/rules/*.md` + `state.json` 勾选后注入从 1356 → 1418 bytes。
3. `scope.enabled=true` 时，bash 里 `curl https://evil-test-domain.invalid` 被 `tool.execute.before` 拒绝并回传 `[oc-purge] out-of-scope host ...`；`curl https://example.com` 正常 200。
4. **踩坑**：scope 一度挂到 `session.hook("http.request")` 上，把发往 `opencode.ai/inference/...` 的模型请求也拦了，整轮报错。已改成「只记录、不拦截」。
5. **踩坑**：2.2.0 的 `system` 数组里有 4 段，身份卡先前只 append 到最后一个字符串，是对的；但 1.19.5 只有 1 段，需要适配层逐段处理。


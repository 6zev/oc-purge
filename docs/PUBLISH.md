# 发布到 npm 的所有路径

## 一、认证：决定"能不能 push"

| # | 方式 | 命令/配置 | CI 可用 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | 本地交互登录 | `npm login` 然后 `npm publish` | ✗ | 需输密码 + OTP |
| 2 | **Automation token** | `NODE_AUTH_TOKEN=$TOKEN npm publish` | ✓ | npmjs → Access Tokens → Generate → **Automation** |
| 3 | Granular token | 同上 | ✓ | 必须选中具体 package；新包要先建 |
| 4 | **Trusted Publishing (OIDC)** | 无 token，靠 GitHub OIDC | ✓ | npm ≥ 11.5；首次发布仍需 #2 |
| 5 | `--otp` | `npm publish --otp=123456` | ✗ | 手动场景 |
| 6 | Scope 包 | `@6zev/oc-purge` + `publishConfig.access: public` | ✓ | 名字受保护，不会被抢注 |

### 2. Automation token

```
npmjs.com → Avatar → Access Tokens → Generate New Token → Automation
gh secret set NPM_TOKEN --repo 6zev/oc-purge
```

### 4. Trusted Publishing

npm 页面：`https://www.npmjs.com/package/oc-purge/settings` → Trusted Publishing → 填：

```
Owner:      6zev
Repo:       oc-purge
Workflow:   publish.yml
```

workflow 里必须有 `permissions: id-token: write`，且 `npm publish` 不带任何 `NODE_AUTH_TOKEN`。
本仓库的 `publish.yml` 已内置这个顺序（OIDC 优先 → token 兜底），不需要额外的 workflow 文件。

> ⚠️ 首次发布**必须**用 token。OIDC 只能接管已存在的包。

---

## 二、触发：决定"什么时候发"

| # | 触发 | 版本来源 | 适合 |
| --- | --- | --- | --- |
| A | push `v*` tag | tag 名 | 版本可追溯，最常用 |
| B | GitHub Release published | Release tag | 带 changelog，UI 友好 |
| C | `workflow_dispatch` | 自动 bump / 手填 | 一键补丁发布 |
| D | push main 带 `[publish]` | 自动 bump | 全自动，风险高 |
| E | `schedule` cron | 自动 bump | 容易发空包，不建议 |
| F | `npm version patch && git push --follow-tags` | npm version 写的 | 本地一条命令搞定 |

本仓库 `.github/workflows/publish.yml` 同时支持 **A + B + C**。

---

## 三、完全不经过 GitHub Actions

```bash
npm login
npm test
npm pack --dry-run        # 先看会发什么
npm publish --access public --provenance
```

`--provenance` 需要 `id-token`，本地跑不通会自动降级为无 provenance。

### 第三方发布工具

| 工具 | 特点 |
| --- | --- |
| `np` | 交互式，自动跑测试/打 tag/发 GitHub Release |
| `release-it` | 可配置，支持 conventional commits |
| `semantic-release` | 完全按 commit message 定版本，全自动 |
| `changesets` | monorepo 友好，PR 里累积 changelog |
| `pkg-pr-new` | 每个 PR 一个临时预览版本 |

---

## 四、本仓库的现状

- `publish.yml` —— **OIDC（#4）优先 + token（#2）兜底**，A/B/C 三触发，单一 workflow
- `publish-oidc.yml` —— 已删除（功能合并进 `publish.yml`，避免同一次 Release 发两遍）

实测记录：`publish.yml` 手动触发一次，前 9 步全通，最后 `ENEEDAUTH`（未配 token），
说明流程正确、只差凭证。

---

## 五、安全提醒

- 不要把 token 写进 `package.json` 或 `.npmrc` 后提交。
- Automation token 等价于全账号权限，建议只用在单一仓库的 secret 里。
- 优先考虑 OIDC：没有长期凭证可泄露。

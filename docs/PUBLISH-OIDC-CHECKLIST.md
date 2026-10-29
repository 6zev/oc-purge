# 用 OIDC 发布前必须补齐的三件事

> 结论先说：**GitHub ↔ npm 账号关联 ≠ 能直接 publish。**
> 关联只让你能登录 npm 网页 / npm CLI 时少输一次密码。CI 里的 `npm publish`
> 要的是「这个仓库被授权为这个包的发布者」，那是另一个开关。

## 状态

| 需要的 | 当前 | 说明 |
| --- | --- | --- |
| `oc-purge` 包已存在于 npm | ❌ **不存在**（registry 返回 404） | OIDC 不能创建新包 |
| Trusted Publisher 已绑定 | ❌ 未配置 | 包不存在时页面上没有这个入口 |
| `id-token: write` | ✅ 已有 | 在 `publish-oidc.yml` |
| 仓库 public + workflow 文件名 | ✅ 已有 | `6zev/oc-purge` / `publish-oidc.yml` |

## 必须按这个顺序做

### 第 1 步：一次性用 token 把包名占下来

npm 从来没给「新包 + OIDC 首发」开过路。第一次必须：

```
npmjs.com → Access Tokens → Generate New Token → Automation
```

```bash
gh secret set NPM_TOKEN --repo 6zev/oc-purge     # 粘进去
gh workflow run publish.yml --repo 6zev/oc-purge -f bump=patch
sleep 60 && gh run list --repo 6zev/oc-purge --limit 2
```

或者干脆本地发：

```bash
cd oc-purge
npm login
npm publish --access public
```

发成功后：`https://www.npmjs.com/package/oc-purge` 就存在了。

### 第 2 步：把 OIDC 绑上这个包

```
https://www.npmjs.com/package/oc-purge/settings
  → Trusted Publishing
      Owner:                    6zev
      Repository:               oc-purge
      Workflow filename:        publish-oidc.yml
      Environment:              (留空)
  → Add
```

> 包不存在时这个卡片根本不出现 —— 这是“扣在第 1 步”的原因。

### 第 3 步：切到 OIDC，删掉 token

```bash
gh workflow disable "Publish to npm" --repo 6zev/oc-purge       # 关掉 token 版
gh secret delete NPM_TOKEN --repo 6zev/oc-purge                  # 删掉长期凭证
git tag v0.2.2 && git push origin v0.2.2                         # OIDC 版自动接手
```

## 常见误判

| 想法 | 实际 |
| --- | --- |
| “我 npm 账号绑了 GitHub，CI 就能发” | ❌ 绑定 ≠ 授权仓库发某个包 |
| “OIDC 可以先建包” | ❌ 只能发**已存在**的包 |
| “两个 workflow 都开着更保险” | ❌ 同一次 Release 发两遍，第二次版本冲突失败 |
| “发不上去是 workflow 写错了” | 先看是不是 `ENEEDAUTH`：那是认证，不是逻辑 |

## 更快的一条路

如果只是想让别人 `npm i` 装得到，又不想折腾 OIDC：

1. Token 发一次（第 1 步）→ 完事。
2. 之后每次发布前 `npm login` 本地手动发，或继续用 `publish.yml` + token。

OIDC 的收益是“没有长期凭证可泄露”，代价是必须先发一次。

/**
 * oc-purge / scope gate
 *
 * dsh-purge 的 `lib/net-scope.js` 对位：把「本次会话允许访问的主机」写成一个允许/拒绝清单，
 * 在工具调用层做闸门。OpenCode 里没有统一的出网层，但有两条可插的边：
 *   1) tool.execute.before —— bash / webfetch / http 类工具的 URL 参数
 *   2) session.hook("http.request") —— 模型请求层的宿主与自定义消息头
 * 默认关闭：只有配置 `scope.enabled = true` 才拦截。
 */

const ANY = "*";

function toEntry(item) {
  const raw = String(item || "").trim().toLowerCase();
  if (!raw) return undefined;
  const withScheme = raw.includes("://") ? raw : `https://${raw}`;
  try {
    const url = new URL(withScheme);
    return { host: url.hostname, port: url.port || "", path: url.pathname || "/" };
  } catch {
    return { host: raw.replace(/^[^@/]*@/, "").split("/")[0], port: "", path: "/" };
  }
}

function hostMatches(pattern, host) {
  if (pattern === ANY) return true;
  const p = pattern.replace(/^\*\./, ".");
  if (p.startsWith(".")) return host === p.slice(1) || host.endsWith(p);
  if (pattern.startsWith("*")) return host.endsWith(pattern.slice(1));
  return host === pattern || host.endsWith(`.${pattern}`);
}

export function allowNetwork(scope, host) {
  const cfg = { enabled: false, allow: [], deny: [], ...(scope || {}) };
  const entries = (Array.isArray(cfg.allow) ? cfg.allow : []).map(toEntry).filter(Boolean);
  const denies = (Array.isArray(cfg.deny) ? cfg.deny : []).map(toEntry).filter(Boolean);
  const target = toEntry(host);
  if (!target) return { allowed: false, reason: "unparsable" };
  if (!cfg.enabled) return { allowed: true, reason: "scope-disabled" };
  for (const entry of denies) if (hostMatches(entry.host, target.host)) return { allowed: false, reason: "deny-list" };
  for (const entry of entries) if (hostMatches(entry.host, target.host)) return { allowed: true, reason: "allow-list" };
  return { allowed: false, reason: "not-in-scope" };
}

export function scopeReport(scope) {
  const cfg = { enabled: false, allow: [], deny: [], ...(scope || {}) };
  return {
    enabled: Boolean(cfg.enabled),
    allow: (cfg.allow || []).length,
    deny: (cfg.deny || []).length,
  };
}

/** 从一段命令文本里抽出主机（curl/wget/nc/ssh/git clone 之类）。 */
export function hostsInCommand(command) {
  const text = String(command || "");
  const out = new Set();
  const re = /\b(?:https?|ftp|ws|wss):\/\/([^\s/'"?]+)/gi;
  for (const match of text.matchAll(re)) out.add(match[1].toLowerCase().replace(/:\d+$/, ""));
  const scp = /\b[a-z0-9._-]+@([a-z0-9.-]+):/gi;
  for (const match of text.matchAll(scp)) out.add(match[1].toLowerCase());
  return [...out];
}

export function installScopeGate({ enabled, allow, deny, log } = {}) {
  const scope = { enabled: Boolean(enabled), allow: allow || [], deny: deny || [] };
  const state = { blocked: 0, checked: 0 };
  return {
    scope,
    check(host) {
      if (!scope.enabled) return { allowed: true, reason: "scope-disabled" };
      state.checked += 1;
      const verdict = allowNetwork(scope, host);
      if (!verdict.allowed) state.blocked += 1;
      log?.(`scope ${verdict.allowed ? "allow" : "deny"} ${host} (${verdict.reason})`);
      return verdict;
    },
    checkCommand(command) {
      if (!scope.enabled) return { allowed: true };
      const hosts = hostsInCommand(command);
      for (const host of hosts) {
        state.checked += 1;
        const verdict = allowNetwork(scope, host);
        if (!verdict.allowed) {
          state.blocked += 1;
          return { allowed: false, host, reason: verdict.reason };
        }
      }
      return { allowed: true };
    },
    report: () => ({ ...scopeReport(scope), checked: state.checked, blocked: state.blocked }),
    dispose() {},
  };
}

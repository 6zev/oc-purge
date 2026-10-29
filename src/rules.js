/**
 * oc-purge / rules store
 *
 * 与 dsh-purge 的 `$DSH_HOME/rules + $DSH_HOME/skills` 对应：
 *   ~/.config/opencode/oc-purge/rules/*.md      — 注入用的规则（可勾选）
 *   ~/.config/opencode/oc-purge/state.json      — 勾选状态 / 顺序 / 工作区策略
 *   ~/.config/opencode/oc-purge/cards/*.md      — 按模型/场景切换的身份卡
 *   ~/.config/opencode/oc-purge/workspace/      — 工作区级覆盖（opencode.json 里 ocPurge.rules）
 *
 * 兼容 OpenCode 原生指令入口（opencode.json 的 `instructions` 数组指向的 Markdown）；
 * 那些文件不搬动，只读取并把内容并入 inj ect 文本。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RULE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
export const MAX_RULE_BYTES = 256 * 1024;

export function stateRoot(env = process.env) {
  const base = env.XDG_CONFIG_HOME
    ? path.join(env.XDG_CONFIG_HOME, "opencode")
    : path.join(os.homedir(), ".config", "opencode");
  const custom = env.OC_PURGE_HOME;
  return custom ? path.resolve(custom) : path.join(base, "oc-purge");
}

export const paths = {
  root: (env) => stateRoot(env),
  rules: (env) => path.join(stateRoot(env), "rules"),
  cards: (env) => path.join(stateRoot(env), "cards"),
  state: (env) => path.join(stateRoot(env), "state.json"),
  legacyInject: (env) => path.join(stateRoot(env), "prompt-inject.md"),
};

export function ensureDirs(env) {
  for (const dir of [paths.root(env), paths.rules(env), paths.cards(env)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}

export function readState(env) {
  const raw = readJson(paths.state(env), {});
  return {
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    workspace: raw.workspace && typeof raw.workspace === "object" ? raw.workspace : {},
    cards: raw.cards && typeof raw.cards === "object" ? raw.cards : {},
  };
}

export function writeState(env, state) {
  ensureDirs(env);
  atomicWrite(paths.state(env), JSON.stringify(state, null, 2));
}

/** 文件型规则：`rules/<id>.md`，标题取首个 `# ` 行。 */
export function listRuleFiles(env) {
  ensureDirs(env);
  const dir = paths.rules(env);
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const id = entry.name.slice(0, -3);
    if (!RULE_ID_RE.test(id)) continue;
    const file = path.join(dir, entry.name);
    const stat = fs.statSync(file);
    if (stat.size > MAX_RULE_BYTES) continue;
    const body = fs.readFileSync(file, "utf8");
    const title = (body.match(/^#\s+(.+)$/m)?.[1] || id).trim();
    out.push({ id, title, body, file, bytes: stat.size, mtime: stat.mtimeMs });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 组装本次注入要用的规则集合：
 *   1. ocPurge.rules（opencode.json 内联文本）
 *   2. $OC_PURGE_HOME/rules/*.md（state 勾选控制的文件型规则）
 *   3. opencode.json 的 `instructions` 指向的文件（原生入口，只读并入）
 * workspace 覆盖：ocPurge.workspacePolicy = fallback | strict | always
 */
export async function collectRules({ env = process.env, options = {}, instructionFiles = [] } = {}) {
  const state = readState(env);
  const policy = options.workspacePolicy || "fallback";
  const enabledFile = new Set(state.rules.filter((id) => RULE_ID_RE.test(String(id))));
  const empty = enabledFile.size === 0;

  const rules = [];
  const inline = Array.isArray(options.rules) ? options.rules : [];
  for (const [index, item] of inline.entries()) {
    if (typeof item === "string") rules.push({ id: `inline-${index}`, title: `inline-${index}`, body: item });
    else if (item && typeof item === "object") {
      rules.push({
        id: String(item.id || `inline-${index}`),
        title: String(item.title || item.id || `inline-${index}`),
        body: String(item.body || item.text || ""),
      });
    }
  }

  const fileRules = listRuleFiles(env);
  for (const rule of fileRules) {
    const on = enabledFile.has(rule.id) || (empty && policy !== "strict");
    if (!on) continue;
    rules.push(rule);
  }

  if (Array.isArray(options.workspace)) {
    for (const [index, item] of options.workspace.entries()) {
      if (typeof item === "string")
        rules.push({ id: `workspace-${index}`, title: `workspace-${index}`, body: item });
      else if (item && typeof item === "object") {
        rules.push({
          id: String(item.id || `workspace-${index}`),
          title: String(item.title || item.id || `workspace-${index}`),
          body: String(item.body || item.text || ""),
        });
      }
    }
  } else if (policy === "always" || policy === "fallback") {
    const dir = path.join(stateRoot(env), "workspace");
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const body = fs.readFileSync(path.join(dir, entry.name), "utf8");
        rules.push({
          id: entry.name.slice(0, -3),
          title: entry.name.slice(0, -3),
          body,
        });
      }
    }
  }

  for (const file of instructionFiles || []) {
    try {
      const body = fs.readFileSync(file, "utf8");
      rules.push({ id: `instructions:${path.basename(file)}`, title: `instructions:${path.basename(file)}`, body });
    } catch {
      // 文件不存在 / 不可读：跳过，不阻断会话
    }
  }

  return rules;
}

/** 直接注入的自由文本（old dsh-purge 的 prompt-inject.md 对位）。 */
export function readInjectFile(env) {
  const file = paths.legacyInject(env);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function writeInjectFile(env, text) {
  ensureDirs(env);
  atomicWrite(paths.legacyInject(env), String(text ?? ""));
  return paths.legacyInject(env);
}

/** 卡片：按 key（模型 ref / 场景名）存一段身份卡正文。 */
export function readCard(env, key) {
  const state = readState(env);
  const inline = state.cards?.[key];
  if (typeof inline === "string") return inline;
  const file = path.join(paths.cards(env), `${key}.md`);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

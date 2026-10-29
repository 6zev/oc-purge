/**
 * `@opencode/plugin` 的最小替身，只在测试里用。
 * 真机上由 OpenCode 宿主提供，所以 package.json 里是 peerDependency。
 */
export const Plugin = { define: (plugin) => plugin };

export const Agent = {
  ID: { make: (id) => id },
  Info: {
    default: (id) => ({
      id,
      name: id,
      mode: "primary",
      hidden: false,
      system: "",
      permissions: [],
      request: { settings: {}, headers: {}, body: {} },
    }),
  },
};

export const Skill = {
  ID: { make: (id) => id },
  Name: { make: (name) => name },
  Info: { make: (value) => value },
};

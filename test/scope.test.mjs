import test from "node:test";
import assert from "node:assert/strict";

const { allowNetwork, hostsInCommand, installScopeGate } = await import("../src/scope.js");

test("scope disabled 全放行", () => {
  assert.equal(allowNetwork({ enabled: false }, "anything.test").allowed, true);
});

test("通配与后缀匹配", () => {
  const scope = { enabled: true, allow: ["example.com", "*.internal", "10.0.0.0"] };
  assert.equal(allowNetwork(scope, "https://api.example.com/x").allowed, true);
  assert.equal(allowNetwork(scope, "http://a.b.internal/").allowed, true);
  assert.equal(allowNetwork(scope, "http://evil.test").allowed, false);
});

test("deny 优先于 allow", () => {
  const scope = { enabled: true, allow: ["*.example.com"], deny: ["secret.example.com"] };
  assert.equal(allowNetwork(scope, "secret.example.com").allowed, false);
  assert.equal(allowNetwork(scope, "public.example.com").allowed, true);
});

test("命令里抽主机", () => {
  const hosts = hostsInCommand("curl -s https://a.test/x && git clone git@b.test:org/repo.git && wget http://1.2.3.4:8080/a");
  assert.deepEqual(hosts.sort(), ["1.2.3.4:8080".replace(":8080", ""), "a.test", "b.test"].sort());
});

test("闸门 checkCommand", () => {
  const gate = installScopeGate({ enabled: true, allow: ["a.test"] });
  assert.equal(gate.checkCommand("curl https://a.test/x").allowed, true);
  assert.equal(gate.checkCommand("nc 9.9.9.9 443").allowed, true); // 无 scheme 不抽主机
  assert.equal(gate.checkCommand("curl https://c.test/x").allowed, false);
  assert.equal(gate.report().blocked, 1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("manifest is valid MV3 and includes both forums", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.equal(manifest.name, "NodeSeek Expansion Tool");
  assert.equal(manifest.action.default_title, "NodeSeek Expansion Tool");
  assert.equal(manifest.description, "NodeSeek / DeepFlood 论坛插件，提供用户标签、内容管理、趋势图、自动传图、签到提醒、阅读导航、快捷评论、快捷短语、抽奖通知、站内消息通知和访问历史等实用功能");
  const matches = manifest.content_scripts.flatMap(entry => entry.matches);
  assert.ok(matches.some(value => value.includes("nodeseek.com")));
  assert.ok(matches.some(value => value.includes("deepflood.com")));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
  assert.ok(!manifest.host_permissions.some(value => value.includes("openai.com")));
  assert.ok(manifest.host_permissions.includes("https://api.nodeimage.com/*"));
  assert.ok(manifest.host_permissions.includes("https://api.drand.sh/*"));
  assert.ok(manifest.host_permissions.includes("https://api.telegram.org/*"));
});

test("manifest references files that exist", async () => {
  const manifest = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const paths = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap(entry => [...(entry.js || []), ...(entry.css || [])])
  ];
  for (const path of new Set(paths)) {
    const file = new URL(`../extension/${path}`, import.meta.url);
    await assert.doesNotReject(readFile(file), path);
  }
});

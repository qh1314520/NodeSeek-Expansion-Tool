import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  formatNotification,
  inferCurrentUserId,
  isQuietTime,
  maxItemId,
  normalizeForumItems,
  postPageForFloor,
  selectNewItems
} from "../extension/shared/notifications.js";
import { CHANNEL_LABELS, DEFAULT_SETTINGS, mergeDefaults } from "../extension/shared/config.js";
import { renderMessageTemplate } from "../extension/background/channels.js";

const site = { id: "nodeseek", name: "NodeSeek", origin: "https://www.nodeseek.com" };

test("normalizes mention and reply records", () => {
  const items = normalizeForumItems("mention", {
    data: [{ id: 12, post_id: 88, floor_id: 21, commenter_name: "Alice", title: "主题" }]
  }, site);
  assert.deepEqual(items[0], {
    key: "nodeseek:mention:12",
    id: 12,
    type: "mention",
    siteId: "nodeseek",
    siteName: "NodeSeek",
    title: "有人艾特你",
    actor: "Alice",
    summary: "主题",
    createdAt: "",
    url: "https://www.nodeseek.com/post-88-3#21"
  });
});

test("infers the signed-in user and keeps incoming messages only", () => {
  const payload = {
    msgArray: [
      { max_id: 31, sender_id: 7, receiver_id: 99, sender_name: "Alice", content: "hello" },
      { max_id: 30, sender_id: 99, receiver_id: 8, sender_name: "Current", content: "sent" },
      { max_id: 29, sender_id: 9, receiver_id: 99, sender_name: "Bob", content: "world" }
    ]
  };
  assert.equal(inferCurrentUserId(payload.msgArray), 99);
  const items = normalizeForumItems("message", payload, site);
  assert.deepEqual(items.map(item => item.id), [31, 29]);
  assert.equal(items[0].url, "https://www.nodeseek.com/notification#/message?mode=talk&to=7");
});

test("supports privacy mode for message previews", () => {
  const payload = { msgArray: [
    { max_id: 2, sender_id: 8, receiver_id: 99, sender_name: "Bob", content: "context" },
    { max_id: 1, sender_id: 7, receiver_id: 99, sender_name: "Alice", content: "secret" }
  ] };
  const [item] = normalizeForumItems("message", payload, site, { includePreview: false });
  assert.equal(item.summary, "打开论坛查看私信内容");
});

test("selects new records and advances the high-water mark", () => {
  const items = [{ id: 4 }, { id: 7 }, { id: 5 }];
  assert.deepEqual(selectNewItems(items, 4).map(item => item.id), [5, 7]);
  assert.equal(maxItemId(items, 2), 7);
});

test("calculates post pages from floors", () => {
  assert.equal(postPageForFloor(1), 1);
  assert.equal(postPageForFloor(10), 1);
  assert.equal(postPageForFloor(11), 2);
  assert.equal(postPageForFloor(30), 3);
});

test("handles quiet hours that cross midnight", () => {
  const quiet = { enabled: true, start: "23:00", end: "08:00" };
  assert.equal(isQuietTime(quiet, new Date(2026, 7, 11, 23, 30)), true);
  assert.equal(isQuietTime(quiet, new Date(2026, 7, 11, 7, 59)), true);
  assert.equal(isQuietTime(quiet, new Date(2026, 7, 11, 12, 0)), false);
});

test("fills missing primitive defaults without replacing them with objects", () => {
  const merged = mergeDefaults(undefined, DEFAULT_SETTINGS);
  assert.equal(merged.notifications.pollMinutes, 1);
  assert.equal(merged.notifications.quietHours.start, "23:00");
  assert.deepEqual(Object.keys(merged.notifications.channels), ["telegram", "email", "wechat", "wecom", "dingtalk", "feishu"]);
  assert.deepEqual(Object.values(CHANNEL_LABELS), ["Telegram Bot", "邮件", "微信推送", "企业微信", "钉钉", "飞书"]);
  assert.deepEqual(merged.notifications.templates, {
    forum: "{subject}\n{body}\n{url}",
    lottery: "{subject}\n{body}\n{url}"
  });
  assert.ok(Object.values(merged.notifications.channels).every(channel => !("messageTemplate" in channel)));
});

test("renders shared notification templates with forum variables", () => {
  const message = formatNotification({
    siteName: "NodeSeek",
    title: "有人艾特你",
    actor: "Alice",
    summary: "测试主题",
    createdAt: "2026-08-13T03:00:00.000Z",
    url: "https://www.nodeseek.com/post-42-1"
  });
  assert.equal(
    renderMessageTemplate("[{site}] {type}\n{actor}: {summary}\n{url}\n{time}", message),
    "[NodeSeek] 有人艾特你\nAlice: 测试主题\nhttps://www.nodeseek.com/post-42-1\n2026-08-13T03:00:00.000Z"
  );
  assert.equal(renderMessageTemplate("{subject}\n{body}", message), "[NodeSeek] 有人艾特你\nAlice：测试主题");
  assert.equal(renderMessageTemplate("", message), "");
});

test("migrates a legacy channel template to both shared templates", () => {
  const merged = mergeDefaults({
    notifications: {
      channels: {
        telegram: { messageTemplate: "[{site}] {subject}" }
      }
    }
  }, DEFAULT_SETTINGS);
  assert.equal(merged.notifications.templates.forum, "[{site}] {subject}");
  assert.equal(merged.notifications.templates.lottery, "[{site}] {subject}");
  assert.ok(Object.values(merged.notifications.channels).every(channel => !("messageTemplate" in channel)));
});

test("removes discontinued Bark and Discord channel settings", () => {
  const merged = mergeDefaults({
    notifications: { channels: {
      bark: { enabled: true, key: "legacy" },
      discord: { enabled: true, webhook: "https://discord.com/legacy" }
    } }
  }, DEFAULT_SETTINGS);
  assert.equal("bark" in merged.notifications.channels, false);
  assert.equal("discord" in merged.notifications.channels, false);
});

test("drops object values that would render as object Object in channel fields", () => {
  const merged = mergeDefaults({
    notifications: {
      channels: {
        telegram: { botToken: {}, chatId: { stale: true } },
        email: { apiKey: [], from: null },
        dingtalk: { webhook: { value: "" } }
      }
    }
  }, DEFAULT_SETTINGS);
  assert.equal(merged.notifications.channels.telegram.botToken, "");
  assert.equal(merged.notifications.channels.telegram.chatId, "");
  assert.equal(merged.notifications.channels.email.apiKey, "");
  assert.equal(merged.notifications.channels.email.from, "");
  assert.equal(merged.notifications.channels.dingtalk.webhook, "");
});

test("forum and lottery deliveries use their shared template slots", async () => {
  const [html, poller, worker] = await Promise.all([
    readFile(new URL("../extension/options/options.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/background/poller.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/background/service-worker.js", import.meta.url), "utf8")
  ]);
  assert.equal((html.match(/data-path="notifications\.templates\.(?:forum|lottery)"/g) || []).length, 2);
  assert.match(html, /id="reset-notification-templates"/);
  assert.doesNotMatch(html, /notifications\.channels\.[^"]+\.messageTemplate/);
  for (const variable of ["subject", "body", "url", "site", "type", "actor", "summary", "time"]) {
    assert.match(html, new RegExp(`\\{${variable}\\}`));
  }
  assert.match(poller, /sendEnabledChannels\(settings\.channels, message, onlyChannels, settings\.templates\?\.forum\)/);
  assert.match(worker, /sendEnabledChannels\(settings\.notifications\.channels,[\s\S]*?settings\.notifications\.templates\?\.lottery\)/);
  const options = await readFile(new URL("../extension/options/options.js", import.meta.url), "utf8");
  assert.match(options, /settings\.notifications\.templates = \{ \.\.\.DEFAULT_SETTINGS\.notifications\.templates \}/);
  assert.match(options, /消息模板已恢复默认/);
});

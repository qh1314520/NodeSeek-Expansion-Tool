import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BACKUP_FORMAT,
  FORUM_LOCAL_STORAGE_KEYS,
  LOTTERY_GM_STORAGE_KEYS,
  createExtensionBackup,
  createUserInfoBackup,
  parseBackupPayload
} from "../extension/shared/backup.js";

test("complete extension backups keep extension and per-forum data", () => {
  const payload = createExtensionBackup({
    settings: { appearance: { theme: "dark" } },
    gmStorage: { settings: { history: { enabled: true } } },
    forums: { nodeseek: { localStorage: { nsx_browsing_history: [1] } } },
    extensionVersion: "0.1.0"
  });
  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.data.extensionSettings.appearance.theme, "dark");
  assert.deepEqual(payload.data.forums.nodeseek.localStorage.nsx_browsing_history, [1]);
  assert.equal(parseBackupPayload(payload).kind, "extension");
});

test("complete extension backups include lottery tracking and notification state", () => {
  const gmStorage = {
    lottery_reminders: [{ postUrl: "https://www.nodeseek.com/post-42-1" }],
    lottery_participation_history: { users: {} },
    notify_config: { autoResult: { enabled: true } }
  };
  const payload = createExtensionBackup({ settings: {}, gmStorage, forums: {}, extensionVersion: "0.1.0" });
  for (const key of LOTTERY_GM_STORAGE_KEYS) assert.deepEqual(payload.data.gmStorage[key], gmStorage[key]);
});

test("user information backups keep settings and exclude record data", () => {
  const payload = createUserInfoBackup({
    settings: { appearance: { theme: "dark" } },
    gmStorage: {
      settings: {
        sign_in: {
          ns: { enabled: true, method: 1, last_date: "2026/8/12", ignore_date: "2026/8/12" }
        },
        history: { enabled: true }
      },
      notify_config: { autoResult: { enabled: true, username: "tester" } },
      lottery_reminders: [{ postUrl: "https://www.nodeseek.com/post-42-1" }],
      lottery_participation_history: { users: { 7: {} } }
    },
    forums: {
      nodeseek: {
        origin: "https://www.nodeseek.com",
        localStorage: {
          nsx_advanced_keywords: { test: { type: "block" } },
          nsx_advanced_friends: { Alice: { remark: "friend" } },
          nsx_browsing_history: [{ postId: 42 }],
          nsx_recently_closed: [{ postId: 41 }],
          nsx_visited_posts: { 42: true }
        }
      }
    },
    extensionVersion: "0.1.0"
  });
  assert.equal(payload.scope, "user-settings");
  assert.equal(payload.data.gmStorage.settings.sign_in.ns.enabled, true);
  assert.equal("last_date" in payload.data.gmStorage.settings.sign_in.ns, false);
  assert.equal("ignore_date" in payload.data.gmStorage.settings.sign_in.ns, false);
  assert.equal("lottery_reminders" in payload.data.gmStorage, false);
  assert.equal("lottery_participation_history" in payload.data.gmStorage, false);
  assert.deepEqual(payload.data.forums.nodeseek.localStorage.nsx_advanced_keywords, { test: { type: "block" } });
  assert.deepEqual(payload.data.forums.nodeseek.localStorage.nsx_advanced_friends, { Alice: { remark: "friend" } });
  assert.equal("nsx_browsing_history" in payload.data.forums.nodeseek.localStorage, false);
  assert.equal("nsx_recently_closed" in payload.data.forums.nodeseek.localStorage, false);
  assert.equal("nsx_visited_posts" in payload.data.forums.nodeseek.localStorage, false);
  assert.equal(parseBackupPayload(payload).partial, true);
});

test("GreasyFork nsx-backup files import into both supported forums", () => {
  const parsed = parseBackupPayload({
    format: "nsx-backup",
    schemaVersion: 2,
    data: {
      settings: { quick_comment: { enabled: false } },
      localStorage: { nodeseek_quick_reply: { 默认: ["谢谢"] } },
      indexedDB: { nsPreferenceConfiguration: { openPostInNewPage: true } }
    }
  });
  assert.equal(parsed.kind, "greasyfork");
  assert.equal(parsed.gmStorage.settings.quick_comment.enabled, false);
  assert.deepEqual(parsed.forums.nodeseek, parsed.forums.deepflood);
});

test("legacy extension backup files remain supported", () => {
  const parsed = parseBackupPayload({ settings: { appearance: { theme: "light" } }, gmStorage: { settings: {} } });
  assert.equal(parsed.kind, "legacy-extension");
  assert.equal(parsed.extensionSettings.appearance.theme, "light");
});

test("forum bridge covers every GreasyFork local backup key", async () => {
  const bridge = await readFile(new URL("../extension/content/bridge.js", import.meta.url), "utf8");
  for (const key of FORUM_LOCAL_STORAGE_KEYS) assert.match(bridge, new RegExp(key));
  assert.match(bridge, /forumBackupCollect/);
  assert.match(bridge, /forumBackupApply/);
  assert.match(bridge, /ns-preference-db/);
  assert.match(bridge, /payload\?\.partial !== true/);
});

test("options load forum data on demand and expose a fast user information export", async () => {
  const [html, options] = await Promise.all([
    readFile(new URL("../extension/options/options.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/options/options.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="export-user-settings"/);
  assert.doesNotMatch(html, /非官方论坛增强插件/);
  assert.match(options, /const forumDataPanels = new Set\(\["quick", "content", "footprint"\]\)/);
  const initSource = options.match(/async function init\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(initSource, /await loadForumData\(activeForumSite\)/);
  assert.match(options, /receiverMissing\(error\)/);
  assert.match(options, /await chrome\.tabs\.reload\(tab\.id\)/);
  assert.match(options, /createUserInfoBackup/);
  assert.match(options, /mergePartialObject\(gmStorage, imported\.gmStorage\)/);
});

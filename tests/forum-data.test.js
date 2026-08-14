import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  BROWSING_HISTORY_KEY,
  RECENTLY_CLOSED_KEY,
  normalizeContentGroups,
  normalizeForumHistory,
  normalizeKeywordRules,
  normalizeQuickPhrases,
  normalizeUserBlockRules
} from "../extension/shared/forum-data.js";

test("normalizes forum browsing history for the options page", () => {
  const history = normalizeForumHistory([
    { postId: 42, title: "测试帖子", time: "2026-08-12T12:00:00.000Z", uid: 7, author: "tester" },
    { postId: "bad", title: "无效", time: "invalid" }
  ]);
  assert.deepEqual(history, [{ postId: "42", title: "测试帖子", time: "2026-08-12T12:00:00.000Z", uid: "7", author: "tester" }]);
  assert.equal(BROWSING_HISTORY_KEY, "nsx_browsing_history");
  assert.equal(RECENTLY_CLOSED_KEY, "nsx_recently_closed");
});

test("normalizes legacy keyword and user block formats", () => {
  assert.deepEqual(normalizeKeywordRules(["广告", { word: "推广", mode: "hide" }]), {
    "广告": { type: "block", mode: "fold", color: null, group: "", enabled: true, time: "" },
    "推广": { type: "block", mode: "hide", color: null, group: "", enabled: true, time: "" }
  });
  assert.deepEqual(normalizeUserBlockRules(["tester", { username: "spammer", mode: "hide", remark: "test" }]), {
    tester: { remark: "", userId: "", mode: "fold", group: "", enabled: true, time: "" },
    spammer: { remark: "test", userId: "", mode: "official", group: "", enabled: true, time: "" }
  });
});

test("normalizes quick phrases from strings, arrays and legacy objects", () => {
  assert.deepEqual(normalizeQuickPhrases("谢谢分享"), {
    "默认": [{ title: "谢谢分享", content: "谢谢分享" }]
  });
  assert.deepEqual(normalizeQuickPhrases({ 常用: ["谢谢", { name: "已解决", text: "问题已经解决" }] }), {
    常用: [{ title: "谢谢", content: "谢谢" }, { title: "已解决", content: "问题已经解决" }]
  });
});

test("drops unsafe record keys and keeps independent group switches", () => {
  const keywords = normalizeKeywordRules(JSON.parse('{"__proto__":{"type":"block"},"<img src=x onerror=1>":{"type":"highlight","color":"#ffffff"}}'));
  assert.deepEqual(Object.keys(keywords), ["<img src=x onerror=1>"]);
  assert.deepEqual(normalizeContentGroups({ keywords: [{ id: "work", name: "工作", enabled: false }] }), {
    keywords: [{ id: "work", name: "工作", color: "#f59e0b", enabled: false }],
    users: []
  });
});

test("options expose editable content rules and grouped quick phrases", async () => {
  const [html, options, bridge, forum] = await Promise.all([
    readFile(new URL("../extension/options/options.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/options/options.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/content/bridge.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="edit-keyword-rules"/);
  assert.match(html, /id="edit-user-rules"/);
  assert.match(html, /id="add-phrase-group"/);
  assert.match(html, /id="quick-comment-enabled"/);
  assert.match(html, /id="quick-phrases-enabled"/);
  assert.match(html, /id="management-dialog"/);
  assert.match(html, /id="footprint-history-list"/);
  assert.match(html, /id="footprint-recent-list"/);
  assert.match(html, /id="footprint-history-search"/);
  assert.match(html, /id="footprint-recent-search"/);
  assert.equal((html.match(/data-forum-site-tabs/g) || []).length, 0);
  assert.doesNotMatch(html.match(/data-panel="quick"[\s\S]*?data-panel="content"/)?.[0] || "", /data-forum-site-tabs/);
  assert.doesNotMatch(html.match(/data-panel="content"[\s\S]*?data-panel="images"/)?.[0] || "", /data-forum-site-tabs/);
  assert.doesNotMatch(html, /data-footprint-tab=/);
  assert.doesNotMatch(html, /低等级内容屏蔽/);
  assert.match(options, /normalizeKeywordRules/);
  assert.match(options, /data-add-rule-to-group/);
  assert.match(options, /function editRules\(kind, initialGroup = "", addNew = false\)/);
  assert.match(options, /rowMarkup\("", \{ group: initialGroup \}\)/);
  assert.match(options, /setTimeout\(\(\) => editRules\(kind, savedGroup\.id, true\), 0\)/);
  assert.match(options, /normalizeQuickPhrases/);
  assert.match(options, /escapeHtml\(item\.content\)/);
  assert.doesNotMatch(options, /id="phrase-title"/);
  assert.doesNotMatch(options, /标题用于面板展示/);
  assert.match(bridge, /forumDataGet/);
  assert.match(bridge, /MANAGED_LOCAL_KEYS/);
  assert.match(bridge, /"nsx_browsing_history"/);
  assert.match(bridge, /"nsx_recently_closed"/);
  assert.match(bridge, /NSPRO_STORAGE_UPDATED/);
  assert.match(forum, /暂无快捷短语/);
  assert.match(forum, /setAttribute\("aria-label", "快捷短语"\)/);
  assert.match(forum, /match: ctx => ctx\.isPost/);
  assert.match(forum, /refreshQuickComment/);
  assert.match(forum, /quick_comment: \{ enabled: true, phrases_enabled: true \}/);
  assert.match(forum, /Boolean\(info\) && info\.enabled !== false/);
  assert.match(forum, /pendingCommentSubmission/);
  assert.match(forum, /"comment-submit"/);
  assert.doesNotMatch(forum, /syncParticipationHistory/);
  assert.doesNotMatch(forum, /mergeCommentHistory/);
  assert.doesNotMatch(forum, />➕ 新增</);
  assert.doesNotMatch(forum, />🔍<input placeholder="搜索关键字与配置/);
  assert.doesNotMatch(forum, />🚫 屏蔽<\/button>/);
  assert.doesNotMatch(forum, />🎨 高亮<\/button>/);
  assert.doesNotMatch(forum, />🔍<input placeholder="搜索"/);
  assert.doesNotMatch(forum, />🔍<input placeholder="搜索用户名或备注/);
  assert.doesNotMatch(forum, />🚫 屏蔽黑名单<\/button>/);
  assert.doesNotMatch(forum, />🌟 本地好友<\/button>/);
  assert.doesNotMatch(forum, /id: "blockViewLevel"/);
  assert.doesNotMatch(forum, /blockByLevel/);
  assert.doesNotMatch(forum, /classList\.add\("blocked-post"\)/);
});

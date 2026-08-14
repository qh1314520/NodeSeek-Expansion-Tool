import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const sourceUrl = new URL("../extension/content/nodeseek-max.js", import.meta.url);

test("comment footprint is enabled and builds one user-wide floor index", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /comment_footprint: \{ enabled: true/);
  assert.match(source, /function|const commentFootprintIndexForUser/);
  assert.match(source, /store\.index\(COMMENT_FOOTPRINT_INDEX\)\.openCursor/);
  assert.match(source, /floorsByPost\.forEach\(floors => floors\.sort/);
  assert.doesNotMatch(source, /latestCommentFloor/);
});

test("post lists show a compact replied badge linked to the latest reply", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /badge\.textContent = "已回复"/);
  assert.match(source, /badge\.className = "nsx-forum-status-tag nsx-replied-badge"/);
  assert.match(source, /comment_footprint\.badge_color_light/);
  assert.match(source, /comment_footprint\.badge_color_dark/);
  assert.match(source, /badge\.style\.setProperty\("--nsx-status-color-light"/);
  assert.match(source, /badge\.style\.setProperty\("--nsx-status-color-dark"/);
  assert.match(source, /badge\.title = `回复楼层：/);
  assert.match(source, /const latestFloor = floors\[floors\.length - 1\]/);
  assert.match(source, /\.post-list-item,\.post-list \.list-item,\.post-item/);
  assert.match(source, /const findCategory = \(\) => item\.querySelector/);
  assert.match(source, /category\.parentElement\.insertBefore\(badge, category\)/);
  assert.match(source, /if \(categoryStyle\.position === "absolute"\)/);
  assert.match(source, /right \+ category\.offsetWidth \+ marginLeft \+ marginRight \+ gap/);
  assert.match(source, /badge\.style\.setProperty\("bottom", `\$\{bottom\}px`, "important"\)/);
  assert.match(source, /\.nsx-replied-badge\{margin-left:auto!important;margin-right:8px!important/);
  assert.match(source, /\.nsx-replied-badge\+\.post-category/);
});

test("post detail renders every reply floor and supports in-page navigation", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /label\.textContent = "我的回复"/);
  assert.match(source, /if \(old && bar\.dataset\.floors === signature\) return/);
  assert.match(source, /floors\.forEach\(floor =>/);
  assert.match(source, /link\.textContent = `#\$\{floor\}`/);
  assert.match(source, /target\.scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(source, /nsx-comment-floor-highlight/);
  assert.match(source, /\.nsx-my-replies\{[^}]*var\(--nsx-ui-border/);
  assert.match(source, /\.nsx-my-reply-floor\{[^}]*var\(--nsx-ui-muted/);
});

test("extension-owned forum interfaces share the options-page light and dark theme", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const FRONT_UI_THEME_CSS = `/);
  assert.match(source, /--nsx-ui-background:#fff/);
  assert.match(source, /body\.dark-layout\{[\s\S]*?--nsx-ui-background:#09090b/);
  assert.match(source, /#nsx-filter-panel,#nsx-history-panel,#nsx-rel-panel,#nsx-lottery-panel/);
  assert.match(source, /\.nsx-quick-reply-menu/);
  assert.match(source, /\.nsx-lottery-modal/);
  assert.match(source, /\.layui-layer:has\(\.nsx-kw-form\)/);
  assert.match(source, /\.callout-inserter-dropdown/);
  assert.match(source, /#nodeimage-status/);
  assert.match(source, /\.nsx-relation-btn,\.nsx-inline-communication \.nsx-communication-btn/);
  assert.match(source, /\.nsx-fold-notice/);
  assert.match(source, /\.nsx-nested-toggle/);
  assert.match(source, /\.nsx-forum-status-tag\{/);
  assert.match(source, /color-mix\(in srgb,var\(--nsx-status-color\) 9%,var\(--nsx-ui-background\)\)/);
  assert.match(source, /id: "frontUiTheme",[\s\S]*?order: 990/);
  assert.match(source, /define\(frontUiTheme\)/);
});

test("home panels are mutually exclusive and lottery tags use configurable shared styling", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const closeOtherPanels = activePanel =>/);
  for (const panel of ["filter", "history", "relation", "lottery"]) {
    assert.match(source, new RegExp(`closeOtherPanels\\("${panel}"\\)`));
  }
  assert.match(source, /window\.__nsxPanelCtrl\.lottery = \{ close: closePanel/);
  assert.match(source, /joined_badge_color: "#16a34a"/);
  assert.match(source, /unjoined_badge_color: "#d97706"/);
  assert.match(source, /tag\.className = "nsx-forum-status-tag nsx-lottery-state-tag"/);
  assert.match(source, /lottery_reminder\.joined_badge_color/);
  assert.match(source, /lottery_reminder\.unjoined_badge_color/);
  assert.match(source, /tag\.style\.setProperty\("--nsx-status-color"/);
  assert.match(source, /button\.textContent = "抽奖提醒"/);
  assert.doesNotMatch(source, /button\.textContent = "🎁 抽奖提醒管理器"/);
  assert.match(source, /button\.style\.setProperty\("--nsx-status-color", lotteryStatusColor\(state\)\)/);
  assert.doesNotMatch(source, /\.nsx-lottery-state-tag\[data-state="joined"\]\{background:#e8f5e9/);
  assert.doesNotMatch(source, /\.dark-layout \.nsx-lottery-state-tag\{background:#3a2d18/);
});

test("reply floor pagination follows NodeSeek's ten comments per page fallback", async () => {
  const source = await readFile(sourceUrl, "utf8");
  const match = source.match(/const commentFootprintTargetPage = ([^;]+);/);
  assert.ok(match);
  const targetPage = new Function(`return (${match[1]})`)();
  assert.equal(targetPage(1), 1);
  assert.equal(targetPage(10), 1);
  assert.equal(targetPage(11), 2);
  assert.equal(targetPage(36), 4);
  assert.equal(targetPage(36, 15), 3);
});

test("disabled post new-tab mode restores same-tab navigation and forum preference", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const openInNewTabFix = \{[\s\S]*?match: \(\) => true/);
  assert.match(source, /enabled = ctx\.store\.get\("open_post_in_new_tab\.enabled", false\) === true/);
  assert.match(source, /config\.openPostInNewPage = enabled/);
  assert.match(source, /else anchor\.removeAttribute\("target"\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\);[\s\S]*?location\.assign\(anchor\.href\)/);
  assert.match(source, /window\.__nsxRuntime\.refreshOpenPostInNewTab = apply/);
});

test("visible own replies are captured before the background history sync", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /const captureVisibleReplies = async/);
  assert.match(source, /await captureVisibleReplies\(\);[\s\S]*?renderAll\(\);/);
  assert.match(source, /if \(ctx\.store\.get\("rules_compliance\.enabled", false\)\) return/);
  assert.match(source, /await sync\("recent", 1\)/);
  assert.doesNotMatch(source, /初始化回帖足迹/);
});

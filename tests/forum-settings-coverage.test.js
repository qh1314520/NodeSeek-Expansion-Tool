import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ADVANCED_SETTING_GROUPS,
  FEATURE_GROUPS,
  FORUM_CONTEXT_ACTION_FIELDS,
  USER_LABEL_OPTIONS,
  USER_LEVEL_STYLES,
  UPSTREAM_DISABLED_MODULES,
  UPSTREAM_DISABLED_SETTING_PREFIXES,
  UPSTREAM_REMOVED_SETTINGS
} from "../extension/shared/forum-settings.js";

const extensionSource = () => readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
const upstreamSource = () => readFile(new URL("../.reference/nodeseek-pro-userscript/Nodeseek Pro.user.js", import.meta.url), "utf8");
const greasyForkSource = () => readFile(new URL("../.reference/greasyfork-nodeseek-pro.user.js", import.meta.url), "utf8");

const flatten = (value, prefix = "") => Object.entries(value || {}).flatMap(([key, item]) => {
  const path = prefix ? `${prefix}.${key}` : key;
  if (item && typeof item === "object" && !Array.isArray(item)) return flatten(item, path);
  return [path];
});

function balancedObject(source, start) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (["\"", "'", "`"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error("Unbalanced cfg object");
}

function cfgPaths(source) {
  const scope = {
    DEFAULT_DARK: "#393f4e",
    DEFAULT_LIGHT: "#afb9c1",
    LINK_PURIFIER_SHORT_HOSTS: []
  };
  const paths = new Set();
  let position = 0;
  while ((position = source.indexOf("cfg:", position)) >= 0) {
    const open = source.indexOf("{", position);
    const raw = balancedObject(source, open);
    try {
      const names = Object.keys(scope);
      const values = Object.values(scope);
      const value = Function(...names, `return (${raw})`)(...values);
      flatten(value).forEach(path => paths.add(path));
    } catch {
      // Runtime-only cfg objects are not module defaults and are ignored.
    }
    position = open + raw.length;
  }
  return paths;
}

function featurePaths() {
  return new Set(FEATURE_GROUPS.flatMap(group => group.features).flatMap(feature => Array.isArray(feature[2]) ? feature[2] : [feature[2]]));
}

function advancedPaths() {
  return new Set(ADVANCED_SETTING_GROUPS.flatMap(group => group.fields).map(field => field.path));
}

test("extension keeps every enabled upstream feature module", async () => {
  const [upstream, extension] = await Promise.all([upstreamSource(), extensionSource()]);
  const modulePattern = /"\.\/features\/([^"/]+)\.js"/g;
  const modules = source => new Set([...source.matchAll(modulePattern)].map(match => match[1]));
  const expected = [...modules(upstream)].filter(module => !UPSTREAM_DISABLED_MODULES.includes(module));
  assert.deepEqual([...modules(extension)].sort(), expected.sort());
  assert.match(upstream, /var AI = false/);
  assert.deepEqual(UPSTREAM_DISABLED_MODULES, ["aiComment"]);
});

test("extension covers every GreasyFork 1.0.8 module and persistent option", async () => {
  const [greasyFork, extension] = await Promise.all([greasyForkSource(), extensionSource()]);
  const modulePattern = /["']\.\/features\/([^"']+)\.js["']/g;
  const modules = source => new Set([...source.matchAll(modulePattern)].map(match => match[1]));
  const missingModules = [...modules(greasyFork)].filter(module => !modules(extension).has(module) && !UPSTREAM_DISABLED_MODULES.includes(module));
  const missingSettings = [...cfgPaths(greasyFork)].filter(path => {
    return !cfgPaths(extension).has(path)
      && !UPSTREAM_REMOVED_SETTINGS.includes(path)
      && !UPSTREAM_DISABLED_SETTING_PREFIXES.some(prefix => path.startsWith(prefix));
  });
  assert.match(greasyFork, /^\/\/ @version\s+1\.0\.8$/m);
  assert.deepEqual(missingModules, []);
  assert.deepEqual(missingSettings, []);
  assert.deepEqual(UPSTREAM_REMOVED_SETTINGS, ["block_view_level.enabled"]);
});

test("settings page covers every persistent upstream option", async () => {
  const source = await extensionSource();
  const defaults = cfgPaths(source);
  const covered = new Set([...featurePaths(), ...advancedPaths(), ...FORUM_CONTEXT_ACTION_FIELDS]);
  const ignored = new Set([
    "image_upload.api_key",
    "sign_in.ns.last_date",
    "sign_in.ns.ignore_date",
    "sign_in.df.last_date",
    "sign_in.df.ignore_date",
    ...UPSTREAM_REMOVED_SETTINGS,
    ...[...defaults].filter(path => UPSTREAM_DISABLED_SETTING_PREFIXES.some(prefix => path.startsWith(prefix)))
  ]);
  const missing = [...defaults].filter(path => !covered.has(path) && !ignored.has(path));
  assert.deepEqual(missing, []);
});

test("categorized settings renderer exposes every configured field path", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../extension/options/options.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/options/options.js", import.meta.url), "utf8")
  ]);
  assert.equal((html.match(/data-panel=/g) || []).length, 12);
  assert.match(html, /data-panel="labels"/);
  assert.match(html, /data-panel="reading"/);
  assert.match(html, /data-panel="lottery"/);
  assert.match(html, /data-panel="signin"/);
  assert.match(html, /data-panel="monitor"/);
  assert.match(html, /data-panel="channels"/);
  assert.match(html, /data-panel="sync"/);
  assert.doesNotMatch(html, /data-panel="extension"/);
  assert.match(html, /data-panel="about"/);
  assert.doesNotMatch(html, /nav-icon/);
  assert.match(html, /隐私声明/);
  assert.match(html, /数据边界/);
  assert.match(html, /id="extension-version"/);
  assert.match(html, /id="minimum-browser-version"/);
  assert.match(html, /class="about-card"/);
  assert.match(html, /class="about-logo" src="\.\.\/icons\/icon128\.png"/);
  assert.equal((html.match(/class="about-section"/g) || []).length, 2);
  assert.match(html, /chrome\.storage\.local/);
  assert.match(html, /不要公开上传完整备份文件/);
  assert.match(html, /请求头规则也仅作用于该上传接口/);
  assert.match(html, /data-advanced-category=/);
  assert.match(source, /ADVANCED_SETTING_GROUPS/);
  assert.match(source, /data-gm-path/);
  assert.match(source, /renderAdvancedSettings\(\)/);
  assert.match(source, /quick: \["communication_quick_links\."\]/);
  assert.match(source, /footprint: \["history\.", "visited_color\."\]/);
  assert.ok(advancedPaths().has("comment_footprint.badge_color_light"));
  assert.ok(advancedPaths().has("comment_footprint.badge_color_dark"));
  assert.ok(advancedPaths().has("lottery_reminder.joined_badge_color"));
  assert.ok(advancedPaths().has("lottery_reminder.unjoined_badge_color"));
  assert.doesNotMatch(source, /quick: \["callout\./);
  assert.match(source, /function migrateStatusColorSettings\(\)/);
  assert.match(source, /delete footprint\.badge_color/);
  assert.match(source, /delete lottery\.badge_color/);
  const lotteryPanel = html.match(/<section class="panel" data-panel="lottery">([\s\S]*?)<\/section>/)?.[1] || "";
  const signinPanel = html.match(/<section class="panel" data-panel="signin">([\s\S]*?)<\/section>/)?.[1] || "";
  const monitorPanel = html.match(/<section class="panel" data-panel="monitor">([\s\S]*?)<\/section>/)?.[1] || "";
  const syncPanel = html.match(/<section class="panel" data-panel="sync">([\s\S]*?)<\/section>/)?.[1] || "";
  assert.match(lotteryPanel, /id="lottery-record-list"/);
  assert.match(lotteryPanel, /lotteryNotifications\.browserNotifications/);
  assert.match(lotteryPanel, /id="lottery-auto-result"/);
  assert.doesNotMatch(lotteryPanel, /class="button retry-signin"/);
  assert.match(signinPanel, /id="enable-recommended"/);
  assert.match(signinPanel, /class="button retry-signin"/);
  assert.match(monitorPanel, /id="reset-baseline"/);
  assert.match(monitorPanel, /id="clear-logs"/);
  assert.doesNotMatch(syncPanel, /id="reset-baseline"|id="clear-logs"/);
});

test("user labels are independently configurable and rendered by the forum script", async () => {
  const [html, optionsSource, forumSource] = await Promise.all([
    readFile(new URL("../extension/options/options.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/options/options.js", import.meta.url), "utf8"),
    extensionSource()
  ]);
  assert.ok(USER_LABEL_OPTIONS.length >= 17);
  assert.equal(USER_LEVEL_STYLES.length, 6);
  assert.match(html, /id="user-label-options"/);
  assert.match(html, /id="level-style-grid"/);
  assert.match(optionsSource, /inline_user_info\.labels\.\$\{option\.key\}/);
  assert.match(optionsSource, /inline_user_info\.level_colors\.lv\$\{style\.level\}/);
  for (const option of USER_LABEL_OPTIONS) {
    assert.match(forumSource, new RegExp(`addLabel\\("${option.key}"`));
    assert.match(forumSource, new RegExp(`${option.key}:\\s*(?:true|false)`));
  }
});

test("extension settings expose the GreasyFork manual sign-in retry action", async () => {
  const [html, source] = await Promise.all([
    readFile(new URL("../extension/options/options.html", import.meta.url), "utf8"),
    readFile(new URL("../extension/options/options.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /data-site="ns"/);
  assert.match(html, /data-site="df"/);
  assert.match(source, /sign_in\.\$\{site\}\.last_date/);
  assert.match(source, /1753\/1\/1/);
});

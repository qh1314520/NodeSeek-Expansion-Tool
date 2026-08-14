import { CHANNEL_LABELS, DEFAULT_SETTINGS, mergeDefaults } from "../shared/config.js";
import {
  ADVANCED_SETTING_GROUPS,
  FEATURE_GROUPS,
  USER_LABEL_OPTIONS,
  USER_LEVEL_STYLES
} from "../shared/forum-settings.js";
import {
  BACKUP_SCHEMA_VERSION,
  USER_SETTINGS_FORUM_KEYS,
  createExtensionBackup,
  createUserInfoBackup,
  parseBackupPayload
} from "../shared/backup.js";
import { buildLotteryRecords, LOTTERY_EVIDENCE_LABELS, sanitizeLotteryStorage } from "../shared/lottery.js";
import {
  CONTENT_GROUPS_KEY,
  BROWSING_HISTORY_KEY,
  KEYWORD_RULES_KEY,
  MANAGED_FORUM_DATA_KEYS,
  QUICK_AUTO_SUBMIT_KEY,
  QUICK_PHRASES_KEY,
  RECENTLY_CLOSED_KEY,
  USER_BLOCK_RULES_KEY,
  makeForumRuleId,
  normalizeContentGroups,
  normalizeForumHistory,
  normalizeKeywordRules,
  normalizeQuickPhrases,
  normalizeUserBlockRules,
  shrinkPhrase
} from "../shared/forum-data.js";

const PAGE_META = {
  labels: ["标签数据", "控制帖子用户名后的资料标签与用户关系功能"],
  reading: ["阅读导航", "管理帖子加载、内容呈现与页面导航"],
  quick: ["快捷短语", "按分组管理常用回复，并从论坛编辑器快速插入"],
  content: ["内容管理", "管理关键词与用户屏蔽规则，并配置链接净化"],
  images: ["图床配置", "配置 NodeImage 图片上传"],
  lottery: ["抽奖助手", "识别抽奖帖、跟踪参与条件并管理开奖提醒"],
  signin: ["自动签到", "管理 NodeSeek、DeepFlood 自动签到与签到提醒"],
  monitor: ["站内信息通知", "检测论坛艾特、主题回复和站内私信"],
  channels: ["推送渠道", "将站内信息转发到外部通知服务"],
  footprint: ["访问足迹", "管理浏览历史、访问标记与回帖记录"],
  sync: ["同步备份", "导入导出扩展设置和论坛本地数据"],
  about: ["关于扩展", "了解插件说明、隐私边界、版本与反馈方式"]
};

const PANEL_ALIASES = { enhance: "reading", data: "sync", extension: "lottery", checkin: "signin" };

const FEATURE_CATEGORIES = {
  labels: ["user_card_ext.enabled"],
  reading: [
    "loading_post.enabled", "loading_comment.enabled", "nested_replies.enabled", "image_slide.enabled",
    "code_highlight.enabled", "dark_mode_sync.enabled", "time_chinese.enabled", "smooth_scroll.enabled",
    "instant_page.enabled", "email_nav_link.enabled"
  ],
  quick: ["comment_shortcut.enabled", "callout.enabled", "communication_quick_links.enabled"],
  content: ["link_purifier.enabled", "auto_jump_external_links.enabled"],
  images: ["image_upload.enabled"],
  lottery: ["lottery_reminder.enabled"],
  signin: ["sign_in.ns.enabled", "sign_in.df.enabled", "signin_tips.enabled", "rules_compliance.enabled"],
  footprint: ["history.enabled", "visited_color.enabled", "comment_footprint.enabled", "open_post_in_new_tab.enabled"],
};

const ADVANCED_CATEGORIES = {
  labels: [
    "relation.",
    "comment_footprint.badge_color_light",
    "comment_footprint.badge_color_dark",
    "lottery_reminder.joined_badge_color",
    "lottery_reminder.unjoined_badge_color"
  ],
  reading: ["nested_replies."],
  quick: ["communication_quick_links."],
  content: ["block_posts.", "link_purifier."],
  footprint: ["history.", "visited_color."],
  lottery: ["lottery_reminder.auto_detect", "lottery_reminder.near_minutes", "lottery_reminder.check_seconds"],
  signin: ["sign_in."]
};

const ALL_FEATURES = FEATURE_GROUPS.flatMap(group => group.features);
const ALL_ADVANCED_FIELDS = ADVANCED_SETTING_GROUPS.flatMap(group => group.fields);
const CUSTOM_MANAGED_ADVANCED_PATHS = new Set(["relation.blacklist_enabled", "relation.blacklist_mode"]);

const CHANNEL_FIELDS = {
  telegram: [["botToken", "Bot Token", "password"], ["chatId", "Chat ID", "text"], ["silent", "静默发送", "checkbox"]],
  email: [
    ["provider", "服务商", "select", { resend: "Resend", mailgun: "Mailgun", sendgrid: "SendGrid", emailjs: "EmailJS" }],
    ["apiKey", "API Key", "password"], ["from", "发件人", "text"], ["to", "收件人", "text"],
    ["domain", "Mailgun Domain", "text"], ["serviceId", "Service ID", "text"],
    ["templateId", "Template ID", "text"], ["userId", "Public Key", "password"]
  ],
  wechat: [
    ["provider", "服务商", "select", { serverchan3: "Server酱³", serverchan: "Server酱旧版", pushplus: "PushPlus" }],
    ["sendKey", "SendKey", "password"], ["token", "PushPlus Token", "password"]
  ],
  wecom: [["webhook", "Webhook", "password"]],
  dingtalk: [["webhook", "Webhook", "password"], ["secret", "加签 Secret", "password"], ["atMobiles", "提醒手机号", "text"]],
  feishu: [["webhook", "Webhook", "password"], ["secret", "签名密钥", "password"]]
};

let settings;
let gmStorage;
let gmSettings;
let saveTimer;
let saveSequence = 0;
let activeForumSite = "nodeseek";
const footprintSearch = { history: "", recent: "" };
const forumDataCache = Object.create(null);
const forumDataPanels = new Set(["quick", "content", "footprint"]);
let forumPanelLoadPromise = null;
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const FORUM_SITES = {
  nodeseek: { name: "NodeSeek", url: "https://www.nodeseek.com/", matches: ["https://nodeseek.com/*", "https://www.nodeseek.com/*"] },
  deepflood: { name: "DeepFlood", url: "https://www.deepflood.com/", matches: ["https://deepflood.com/*", "https://www.deepflood.com/*"] }
};

function getPath(object, path, fallback) {
  const value = String(path).split(".").reduce((result, key) => result?.[key], object);
  return value === undefined ? fallback : value;
}

function setPath(object, path, value) {
  const keys = String(path).split(".");
  const last = keys.pop();
  keys.reduce((target, key) => target[key] ??= {}, object)[last] = value;
}

function mergePartialObject(current, incoming) {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
  const result = current && typeof current === "object" && !Array.isArray(current) ? structuredClone(current) : {};
  for (const [key, value] of Object.entries(incoming)) {
    result[key] = value && typeof value === "object" && !Array.isArray(value)
      ? mergePartialObject(result[key], value)
      : structuredClone(value);
  }
  return result;
}

function toast(message, error = false) {
  const element = $("#toast");
  const topbarBottom = $(".topbar")?.getBoundingClientRect().bottom || 76;
  element.style.top = `${Math.max(16, Math.ceil(topbarBottom + 16))}px`;
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(element._timer);
  element._timer = setTimeout(() => element.className = "toast", 2600);
}

function applyTheme(mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  $$("[data-theme-value]").forEach(button => button.classList.toggle("active", button.dataset.themeValue === mode));
}

function queueSettingsSave() {
  const sequence = ++saveSequence;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await chrome.storage.local.set({ settings });
      if (sequence === saveSequence) toast("设置已保存");
    } catch {
      if (sequence === saveSequence) toast("设置保存失败", true);
    }
  }, 220);
}

async function saveGmSettings(message = "设置已保存") {
  gmStorage.settings = gmSettings;
  try {
    await chrome.storage.local.set({ gmStorage });
    renderFeatureCount();
    if (message) toast(message);
  } catch (error) {
    toast("设置保存失败", true);
    throw error;
  }
}

function fieldValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value);
  return input.value;
}

function inputDisplayValue(value) {
  return value == null || typeof value === "object" ? "" : String(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function displayTime(value, fallback = "未记录") {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp));
}

function displayPreciseTime(value, fallback = "未识别") {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback;
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(timestamp));
}

function bindFields(root = document) {
  root.querySelectorAll("[data-path]").forEach(input => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    const value = getPath(settings, input.dataset.path);
    if (input.type === "checkbox") input.checked = Boolean(value);
    else input.value = inputDisplayValue(value);
    input.addEventListener("change", () => {
      setPath(settings, input.dataset.path, fieldValue(input));
      if (input.dataset.path === "appearance.theme") applyTheme(settings.appearance.theme);
      queueSettingsSave();
    });
  });
}

function featureEnabled(feature) {
  const [, , paths, defaultValue] = feature;
  const values = (Array.isArray(paths) ? paths : [paths]).map(path => getPath(gmSettings, path, defaultValue));
  return values.every(Boolean);
}

function setFeature(feature, enabled) {
  const paths = Array.isArray(feature[2]) ? feature[2] : [feature[2]];
  paths.forEach(path => setPath(gmSettings, path, enabled));
}

function advancedFieldValue(input, field) {
  if (field.type === "checkbox") return input.checked;
  if (field.type === "number" || field.valueType === "number") return Number(input.value);
  if (field.valueType === "array") return input.value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  return input.value;
}

function advancedFieldMarkup(field) {
  const path = field.path;
  const description = field.description ? `<small>${field.description}</small>` : "";
  if (field.type === "checkbox") {
    return `<label class="advanced-field advanced-check"><span>${field.label}</span><input data-gm-path="${path}" type="checkbox">${description}</label>`;
  }
  if (field.type === "select") {
    const options = Object.entries(field.options || {}).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    return `<label class="advanced-field"><span>${field.label}</span><select data-gm-path="${path}">${options}</select>${description}</label>`;
  }
  if (field.type === "textarea") {
    return `<label class="advanced-field"><span>${field.label}</span><textarea data-gm-path="${path}" rows="${field.rows || 5}"></textarea>${description}</label>`;
  }
  const limits = `${field.min != null ? ` min="${field.min}"` : ""}${field.max != null ? ` max="${field.max}"` : ""}`;
  return `<label class="advanced-field"><span>${field.label}</span><input data-gm-path="${path}" type="${field.type || "text"}"${limits}>${description}</label>`;
}

function bindAdvancedSettings(root) {
  root.querySelectorAll("[data-gm-path]").forEach(input => {
    if (input.dataset.bound) return;
    input.dataset.bound = "true";
    const field = ALL_ADVANCED_FIELDS.find(item => item.path === input.dataset.gmPath);
    if (!field) return;
    const value = getPath(gmSettings, field.path, field.default);
    if (field.type === "checkbox") input.checked = Boolean(value);
    else if (field.valueType === "array") input.value = Array.isArray(value) ? value.join("\n") : String(value || "");
    else input.value = value ?? "";
    input.addEventListener("change", async () => {
      setPath(gmSettings, field.path, advancedFieldValue(input, field));
      await saveGmSettings();
    });
  });
}

function renderAdvancedSettings() {
  $$('[data-advanced-category]').forEach(container => {
    const paths = ADVANCED_CATEGORIES[container.dataset.advancedCategory] || [];
    const fields = ALL_ADVANCED_FIELDS.filter(field => paths.some(path => path.endsWith(".") ? field.path.startsWith(path) : field.path === path) && !CUSTOM_MANAGED_ADVANCED_PATHS.has(field.path));
    container.innerHTML = fields.length ? `<div class="advanced-fields">${fields.map(advancedFieldMarkup).join("")}</div>` : "";
  });
  bindAdvancedSettings(document);
}

function renderUserLabelSettings() {
  $("#user-label-options").innerHTML = USER_LABEL_OPTIONS.map(option => `
    <label class="check-option"><input data-gm-path="inline_user_info.labels.${option.key}" type="checkbox"><span>${option.label}</span></label>`).join("");
  $("#level-style-grid").innerHTML = USER_LEVEL_STYLES.map(style => `
    <div class="level-style-item">
      <strong>Lv ${style.level}</strong>
      <input data-gm-path="inline_user_info.level_colors.lv${style.level}" type="color" aria-label="Lv ${style.level} 颜色">
      <input data-gm-path="inline_user_info.level_opacity.lv${style.level}" type="number" min="20" max="100" aria-label="Lv ${style.level} 透明度">
      <span>%</span>
    </div>`).join("");
}

function removeLegacyImageHostSettings() {
  const config = getPath(gmSettings, "image_upload");
  if (!config || typeof config !== "object") return false;
  let changed = false;
  for (const key of ["active", "url", "token", "headers"]) {
    if (!(key in config)) continue;
    delete config[key];
    changed = true;
  }
  return changed;
}

function migrateStatusColorSettings() {
  let changed = false;
  const footprint = getPath(gmSettings, "comment_footprint");
  if (footprint && typeof footprint === "object" && !Array.isArray(footprint) && "badge_color" in footprint) {
    footprint.badge_color_light ??= footprint.badge_color;
    footprint.badge_color_dark ??= String(footprint.badge_color).toLowerCase() === "#16a34a" ? "#86efac" : footprint.badge_color;
    delete footprint.badge_color;
    changed = true;
  }
  const lottery = getPath(gmSettings, "lottery_reminder");
  if (lottery && typeof lottery === "object" && !Array.isArray(lottery) && "badge_color" in lottery) {
    lottery.joined_badge_color ??= "#16a34a";
    lottery.unjoined_badge_color ??= lottery.badge_color;
    delete lottery.badge_color;
    changed = true;
  }
  return changed;
}

function bindNodeImageSettings() {
  const input = $("#nodeimage-api-key");
  const toggle = $("#toggle-nodeimage-key");
  input.value = String(getPath(gmSettings, "image_upload.api_key", "") || "");

  toggle.addEventListener("click", () => {
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    toggle.textContent = visible ? "显示" : "隐藏";
    toggle.setAttribute("aria-label", visible ? "显示 API Key" : "隐藏 API Key");
  });
  $("#save-nodeimage-key").addEventListener("click", async () => {
    const key = input.value.trim();
    setPath(gmSettings, "image_upload.api_key", key);
    setPath(gmSettings, "image_upload.api_key_cleared", !key);
    await saveGmSettings(key ? "NodeImage API Key 已保存" : "NodeImage API Key 已清除");
  });
  $("#clear-nodeimage-key").addEventListener("click", async () => {
    input.value = "";
    setPath(gmSettings, "image_upload.api_key", "");
    setPath(gmSettings, "image_upload.api_key_cleared", true);
    await saveGmSettings("NodeImage API Key 已清除");
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Enter") $("#save-nodeimage-key").click();
  });
}

function renderFeatureCount() {
  const enabled = ALL_FEATURES.filter(featureEnabled).length;
  const target = $("#enabled-feature-count");
  if (target) target.textContent = `${enabled} / ${ALL_FEATURES.length} 已启用`;
}

function renderFeatures() {
  $$('[data-feature-category]').forEach(container => {
    const paths = FEATURE_CATEGORIES[container.dataset.featureCategory] || [];
    const features = paths.map(path => ALL_FEATURES.find(feature => (Array.isArray(feature[2]) ? feature[2] : [feature[2]]).includes(path))).filter(Boolean);
    container.innerHTML = features.length ? `<section class="feature-group">${features.map(feature => `
      <div class="feature-row">
        <div><strong>${feature[0]}</strong><small>${feature[1]}</small></div>
        <label class="switch"><input class="feature-toggle" data-feature-path="${Array.isArray(feature[2]) ? feature[2][0] : feature[2]}" type="checkbox" ${featureEnabled(feature) ? "checked" : ""}><span></span></label>
      </div>`).join("")}</section>` : "";
  });
  $$(".feature-toggle").forEach(input => input.addEventListener("change", async () => {
    const feature = ALL_FEATURES.find(item => (Array.isArray(item[2]) ? item[2] : [item[2]]).includes(input.dataset.featurePath));
    if (!feature) return;
    setFeature(feature, input.checked);
    await saveGmSettings();
  }));
  renderFeatureCount();
}

function renderChannels() {
  const container = $("#channel-list");
  container.textContent = "";
  for (const [channel, label] of Object.entries(CHANNEL_LABELS)) {
    const section = document.createElement("section");
    section.className = "channel";
    const fields = (CHANNEL_FIELDS[channel] || []).map(([key, title, type, options]) => {
      const path = `notifications.channels.${channel}.${key}`;
      if (type === "checkbox") return `<label class="setting-row interactive"><strong>${title}</strong><input data-path="${path}" type="checkbox"></label>`;
      if (type === "select") {
        const choices = Object.entries(options).map(([value, text]) => `<option value="${value}">${text}</option>`).join("");
        return `<label class="field"><span>${title}</span><select data-path="${path}">${choices}</select></label>`;
      }
      return `<label class="field"><span>${title}</span><input data-path="${path}" type="${type}"></label>`;
    }).join("");
    section.innerHTML = `
      <div class="channel-head">
        <div><h3>${label}</h3><small id="channel-status-${channel}"></small></div>
        <label class="switch"><input data-path="notifications.channels.${channel}.enabled" type="checkbox"><span></span></label>
      </div>
      <div class="channel-fields">${fields}</div>
      <div class="channel-actions"><button class="button test-channel" data-channel="${channel}" type="button">测试发送</button></div>`;
    container.appendChild(section);
  }
  bindFields(container);
  $$(".test-channel").forEach(button => button.addEventListener("click", () => testChannel(button.dataset.channel, button)));
}

async function testChannel(channel, button) {
  await chrome.storage.local.set({ settings });
  button.disabled = true;
  const status = $(`#channel-status-${channel}`);
  status.textContent = "发送中";
  try {
    const response = await chrome.runtime.sendMessage({ type: "testChannel", channel });
    if (!response?.ok) throw new Error(response?.error || "发送失败");
    status.textContent = "已通过";
    toast(`${CHANNEL_LABELS[channel]} 测试成功`);
  } catch (error) {
    status.textContent = String(error?.message || error);
    toast(`${CHANNEL_LABELS[channel]}：${status.textContent}`, true);
  } finally {
    button.disabled = false;
  }
}

function formatTime(value) {
  if (!value) return "尚未检查";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value));
}

async function renderStatus() {
  const { pollState = { sites: {} }, lastPollSummary } = await chrome.storage.local.get(["pollState", "lastPollSummary"]);
  $("#last-poll").textContent = lastPollSummary?.at ? `最近检查 ${formatTime(lastPollSummary.at)}` : "尚未检查";
  const names = { nodeseek: "NodeSeek", deepflood: "DeepFlood" };
  $("#site-status").innerHTML = Object.entries(names).map(([id, name]) => {
    const state = pollState.sites?.[id];
    const status = !state ? "等待建立基线" : state.error ? state.error : state.initialized ? "运行正常" : "等待建立基线";
    const cls = state?.error ? "status-error" : state?.initialized ? "status-good" : "";
    return `<div class="status-row"><strong>${name}</strong><span class="${cls}">${status}</span><span>${formatTime(state?.lastSuccessAt)}</span></div>`;
  }).join("");
}

function lotteryRecordMarkup(record) {
  const evidence = record.evidence.length
    ? record.evidence.map(key => LOTTERY_EVIDENCE_LABELS[key]).filter(Boolean).join(" + ")
    : "评论";
  const drawStatus = record.drawTime ? displayTime(record.drawTime, "未识别开奖时间") : "未识别开奖时间";
  const sourceLabels = { link: "链接参数", luckyPage: "开奖页", post: "帖子正文" };
  const drawSource = sourceLabels[record.reminder?.drawTimeSource] || "未识别";
  const comparedCount = Object.values(record.reminder?.drawTimeCandidates || {}).filter(value => Number(value) > 0).length;
  const comparisonStatus = record.reminder?.drawTimeConflict
    ? `采用${drawSource}，检测到时间不一致`
    : comparedCount > 1 ? `采用${drawSource}，${comparedCount} 处结果一致` : `采用${drawSource}`;
  const drawCandidates = record.reminder?.drawTimeCandidates || {};
  const candidateSummary = [
    ["链接参数", drawCandidates.link],
    ["开奖页", drawCandidates.luckyPage],
    ["帖子正文", drawCandidates.post]
  ].map(([label, value]) => `${label}：${displayPreciseTime(value)}`).join("；");
  const resultClass = record.reminder?.resultStatus === "won"
    ? "is-won"
    : record.reminder?.resultStatus === "lost" ? "is-lost" : "";
  const resultLabels = { won: "已中奖", lost: "未中奖", unknown: "已开奖" };
  const resultSummary = record.reminder?.resultCheckedAt
    ? resultLabels[record.reminder.resultStatus] || "已开奖"
    : record.reminder?.resultCheckLastError ? "识别失败，等待重试" : "等待开奖";
  const winners = Array.isArray(record.reminder?.winners) ? record.reminder.winners : [];
  const winnerSummary = winners.length
    ? winners.map(winner => typeof winner === "string"
      ? winner
      : `${winner.username || "未知用户"}${Number.isFinite(Number(winner.floor)) ? `（${winner.floor} 楼）` : ""}`).join("、")
    : record.reminder?.resultCheckedAt ? "没有有效中奖者" : "尚未开奖";
  return `
    <article class="lottery-record is-joined">
      <div class="lottery-record-head">
        <div class="lottery-record-title">
          <span class="lottery-state">已评论参与</span>
          <strong>${escapeHtml(record.title)}</strong>
        </div>
        <button class="about-link open-lottery-post" data-url="${escapeHtml(record.postUrl)}" type="button">打开帖子</button>
      </div>
      <div class="lottery-record-meta">
        <span>参与方式：${escapeHtml(evidence)}</span>
        <span>参与时间：${escapeHtml(displayTime(record.confirmedAt))}</span>
        <span>开奖时间：${escapeHtml(drawStatus)}</span>
        <span>时间来源：${escapeHtml(comparisonStatus)}</span>
        <span class="lottery-time-comparison">三处对比：${escapeHtml(candidateSummary)}</span>
        <span class="lottery-result-status ${resultClass}">开奖结果：${escapeHtml(resultSummary)}</span>
        <span class="lottery-winner-list ${resultClass}">中奖者：${escapeHtml(winnerSummary)}</span>
        <span class="lottery-notification-status ${resultClass}">通知状态：${escapeHtml(record.notificationStatus)}</span>
      </div>
    </article>`;
}

function renderLotteryRecords() {
  const summary = buildLotteryRecords(gmStorage);
  $("#lottery-joined-count").textContent = String(summary.joinedCount);
  $("#lottery-pending-count").textContent = String(summary.pendingNotificationCount);
  $("#lottery-record-summary").textContent = summary.records.length
    ? `共 ${summary.records.length} 条记录，评论参加后自动保存`
    : "暂无记录；在抽奖帖评论参加后会自动保存到这里";
  const list = $("#lottery-record-list");
  list.innerHTML = summary.records.length
    ? summary.records.map(lotteryRecordMarkup).join("")
    : '<div class="lottery-record-empty">暂无抽奖记录。只有在 NodeSeek 抽奖帖中成功评论后，记录才会自动出现并进入开奖提醒。</div>';
  list.querySelectorAll(".open-lottery-post").forEach(button => {
    button.addEventListener("click", () => chrome.tabs.create({ url: button.dataset.url }));
  });
}

function lotteryAutoResultConfig() {
  const config = gmStorage.notify_config && typeof gmStorage.notify_config === "object"
    ? gmStorage.notify_config
    : (gmStorage.notify_config = {});
  return config.autoResult && typeof config.autoResult === "object"
    ? config.autoResult
    : (config.autoResult = { enabled: true, username: "" });
}

function renderLotteryNotificationFields() {
  const autoResult = lotteryAutoResultConfig();
  $("#lottery-auto-result").checked = autoResult.enabled !== false;
  $("#lottery-username").value = inputDisplayValue(autoResult.username);
}

function bindLotterySettings() {
  const enabled = $("#lottery-auto-result");
  const username = $("#lottery-username");
  renderLotteryNotificationFields();
  enabled.addEventListener("change", async () => {
    lotteryAutoResultConfig().enabled = enabled.checked;
    await saveGmSettings();
  });
  username.addEventListener("change", async () => {
    lotteryAutoResultConfig().username = username.value.trim();
    await saveGmSettings();
  });
  $("#refresh-lottery-records").addEventListener("click", async () => {
    const stored = await chrome.storage.local.get("gmStorage");
    gmStorage = stored.gmStorage && typeof stored.gmStorage === "object" ? stored.gmStorage : {};
    gmSettings = gmStorage.settings && typeof gmStorage.settings === "object" ? gmStorage.settings : {};
    renderLotteryRecords();
    toast("抽奖记录已刷新");
  });
  $("#lottery-channel-settings").addEventListener("click", () => selectPanel("channels"));
  $("#clear-lottery-records").addEventListener("click", async () => {
    if (!confirm("将清除抽奖参与记录和通知状态，是否继续？")) return;
    delete gmStorage.lottery_reminders;
    delete gmStorage.lottery_participation_history;
    gmStorage.lottery_participation_cleared_at = Date.now();
    await chrome.storage.local.set({ gmStorage });
    renderLotteryRecords();
    toast("抽奖记录已清除");
  });
  renderLotteryRecords();
}

async function sanitizeStoredLotteryData() {
  const result = sanitizeLotteryStorage(gmStorage);
  gmStorage = result.storage;
  gmSettings = gmStorage.settings && typeof gmStorage.settings === "object" ? gmStorage.settings : {};
  if (result.changed) await chrome.storage.local.set({ gmStorage });
  return result.changed;
}

function renderForumPanel(name) {
  if (name === "quick") renderQuickPhrases();
  else if (name === "content") renderContentManagement();
  else if (name === "footprint") renderFootprintHistory();
}

function ensureForumPanelData(name) {
  if (!forumDataPanels.has(name)) return;
  if (forumDataCache[activeForumSite]) {
    renderForumPanel(name);
    return;
  }
  if (!forumPanelLoadPromise) {
    forumPanelLoadPromise = loadForumData(activeForumSite)
      .finally(() => { forumPanelLoadPromise = null; });
  }
  forumPanelLoadPromise.then(() => renderForumPanel(name)).catch(error => {
    toast(`NodeSeek 数据读取失败：${String(error?.message || error)}`, true);
  });
}

function selectPanel(name) {
  name = PANEL_ALIASES[name] || name;
  if (!PAGE_META[name]) name = "labels";
  $$(".nav-item").forEach(item => item.classList.toggle("active", item.dataset.tab === name));
  $$(".panel").forEach(panel => panel.classList.toggle("active", panel.dataset.panel === name));
  const [title, description] = PAGE_META[name];
  $("#page-title").textContent = title;
  $("#page-description").textContent = description;
  ensureForumPanelData(name);
}

async function refreshForumTabs() {
  const tabs = await chrome.tabs.query({});
  const forumTabs = tabs.filter(tab => /^https?:\/\/(?:www\.)?(?:nodeseek|deepflood)\.com\//i.test(tab.url || ""));
  await Promise.all(forumTabs.map(tab => chrome.tabs.reload(tab.id)));
  toast(forumTabs.length ? `已刷新 ${forumTabs.length} 个论坛页面` : "当前没有打开的论坛页面");
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function sendForumMessage(tabId, message, attempts = 30) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw lastError || new Error("论坛页面连接失败");
}

function receiverMissing(error) {
  return /Receiving end does not exist|Could not establish connection|message port closed/i.test(String(error?.message || error));
}

async function useForumTab(site, message, { createIfMissing = true, repairReceiver = true } = {}) {
  const existing = await chrome.tabs.query({ url: site.matches });
  if (!existing.length && !createIfMissing) throw new Error("未打开该论坛，已跳过以避免创建新标签页");
  const temporary = existing.length === 0;
  const tab = existing[0] || await chrome.tabs.create({ url: site.url, active: false });
  try {
    let response;
    try {
      response = await sendForumMessage(tab.id, message, temporary ? 30 : 1);
    } catch (error) {
      if (!temporary && repairReceiver && receiverMissing(error)) {
        await chrome.tabs.reload(tab.id);
        response = await sendForumMessage(tab.id, message);
      } else {
        throw error;
      }
    }
    if (!response?.ok) throw new Error(response?.error || "论坛数据操作失败");
    return response.data;
  } finally {
    if (temporary && tab.id != null) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function collectUserInfoForums() {
  const entries = await Promise.all(Object.entries(FORUM_SITES).map(async ([id, site]) => {
    try {
      const localStorage = await useForumTab(site, {
        type: "forumDataGet",
        keys: USER_SETTINGS_FORUM_KEYS
      }, { createIfMissing: false, repairReceiver: false });
      return [id, {
        schemaVersion: BACKUP_SCHEMA_VERSION,
        partial: true,
        origin: new URL(site.url).origin,
        localStorage,
        indexedDB: {}
      }, ""];
    } catch (error) {
      return [id, null, `${site.name}: ${String(error?.message || error)}`];
    }
  }));
  return {
    forums: Object.fromEntries(entries.filter(([, data]) => data).map(([id, data]) => [id, data])),
    errors: entries.map(([, , error]) => error).filter(Boolean)
  };
}

async function collectForumBackups() {
  const entries = await Promise.all(Object.entries(FORUM_SITES).map(async ([id, site]) => {
    try {
      return [id, await useForumTab(site, { type: "forumBackupCollect" }, { createIfMissing: false }), ""];
    } catch (error) {
      return [id, null, `${site.name}: ${String(error?.message || error)}`];
    }
  }));
  return {
    forums: Object.fromEntries(entries.filter(([, data]) => data).map(([id, data]) => [id, data])),
    errors: entries.map(([, , error]) => error).filter(Boolean)
  };
}

async function applyForumBackups(forums) {
  const errors = [];
  for (const [id, payload] of Object.entries(forums || {})) {
    const site = FORUM_SITES[id];
    if (!site || !payload) continue;
    try {
      await useForumTab(site, { type: "forumBackupApply", payload });
    } catch (error) {
      errors.push(`${site.name}: ${String(error?.message || error)}`);
    }
  }
  return errors;
}

function normalizeForumManagementData(values = {}) {
  return {
    groups: normalizeContentGroups(values[CONTENT_GROUPS_KEY]),
    keywords: normalizeKeywordRules(values[KEYWORD_RULES_KEY]),
    users: normalizeUserBlockRules(values[USER_BLOCK_RULES_KEY]),
    phrases: normalizeQuickPhrases(values[QUICK_PHRASES_KEY]),
    quickAutoSubmit: String(values[QUICK_AUTO_SUBMIT_KEY] ?? "false") === "true",
    history: normalizeForumHistory(values[BROWSING_HISTORY_KEY]),
    recentlyClosed: normalizeForumHistory(values[RECENTLY_CLOSED_KEY])
  };
}

async function loadForumData(siteId, force = false) {
  if (!force && forumDataCache[siteId]) return forumDataCache[siteId];
  const site = FORUM_SITES[siteId];
  const values = await useForumTab(site, { type: "forumDataGet", keys: MANAGED_FORUM_DATA_KEYS });
  forumDataCache[siteId] = normalizeForumManagementData(values);
  return forumDataCache[siteId];
}

async function saveForumData(values, message = "论坛数据已保存") {
  const site = FORUM_SITES[activeForumSite];
  await useForumTab(site, { type: "forumDataSet", values });
  toast(`${site.name} ${message}`);
}

function currentForumData() {
  return forumDataCache[activeForumSite] ||= normalizeForumManagementData();
}

function managementEmpty(text) {
  return `<div class="management-empty">${escapeHtml(text)}</div>`;
}

function groupOptions(groups, selected = "") {
  return `<option value="">未分组</option>${groups.map(group => `
    <option value="${escapeHtml(group.id)}"${group.id === selected ? " selected" : ""}>${escapeHtml(group.name)}</option>`).join("")}`;
}

function renderRuleGroups(kind) {
  const data = currentForumData();
  const groups = data.groups[kind];
  const rules = kind === "keywords" ? data.keywords : data.users;
  const target = kind === "keywords" ? $("#keyword-rule-groups") : $("#user-rule-groups");
  const summary = kind === "keywords" ? $("#keyword-group-summary") : $("#user-group-summary");
  summary.textContent = `${groups.length} 个分组`;
  target.innerHTML = groups.length ? groups.map(group => {
    const count = Object.values(rules).filter(rule => rule.group === group.id).length;
    return `<div class="management-list-item">
      <span class="color-swatch" style="background:${group.color}"></span>
      <div><strong>${escapeHtml(group.name)}</strong><span>${count} 条规则 · ${group.enabled ? "已启用" : "已停用"}</span></div>
      <label class="switch"><input data-toggle-rule-group="${escapeHtml(group.id)}" data-kind="${kind}" type="checkbox" ${group.enabled ? "checked" : ""}><span></span></label>
      <button class="icon-text-button" data-add-rule-to-group="${escapeHtml(group.id)}" data-kind="${kind}" type="button">添加规则</button>
      <button class="icon-text-button" data-edit-rule-group="${escapeHtml(group.id)}" data-kind="${kind}" type="button">编辑</button>
      <button class="icon-button danger" data-delete-rule-group="${escapeHtml(group.id)}" data-kind="${kind}" type="button" title="删除分组" aria-label="删除分组">×</button>
    </div>`;
  }).join("") : managementEmpty(kind === "keywords" ? "暂无标记关键词组" : "暂无标记用户组");
}

function renderContentManagement() {
  const data = currentForumData();
  $("#content-keyword-enabled").checked = Boolean(getPath(gmSettings, "block_posts.enabled", true));
  $("#content-user-enabled").checked = Boolean(getPath(gmSettings, "relation.blacklist_enabled", true));
  $("#keyword-rule-summary").textContent = `${Object.keys(data.keywords).length} 个关键词`;
  $("#user-rule-summary").textContent = `${Object.keys(data.users).length} 个用户`;
  renderRuleGroups("keywords");
  renderRuleGroups("users");
  bindRenderedManagementActions();
}

function renderQuickPhrases() {
  const data = currentForumData();
  $("#quick-comment-enabled").checked = Boolean(getPath(gmSettings, "quick_comment.enabled", true));
  $("#quick-phrases-enabled").checked = Boolean(getPath(gmSettings, "quick_comment.phrases_enabled", true));
  $("#quick-auto-submit").checked = data.quickAutoSubmit;
  const groups = Object.entries(data.phrases);
  const total = groups.reduce((sum, [, items]) => sum + items.length, 0);
  $("#quick-phrase-summary").textContent = `${groups.length} 个分组 · ${total} 条短语`;
  $("#quick-phrase-groups").innerHTML = groups.length ? groups.map(([name, items]) => `
    <section class="phrase-group">
      <header><div><strong>${escapeHtml(name)}</strong><span>${items.length} 条短语</span></div><div class="inline-actions"><button class="icon-text-button" data-rename-phrase-group="${escapeHtml(name)}" type="button">重命名</button><button class="icon-button danger" data-delete-phrase-group="${escapeHtml(name)}" type="button" title="删除分组" aria-label="删除分组">×</button></div></header>
      <div class="phrase-list">${items.length ? items.map((item, index) => `
        <div class="phrase-item"><div><strong title="${escapeHtml(item.content)}">${escapeHtml(item.content)}</strong></div><div class="inline-actions"><button class="icon-text-button" data-edit-phrase="${index}" data-group="${escapeHtml(name)}" type="button">编辑</button><button class="icon-button danger" data-delete-phrase="${index}" data-group="${escapeHtml(name)}" type="button" title="删除短语" aria-label="删除短语">×</button></div></div>`).join("") : managementEmpty("暂无快捷短语")}</div>
      <footer><button class="button" data-add-phrase="${escapeHtml(name)}" type="button">添加短语</button></footer>
    </section>`).join("") : managementEmpty("暂无快捷短语分组，请先新建分组");
  bindRenderedManagementActions();
}

function footprintDateKey(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = number => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function footprintDateTitle(key) {
  const date = new Date(`${key}T00:00:00`);
  const weekdays = ["日", "一", "二", "三", "四", "五", "六"];
  const title = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 星期${weekdays[date.getDay()]}`;
  return key === footprintDateKey(new Date()) ? `今天 - ${title}` : title;
}

function footprintItemMarkup(item, kind) {
  const site = FORUM_SITES[activeForumSite];
  const time = new Date(item.time);
  const timeText = Number.isFinite(time.getTime())
    ? time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";
  const postUrl = new URL(`/post-${item.postId}-1`, site.url).href;
  const avatar = item.uid ? new URL(`/avatar/${item.uid}.png`, site.url).href : "";
  return `<div class="footprint-history-item">
    <button class="footprint-open" data-url="${escapeHtml(postUrl)}" type="button" title="${escapeHtml(item.title)}">
      <span class="footprint-avatar">${avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy">` : ""}</span>
      <span class="footprint-title">${escapeHtml(item.title)}</span>
    </button>
    <time>${escapeHtml(timeText)}</time>
    <button class="footprint-delete" data-footprint-kind="${kind}" data-footprint-delete="${escapeHtml(item.postId)}" type="button" title="删除" aria-label="删除">×</button>
  </div>`;
}

function footprintConfig(kind) {
  return kind === "recent"
    ? { dataKey: "recentlyClosed", storageKey: RECENTLY_CLOSED_KEY, listId: "#footprint-recent-list" }
    : { dataKey: "history", storageKey: BROWSING_HISTORY_KEY, listId: "#footprint-history-list" };
}

function renderFootprintList(kind) {
  const data = currentForumData();
  const config = footprintConfig(kind);
  const source = data[config.dataKey];
  const keyword = footprintSearch[kind].trim().toLowerCase();
  const items = source.filter(item => !keyword || item.title.toLowerCase().includes(keyword) || String(item.author || "").toLowerCase().includes(keyword));
  const groups = new Map();
  items.forEach(item => {
    const key = footprintDateKey(item.time);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  const list = $(config.listId);
  list.innerHTML = groups.size ? [...groups.entries()].map(([key, groupItems]) => `
    <section class="footprint-day">
      <header><span>${escapeHtml(footprintDateTitle(key))}</span><button data-footprint-kind="${kind}" data-footprint-clear-day="${escapeHtml(key)}" type="button" title="清除当天" aria-label="清除当天">×</button></header>
      <div>${groupItems.map(item => footprintItemMarkup(item, kind)).join("")}</div>
    </section>`).join("") : `<div class="footprint-empty">${keyword ? "没有匹配的记录" : "暂无记录"}</div>`;
  list.querySelectorAll(".footprint-open").forEach(button => {
    button.addEventListener("click", () => chrome.tabs.create({ url: button.dataset.url }));
  });
  list.querySelectorAll('[data-footprint-delete]').forEach(button => button.addEventListener("click", async () => {
    const selected = footprintConfig(button.dataset.footprintKind);
    data[selected.dataKey] = data[selected.dataKey].filter(item => item.postId !== button.dataset.footprintDelete);
    await saveForumData({ [selected.storageKey]: data[selected.dataKey] }, "记录已删除");
    renderFootprintList(button.dataset.footprintKind);
  }));
  list.querySelectorAll('[data-footprint-clear-day]').forEach(button => button.addEventListener("click", async () => {
    const selected = footprintConfig(button.dataset.footprintKind);
    data[selected.dataKey] = data[selected.dataKey].filter(item => footprintDateKey(item.time) !== button.dataset.footprintClearDay);
    await saveForumData({ [selected.storageKey]: data[selected.dataKey] }, "当天记录已清除");
    renderFootprintList(button.dataset.footprintKind);
  }));
}

function renderFootprintHistory() {
  renderFootprintList("history");
  renderFootprintList("recent");
}

function openManagementDialog({ title, description = "", body, saveLabel = "保存", onSave }) {
  const dialog = $("#management-dialog");
  $("#management-dialog-title").textContent = title;
  $("#management-dialog-description").textContent = description;
  $("#management-dialog-body").innerHTML = body;
  $("#management-dialog-save").textContent = saveLabel;
  dialog._onSave = onSave;
  dialog.showModal();
  requestAnimationFrame(() => dialog.querySelector("input,textarea,select")?.focus());
}

function editRuleGroup(kind, groupId = "") {
  const data = currentForumData();
  const groups = data.groups[kind];
  const group = groups.find(item => item.id === groupId);
  openManagementDialog({
    title: group ? "编辑分组" : "新建分组",
    description: kind === "keywords" ? "用于归类关键词高亮与屏蔽规则" : "用于归类用户标记与屏蔽规则",
    body: `<div class="dialog-field"><label for="rule-group-name">分组名称</label><input id="rule-group-name" name="name" maxlength="32" value="${escapeHtml(group?.name || "")}" required></div>
      <div class="dialog-grid"><div class="dialog-field"><label for="rule-group-color">标记颜色</label><input id="rule-group-color" name="color" type="color" value="${escapeHtml(group?.color || (kind === "keywords" ? "#f59e0b" : "#ef4444"))}"></div>
      <label class="dialog-check"><input name="enabled" type="checkbox" ${group?.enabled !== false ? "checked" : ""}><span>启用此分组</span></label></div>`,
    onSave: async form => {
      const name = String(form.elements.name.value || "").trim();
      if (!name) throw new Error("分组名称不能为空");
      let savedGroup = group;
      if (group) Object.assign(group, { name, color: form.elements.color.value, enabled: form.elements.enabled.checked });
      else {
        savedGroup = { id: makeForumRuleId(kind), name, color: form.elements.color.value, enabled: form.elements.enabled.checked };
        groups.push(savedGroup);
      }
      await saveForumData({ [CONTENT_GROUPS_KEY]: data.groups }, "分组已保存");
      renderContentManagement();
      if (!group) setTimeout(() => editRules(kind, savedGroup.id, true), 0);
    }
  });
}

function keywordRuleRow(word = "", rule = {}) {
  const mode = rule.type === "highlight" ? "highlight" : rule.mode === "hide" ? "hide" : "fold";
  return `<div class="rule-editor-row" data-original="${escapeHtml(word)}">
    <input class="rule-value" value="${escapeHtml(word)}" placeholder="关键词或逗号分隔的同义词">
    <select class="rule-group">${groupOptions(currentForumData().groups.keywords, rule.group)}</select>
    <select class="rule-mode"><option value="fold"${mode === "fold" ? " selected" : ""}>折叠</option><option value="hide"${mode === "hide" ? " selected" : ""}>隐藏</option><option value="highlight"${mode === "highlight" ? " selected" : ""}>高亮</option></select>
    <input class="rule-color" type="color" value="${escapeHtml(rule.color || "#fff9c4")}" title="高亮颜色">
    <label class="row-check" title="启用"><input class="rule-enabled" type="checkbox" ${rule.enabled !== false ? "checked" : ""}></label>
    <button class="icon-button danger" data-remove-editor-row type="button" title="删除" aria-label="删除">×</button>
  </div>`;
}

function userRuleRow(username = "", rule = {}) {
  return `<div class="rule-editor-row user-rule-row" data-original="${escapeHtml(username)}">
    <input class="rule-value" value="${escapeHtml(username)}" placeholder="用户名">
    <input class="rule-remark" value="${escapeHtml(rule.remark || "")}" placeholder="备注（可选）">
    <select class="rule-group">${groupOptions(currentForumData().groups.users, rule.group)}</select>
    <select class="rule-mode"><option value="fold"${rule.mode === "fold" || !rule.mode ? " selected" : ""}>折叠</option><option value="official"${rule.mode === "official" ? " selected" : ""}>隐藏</option><option value="mark"${rule.mode === "mark" ? " selected" : ""}>标记</option></select>
    <label class="row-check" title="启用"><input class="rule-enabled" type="checkbox" ${rule.enabled !== false ? "checked" : ""}></label>
    <button class="icon-button danger" data-remove-editor-row type="button" title="删除" aria-label="删除">×</button>
  </div>`;
}

function editRules(kind, initialGroup = "", addNew = false) {
  const data = currentForumData();
  const rules = kind === "keywords" ? data.keywords : data.users;
  const rowMarkup = kind === "keywords" ? keywordRuleRow : userRuleRow;
  openManagementDialog({
    title: kind === "keywords" ? "编辑关键词规则" : "编辑用户屏蔽",
    description: kind === "keywords" ? "关键词匹配主题标题，可选择折叠、隐藏或高亮" : "用户名精确匹配，可选择折叠、隐藏或仅标记",
    body: `<div class="rule-editor-toolbar"><span>${Object.keys(rules).length} 条规则</span><button id="add-editor-row" class="button" type="button">添加规则</button></div><div id="rule-editor-list" class="rule-editor-list">${Object.entries(rules).map(([key, rule]) => rowMarkup(key, rule)).join("")}${addNew ? rowMarkup("", { group: initialGroup }) : ""}${!Object.keys(rules).length && !addNew ? managementEmpty("暂无规则") : ""}</div>`,
    onSave: async () => {
      const next = {};
      $$("#rule-editor-list .rule-editor-row").forEach(row => {
        const key = row.querySelector(".rule-value").value.trim();
        if (!key) return;
        const mode = row.querySelector(".rule-mode").value;
        if (kind === "keywords") {
          next[key] = {
            type: mode === "highlight" ? "highlight" : "block",
            mode: mode === "highlight" ? null : mode,
            color: mode === "highlight" ? row.querySelector(".rule-color").value : null,
            group: row.querySelector(".rule-group").value,
            enabled: row.querySelector(".rule-enabled").checked,
            time: new Date().toLocaleString()
          };
        } else {
          next[key] = {
            remark: row.querySelector(".rule-remark").value.trim(),
            mode,
            group: row.querySelector(".rule-group").value,
            enabled: row.querySelector(".rule-enabled").checked,
            time: new Date().toLocaleString()
          };
        }
      });
      if (kind === "keywords") data.keywords = normalizeKeywordRules(next);
      else data.users = normalizeUserBlockRules(next);
      await saveForumData({ [kind === "keywords" ? KEYWORD_RULES_KEY : USER_BLOCK_RULES_KEY]: kind === "keywords" ? data.keywords : data.users }, "屏蔽规则已保存");
      renderContentManagement();
    }
  });
  $("#add-editor-row").addEventListener("click", () => {
    const list = $("#rule-editor-list");
    list.querySelector(".management-empty")?.remove();
    list.insertAdjacentHTML("beforeend", rowMarkup("", { group: initialGroup }));
    list.lastElementChild?.querySelector(".rule-value")?.focus();
  });
  $("#rule-editor-list").addEventListener("click", event => event.target.closest("[data-remove-editor-row]")?.closest(".rule-editor-row")?.remove());
}

function editPhraseGroup(oldName = "") {
  const data = currentForumData();
  openManagementDialog({
    title: oldName ? "重命名短语分组" : "新建短语分组",
    body: `<div class="dialog-field"><label for="phrase-group-name">分组名称</label><input id="phrase-group-name" name="name" maxlength="32" value="${escapeHtml(oldName)}" required></div>`,
    onSave: async form => {
      const name = String(form.elements.name.value || "").trim();
      if (!name) throw new Error("分组名称不能为空");
      if (name !== oldName && Object.prototype.hasOwnProperty.call(data.phrases, name)) throw new Error("已有同名分组");
      if (oldName) {
        const next = {};
        Object.entries(data.phrases).forEach(([key, items]) => { next[key === oldName ? name : key] = items; });
        data.phrases = next;
      } else data.phrases[name] = [];
      await saveForumData({ [QUICK_PHRASES_KEY]: data.phrases }, "短语分组已保存");
      renderQuickPhrases();
    }
  });
}

function editPhrase(groupName, index = -1) {
  const data = currentForumData();
  const item = index >= 0 ? data.phrases[groupName]?.[index] : null;
  openManagementDialog({
    title: item ? "编辑快捷短语" : "添加快捷短语",
    description: "正文会直接显示在短语列表，并插入编辑器当前光标位置",
    body: `<div class="dialog-field"><label for="phrase-content">正文</label><textarea id="phrase-content" name="content" rows="9" required>${escapeHtml(item?.content || "")}</textarea></div>`,
    onSave: async form => {
      const content = String(form.elements.content.value || "").trim();
      if (!content) throw new Error("短语正文不能为空");
      const next = { title: shrinkPhrase(content), content };
      if (item) data.phrases[groupName][index] = next;
      else data.phrases[groupName].push(next);
      await saveForumData({ [QUICK_PHRASES_KEY]: data.phrases }, "快捷短语已保存");
      renderQuickPhrases();
    }
  });
}

function bindRenderedManagementActions() {
  const unbound = selector => $$(selector).filter(element => {
    if (element.dataset.managementBound) return false;
    element.dataset.managementBound = "true";
    return true;
  });
  unbound('[data-toggle-rule-group]').forEach(input => input.addEventListener("change", async () => {
    const data = currentForumData();
    const group = data.groups[input.dataset.kind].find(item => item.id === input.dataset.toggleRuleGroup);
    if (!group) return;
    group.enabled = input.checked;
    await saveForumData({ [CONTENT_GROUPS_KEY]: data.groups }, "分组状态已保存");
    renderContentManagement();
  }));
  unbound('[data-edit-rule-group]').forEach(button => button.addEventListener("click", () => editRuleGroup(button.dataset.kind, button.dataset.editRuleGroup)));
  unbound('[data-add-rule-to-group]').forEach(button => button.addEventListener("click", () => editRules(button.dataset.kind, button.dataset.addRuleToGroup, true)));
  unbound('[data-delete-rule-group]').forEach(button => button.addEventListener("click", async () => {
    const kind = button.dataset.kind;
    const id = button.dataset.deleteRuleGroup;
    const data = currentForumData();
    const group = data.groups[kind].find(item => item.id === id);
    if (!group || !confirm(`删除分组“${group.name}”？组内规则会保留为未分组。`)) return;
    data.groups[kind] = data.groups[kind].filter(item => item.id !== id);
    const rules = kind === "keywords" ? data.keywords : data.users;
    Object.values(rules).forEach(rule => { if (rule.group === id) rule.group = ""; });
    await saveForumData({ [CONTENT_GROUPS_KEY]: data.groups, [kind === "keywords" ? KEYWORD_RULES_KEY : USER_BLOCK_RULES_KEY]: rules }, "分组已删除");
    renderContentManagement();
  }));
  unbound('[data-rename-phrase-group]').forEach(button => button.addEventListener("click", () => editPhraseGroup(button.dataset.renamePhraseGroup)));
  unbound('[data-delete-phrase-group]').forEach(button => button.addEventListener("click", async () => {
    const data = currentForumData();
    const name = button.dataset.deletePhraseGroup;
    if (!confirm(`删除分组“${name}”及其中全部短语？`)) return;
    delete data.phrases[name];
    await saveForumData({ [QUICK_PHRASES_KEY]: data.phrases }, "短语分组已删除");
    renderQuickPhrases();
  }));
  unbound('[data-add-phrase]').forEach(button => button.addEventListener("click", () => editPhrase(button.dataset.addPhrase)));
  unbound('[data-edit-phrase]').forEach(button => button.addEventListener("click", () => editPhrase(button.dataset.group, Number(button.dataset.editPhrase))));
  unbound('[data-delete-phrase]').forEach(button => button.addEventListener("click", async () => {
    const data = currentForumData();
    const group = button.dataset.group;
    const index = Number(button.dataset.deletePhrase);
    if (!confirm("删除这条快捷短语？")) return;
    data.phrases[group].splice(index, 1);
    await saveForumData({ [QUICK_PHRASES_KEY]: data.phrases }, "快捷短语已删除");
    renderQuickPhrases();
  }));
}

function bindForumManagement() {
  $("#content-keyword-enabled").addEventListener("change", async event => {
    setPath(gmSettings, "block_posts.enabled", event.target.checked);
    await saveGmSettings();
  });
  $("#content-user-enabled").addEventListener("change", async event => {
    setPath(gmSettings, "relation.blacklist_enabled", event.target.checked);
    await saveGmSettings();
  });
  $("#quick-comment-enabled").addEventListener("change", async event => {
    setPath(gmSettings, "quick_comment.enabled", event.target.checked);
    await saveGmSettings();
  });
  $("#quick-phrases-enabled").addEventListener("change", async event => {
    setPath(gmSettings, "quick_comment.phrases_enabled", event.target.checked);
    await saveGmSettings();
  });
  $("#quick-auto-submit").addEventListener("change", async event => {
    currentForumData().quickAutoSubmit = event.target.checked;
    await saveForumData({ [QUICK_AUTO_SUBMIT_KEY]: event.target.checked }, "自动提交设置已保存");
  });
  $$('[data-add-rule-group]').forEach(button => button.addEventListener("click", () => editRuleGroup(button.dataset.addRuleGroup)));
  $("#edit-keyword-rules").addEventListener("click", () => editRules("keywords"));
  $("#edit-user-rules").addEventListener("click", () => editRules("users"));
  $("#reset-content-rules").addEventListener("click", async () => {
    if (!confirm(`清空 ${FORUM_SITES[activeForumSite].name} 的关键词、用户屏蔽和自定义分组？`)) return;
    const data = currentForumData();
    data.groups = normalizeContentGroups();
    data.keywords = {};
    data.users = {};
    await saveForumData({ [CONTENT_GROUPS_KEY]: data.groups, [KEYWORD_RULES_KEY]: {}, [USER_BLOCK_RULES_KEY]: {} }, "内容规则已恢复默认");
    renderContentManagement();
  });
  $("#add-phrase-group").addEventListener("click", () => editPhraseGroup());
  $("#refresh-footprint-history").addEventListener("click", async () => {
    try {
      await loadForumData(activeForumSite, true);
      renderFootprintHistory();
      toast(`${FORUM_SITES[activeForumSite].name} 访问足迹已刷新`);
    } catch (error) {
      toast(`访问足迹读取失败：${String(error?.message || error)}`, true);
    }
  });
  [["history", "#clear-footprint-history", "#footprint-history-search", "浏览历史"], ["recent", "#clear-footprint-recent", "#footprint-recent-search", "最近关闭记录"]]
    .forEach(([kind, clearSelector, searchSelector, label]) => {
      $(clearSelector).addEventListener("click", async () => {
        if (!confirm(`清空 ${FORUM_SITES[activeForumSite].name} 的${label}？`)) return;
        const data = currentForumData();
        const config = footprintConfig(kind);
        data[config.dataKey] = [];
        await saveForumData({ [config.storageKey]: [] }, `${label}已清空`);
        renderFootprintList(kind);
      });
      $(searchSelector).addEventListener("input", event => {
        footprintSearch[kind] = event.target.value;
        renderFootprintList(kind);
      });
    });

  const dialog = $("#management-dialog");
  $("#management-dialog-close").addEventListener("click", () => dialog.close());
  $("#management-dialog-cancel").addEventListener("click", () => dialog.close());
  $("#management-dialog-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = $("#management-dialog-save");
    button.disabled = true;
    try {
      await dialog._onSave?.(event.currentTarget);
      dialog.close();
    } catch (error) {
      toast(String(error?.message || error), true);
    } finally {
      button.disabled = false;
    }
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) dialog.close();
  });
}

function downloadBackup(payload, name = "nodeseek-expansion-tool-backup") {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function init() {
  const [stored, session] = await Promise.all([
    chrome.storage.local.get(["settings", "gmStorage"]),
    chrome.storage.session.get("requestedOptionsPanel")
  ]);
  settings = mergeDefaults(stored.settings, DEFAULT_SETTINGS);
  const manifest = chrome.runtime.getManifest();
  $("#extension-version").textContent = manifest.version;
  $("#minimum-browser-version").textContent = manifest.minimum_chrome_version || "111";
  gmStorage = stored.gmStorage && typeof stored.gmStorage === "object" ? stored.gmStorage : {};
  gmSettings = gmStorage.settings && typeof gmStorage.settings === "object" ? gmStorage.settings : {};
  await sanitizeStoredLotteryData();
  const settingsMigrated = migrateStatusColorSettings();
  const imageSettingsMigrated = removeLegacyImageHostSettings();
  if (settingsMigrated || imageSettingsMigrated) {
    gmStorage.settings = gmSettings;
    await chrome.storage.local.set({ gmStorage });
  }
  await chrome.storage.local.set({ settings });

  applyTheme(settings.appearance.theme);
  bindFields();
  renderUserLabelSettings();
  renderFeatures();
  renderAdvancedSettings();
  bindNodeImageSettings();
  bindLotterySettings();
  renderChannels();
  bindForumManagement();
  await renderStatus();
  selectPanel(session.requestedOptionsPanel || "labels");
  if (session.requestedOptionsPanel) await chrome.storage.session.remove("requestedOptionsPanel");

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (settings.appearance.theme === "system") applyTheme("system");
  });
  $$("[data-theme-value]").forEach(button => button.addEventListener("click", () => {
    settings.appearance.theme = button.dataset.themeValue;
    applyTheme(settings.appearance.theme);
    queueSettingsSave();
  }));
  $$(".nav-item").forEach(button => button.addEventListener("click", () => selectPanel(button.dataset.tab)));
  $$(".open-site").forEach(button => button.addEventListener("click", () => chrome.tabs.create({ url: button.dataset.url })));
  $$(".retry-signin").forEach(button => button.addEventListener("click", async () => {
    const site = button.dataset.site;
    if (!getPath(gmSettings, `sign_in.${site}.enabled`, true)) {
      toast("请先开启该站点的自动签到", true);
      return;
    }
    setPath(gmSettings, `sign_in.${site}.last_date`, "1753/1/1");
    setPath(gmSettings, `sign_in.${site}.ignore_date`, "");
    await saveGmSettings("");
    const tabs = await chrome.tabs.query({ url: `${button.dataset.url}*` });
    if (tabs.length) await Promise.all(tabs.map(tab => chrome.tabs.reload(tab.id)));
    else await chrome.tabs.create({ url: button.dataset.url });
    toast(`${site === "ns" ? "NodeSeek" : "DeepFlood"} 已准备重新签到`);
  }));

  $("#enable-recommended").addEventListener("click", async () => {
    FEATURE_GROUPS.flatMap(group => group.features).forEach(feature => setFeature(feature, feature[4]));
    await saveGmSettings("");
    renderFeatures();
    toast("已应用推荐设置");
  });
  $("#refresh-forum-tabs").addEventListener("click", refreshForumTabs);
  $("#poll-now").addEventListener("click", async event => {
    event.currentTarget.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "pollNow" });
      if (result?.errors?.length) toast(result.errors.join("；"), true);
      else toast(result?.newItems ? `发现 ${result.newItems} 条新通知` : "检查完成");
      await renderStatus();
    } finally {
      event.currentTarget.disabled = false;
    }
  });
  $("#reset-notification-templates").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    saveSequence += 1;
    settings.notifications.templates = { ...DEFAULT_SETTINGS.notifications.templates };
    $$('[data-path^="notifications.templates."]').forEach(input => {
      input.value = inputDisplayValue(getPath(settings, input.dataset.path));
    });
    try {
      await chrome.storage.local.set({ settings });
      toast("消息模板已恢复默认");
    } catch {
      toast("消息模板恢复失败", true);
    }
  });
  $("#reset-baseline").addEventListener("click", async () => {
    await chrome.storage.local.remove(["pollState", "pendingDeliveries"]);
    toast("通知基线已重置");
    await renderStatus();
  });
  $("#clear-logs").addEventListener("click", async () => {
    await chrome.storage.local.remove(["deliveryLogs", "lastPollSummary"]);
    toast("发送记录已清除");
    await renderStatus();
  });
  $("#export-user-settings").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { forums, errors } = await collectUserInfoForums();
      downloadBackup(createUserInfoBackup({
        settings,
        gmStorage: { ...gmStorage, settings: gmSettings },
        forums,
        extensionVersion: chrome.runtime.getManifest().version
      }), "nodeseek-expansion-tool-user-settings");
      toast(errors.length ? `用户信息已导出，未读取论坛页面数据：${errors.join("；")}` : "用户信息已导出");
    } finally {
      button.disabled = false;
    }
  });
  $("#export-settings").addEventListener("click", async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const { forums, errors } = await collectForumBackups();
      downloadBackup(createExtensionBackup({
        settings,
        gmStorage: { ...gmStorage, settings: gmSettings },
        forums,
        extensionVersion: chrome.runtime.getManifest().version
      }));
      toast(errors.length ? `备份已导出，部分论坛数据未读取：${errors.join("；")}` : "完整备份已导出");
    } finally {
      button.disabled = false;
    }
  });
  $("#import-settings").addEventListener("change", async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;
      const imported = parseBackupPayload(JSON.parse(await file.text()));
      if (!confirm("还原将覆盖当前扩展配置和备份中包含的论坛本地数据，是否继续？")) return;
      if (imported.extensionSettings) settings = mergeDefaults(imported.extensionSettings, DEFAULT_SETTINGS);
      if (imported.gmStorage) {
        gmStorage = imported.partial
          ? mergePartialObject(gmStorage, imported.gmStorage)
          : { ...gmStorage, ...imported.gmStorage };
      }
      gmSettings = gmStorage.settings && typeof gmStorage.settings === "object" ? gmStorage.settings : {};
      await chrome.storage.local.set({ settings, gmStorage });
      const errors = await applyForumBackups(imported.forums);
      if (errors.length) {
        toast(`配置已还原，部分论坛数据失败：${errors.join("；")}`, true);
        return;
      }
      await refreshForumTabs();
      location.reload();
    } catch (error) {
      toast(`导入失败：${error.message}`, true);
    } finally {
      event.target.value = "";
    }
  });
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes.gmStorage?.newValue) {
    gmStorage = changes.gmStorage.newValue;
    gmSettings = gmStorage.settings && typeof gmStorage.settings === "object" ? gmStorage.settings : {};
    const sanitized = sanitizeLotteryStorage(gmStorage);
    gmStorage = sanitized.storage;
    if (sanitized.changed) chrome.storage.local.set({ gmStorage });
    renderLotteryRecords();
    renderLotteryNotificationFields();
  }
  const requestedPanel = changes.requestedOptionsPanel?.newValue;
  if (areaName !== "session" || !requestedPanel) return;
  selectPanel(requestedPanel);
  chrome.storage.session.remove("requestedOptionsPanel");
});

init();

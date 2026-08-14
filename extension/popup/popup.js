import { DEFAULT_SETTINGS, mergeDefaults } from "../shared/config.js";

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let settings;
let gmStorage;
let gmSettings;

function getPath(object, path, fallback) {
  const value = String(path).split(".").reduce((result, key) => result?.[key], object);
  return value === undefined ? fallback : value;
}

function setPath(object, path, value) {
  const keys = String(path).split(".");
  const last = keys.pop();
  keys.reduce((target, key) => target[key] ??= {}, object)[last] = value;
}

function resolvedTheme(mode) {
  return mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
}

function applyTheme() {
  document.documentElement.dataset.theme = resolvedTheme(settings.appearance.theme);
  $("#theme-toggle").textContent = settings.appearance.theme === "system" ? "◐" : settings.appearance.theme === "dark" ? "☾" : "☀";
}

function formatTime(value) {
  if (!value) return "尚未检查";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

async function saveGmSettings() {
  gmStorage.settings = gmSettings;
  await chrome.storage.local.set({ gmStorage });
}

async function render() {
  const stored = await chrome.storage.local.get(["settings", "gmStorage", "pollState", "lastPollSummary"]);
  settings = mergeDefaults(stored.settings, DEFAULT_SETTINGS);
  gmStorage = stored.gmStorage && typeof stored.gmStorage === "object" ? stored.gmStorage : {};
  gmSettings = gmStorage.settings && typeof gmStorage.settings === "object" ? gmStorage.settings : {};
  applyTheme();

  const knownFeatures = [
    ["nested_replies.enabled", true], ["loading_post.enabled", true], ["loading_comment.enabled", true],
    ["link_purifier.enabled", true], ["image_slide.enabled", true], ["quick_comment.enabled", true],
    ["block_posts.enabled", true], ["history.enabled", true], ["lottery_reminder.enabled", true]
  ];
  const enabledCount = knownFeatures.filter(([path, fallback]) => getPath(gmSettings, path, fallback)).length;
  $("#feature-count").textContent = `${enabledCount} 个常用模块已启用`;

  $$(".feature-toggle").forEach(input => {
    const paths = input.dataset.path.split(",");
    const fallback = input.dataset.default === "true";
    input.checked = paths.every(path => getPath(gmSettings, path, fallback));
    input.onchange = async () => {
      paths.forEach(path => setPath(gmSettings, path, input.checked));
      await saveGmSettings();
    };
  });

  $("#notifications-enabled").checked = settings.notifications.enabled;
  $("#notification-state").textContent = settings.notifications.enabled ? "后台监控已开启" : "后台监控已关闭";
  $("#last-poll").textContent = formatTime(stored.lastPollSummary?.at);
  const errors = Object.entries(stored.pollState?.sites || {}).filter(([, state]) => state.error).map(([site, state]) => `${site}: ${state.error}`);
  const errorBox = $("#notification-error");
  errorBox.hidden = errors.length === 0;
  errorBox.textContent = errors.join("；");
}

$("#theme-toggle").addEventListener("click", async () => {
  const order = ["system", "light", "dark"];
  settings.appearance.theme = order[(order.indexOf(settings.appearance.theme) + 1) % order.length];
  await chrome.storage.local.set({ settings });
  applyTheme();
});
$("#notifications-enabled").addEventListener("change", async event => {
  settings.notifications.enabled = event.target.checked;
  await chrome.storage.local.set({ settings });
  await chrome.runtime.sendMessage({ type: "reconfigureAlarm" });
  render();
});
$("#open-nodeseek").addEventListener("click", () => chrome.tabs.create({ url: "https://www.nodeseek.com/" }));
$("#open-deepflood").addEventListener("click", () => chrome.tabs.create({ url: "https://www.deepflood.com/" }));

async function openOptions(panel) {
  await chrome.storage.session.set({ requestedOptionsPanel: panel });
  await chrome.runtime.openOptionsPage();
}

$("#options").addEventListener("click", () => openOptions("labels"));
$("#notification-settings").addEventListener("click", () => openOptions("monitor"));

render();

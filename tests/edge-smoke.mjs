import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const extensionDir = path.join(root, "extension");
const profileDir = path.join(root, `.edge-smoke-${Date.now()}`);
const browserExecutable = process.env.BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const headed = process.env.BROWSER_HEADLESS !== "1";
const screenshotPrefix = process.env.SCREENSHOT_PREFIX || "edge";

async function getFreePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const port = await getFreePort();

await mkdir(profileDir, { recursive: true });

const fixtureHead = `<!doctype html><html><head><meta charset="utf-8"><title>NodeSeek Fixture</title>
<script>window.__config__={user:{member_id:42,member_name:"fixture-user",rank:2,nComment:3,unViewedCount:{atMe:0,message:0,reply:0}}};</script>
<style>.post-list-item{position:relative;display:flex;min-height:69px}.post-list-content{margin-left:10px}.post-info{display:block}.post-category{position:absolute;right:13px;bottom:8px;margin-right:4px}</style>
</head><body>`;
const listFixture = `${fixtureHead}
<header id="nsk-head"><strong><a href="/">NodeSeek</a></strong><div class="color-theme-switcher"></div><div class="search-box"></div></header>
<main><ul class="post-list"><li class="post-list-item"><div class="post-list-content"><div class="post-title"><a href="/post-123-1">抽奖测试主题</a></div><div class="post-meta-row"><div class="post-info"><a href="/space/7">fixture-author</a><span>17 回复</span><a class="post-category" href="/categories/daily">日常</a></div></div></div></li><li class="post-list-item"><div class="post-list-content"><div class="post-title"><a href="/post-124-1">普通测试主题</a></div><div class="post-meta-row"><div class="post-info"><a href="/space/8">other-author</a><a class="post-category" href="/categories/tech">技术</a></div></div></div></li></ul></main>
</body></html>`;
const postFixture = `${fixtureHead}
<header id="nsk-head"><strong><a href="/">NodeSeek</a></strong><div class="color-theme-switcher"></div><div class="search-box"></div></header>
<main><article class="nsk-post"><div class="post-title"><h1><a class="post-title-link" href="/post-123-1">抽奖测试主题</a></h1></div><div id="0" class="content-item"><div class="nsk-content-meta-info"><span class="avatar-wrapper"></span><span class="author-info"><a href="/space/7">fixture-author</a></span><span class="floor-link-wrapper"></span></div><div class="post-content">评论参加抽奖，稍后开奖。</div></div></article><div class="comments"><article id="3" class="content-item comment-item"><div class="author-info"><a href="/space/42">fixture-user</a><time datetime="2020-01-01T00:00:00.000Z">很久前</time></div><div class="post-content">这是刷新前已经存在的旧评论</div></article><article id="21" class="content-item comment-item"><div class="author-info"><a href="/space/42">fixture-user</a><time datetime="2020-01-02T00:00:00.000Z">很久前</time></div><div class="post-content">这是另一个回复楼层</div></article></div></main>
<div id="fast-nav-button-group"><button id="back-to-parent" type="button">返回</button></div>
<div class="md-editor"><div class="mde-toolbar"><span class="toolbar-item">B</span></div><textarea></textarea><button class="submit btn" type="button">发布</button></div>
</body></html>`;
const fixtureServer = createServer((request, response) => {
  if (request.url?.startsWith("/api/account/getInfo/7")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ success: true, detail: {
      created_at: "2025-01-02T00:00:00.000Z", coin: 625, nPost: 12, nComment: 34,
      stardust: 56, role_name: "成员"
    } }));
    return;
  }
  if (request.url?.startsWith("/api/content/list-comments?uid=42")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ success: true, comments: [
      { post_id: 123, floor_id: 21 },
      { post_id: 123, floor_id: 3 }
    ] }));
    return;
  }
  if (request.url?.startsWith("/api/")) {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ success: false, message: "fixture" }));
    return;
  }
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(request.url?.startsWith("/post-") ? postFixture : listFixture);
});
await new Promise(resolve => fixtureServer.listen(0, "127.0.0.1", resolve));
const fixturePort = fixtureServer.address().port;
const fixtureUrl = `http://www.nodeseek.com:${fixturePort}/`;

const browser = spawn(browserExecutable, [
  ...(headed ? ["--window-position=-32000,-32000", "--window-size=1180,820"] : ["--headless=new"]),
  "--disable-gpu",
  "--disable-gpu-sandbox",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--no-first-run",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  `--disable-extensions-except=${extensionDir}`,
  `--load-extension=${extensionDir}`,
  "--no-proxy-server",
  "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable",
  "--host-resolver-rules=MAP www.nodeseek.com 127.0.0.1",
  fixtureUrl
], { stdio: "ignore", windowsHide: true });
let browserExit;
browser.once("exit", (code, signal) => {
  browserExit = { code, signal };
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function getJson(pathname, options) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, options);
  if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
  return response.json();
}

async function waitForTargets() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await getJson("/json/list");
      if (targets.length) return targets;
    } catch {
      // Edge may still be starting.
    }
    await delay(200);
  }
  throw new Error("Edge CDP endpoint did not start");
}

async function waitForExtensionWorker() {
  let lastTargets = [];
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const targets = await getJson("/json/list").catch(() => []);
    lastTargets = targets;
    const worker = targets.find(target => target.type === "service_worker" && target.url.endsWith("/background/service-worker.js"));
    if (worker) return worker;
    await delay(250);
  }
  const targetSummary = lastTargets.map(target => ({ type: target.type, url: target.url, title: target.title }));
  throw new Error(`Extension service worker was not loaded; browserExit=${JSON.stringify(browserExit)} targets=${JSON.stringify(targetSummary)}`);
}

function cdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  let id = 0;
  const waiting = new Map();
  const events = [];
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = waiting.get(message.id);
      if (!entry) return;
      waiting.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message));
      else entry.resolve(message.result);
      return;
    }
    events.push(message);
  });
  return {
    events,
    async send(method, params = {}) {
      await opened;
      const requestId = ++id;
      const result = new Promise((resolve, reject) => waiting.set(requestId, { resolve, reject }));
      socket.send(JSON.stringify({ id: requestId, method, params }));
      return result;
    },
    close() { socket.close(); }
  };
}

async function inspectPage(url, expression, screenshotName, viewport) {
  const target = await getJson(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  const client = cdp(target.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await client.send("Page.enable");
  if (viewport) {
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: false
    });
  }
  await delay(1300);
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  const errors = client.events.filter(event => {
    return event.method === "Runtime.exceptionThrown"
      || (event.method === "Log.entryAdded" && ["error", "warning"].includes(event.params?.entry?.level));
  });
  let screenshotPath = "";
  if (screenshotName) {
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    screenshotPath = path.join(root, ".cache", screenshotName);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));
  }
  client.close();
  return { value: result.result.value, errors, screenshotPath };
}

async function inspectTarget(target, expression) {
  const client = cdp(target.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Log.enable");
  await delay(2200);
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  const errors = client.events.filter(event => {
    return event.method === "Runtime.exceptionThrown"
      || (event.method === "Log.entryAdded" && event.params?.entry?.level === "error");
  });
  client.close();
  return { value: result.result.value, errors };
}

try {
  await waitForTargets();
  const worker = await waitForExtensionWorker();
  const extensionId = new URL(worker.url).hostname;
  const workerState = await inspectTarget(worker, `Promise.all([
    chrome.storage.local.get("settings"),
    chrome.declarativeNetRequest.getDynamicRules()
  ]).then(([data, rules]) => ({
    name: chrome.runtime.getManifest().name,
    version: chrome.runtime.getManifest().version,
    hasSettings: Boolean(data.settings),
    nodeImageOriginRule: rules.some(rule => rule.id === 9101 && rule.action?.requestHeaders?.some(header => header.header === "origin" && header.operation === "remove"))
  }))`);

  const nodeImageProbe = process.env.NODEIMAGE_NETWORK_TEST === "1"
    ? await inspectTarget(await waitForExtensionWorker(), `(async () => {
        const form = new FormData();
        form.append("image", new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: "image/png" }), "probe.png");
        const response = await fetch("https://api.nodeimage.com/api/upload", {
          method: "POST",
          headers: { "X-API-Key": "invalid-test-key" },
          body: form
        });
        return { status: response.status, body: await response.text() };
      })()`)
    : null;

  const routeWorker = await waitForExtensionWorker();
  const routeSetup = await inspectTarget(routeWorker, `Promise.all([
    chrome.storage.session.set({ requestedOptionsPanel: "monitor" }),
    chrome.storage.local.set({ settings: { notifications: { channels: {
      telegram: { botToken: {}, chatId: { stale: true } },
      email: { apiKey: [] },
      dingtalk: { webhook: { value: "" } },
      bark: { enabled: true, key: "legacy" },
      discord: { enabled: true, webhook: "https://discord.com/legacy" }
    } } } }),
    chrome.storage.local.set({ gmStorage: {
      settings: { image_upload: {
        enabled: true,
        api_key: "",
        active: "LskyPro",
        url: "https://legacy.invalid",
        token: "legacy-token",
        headers: "{}"
      } },
      lottery_reminders: [
        { postUrl: "https://www.nodeseek.com/post-701-1", title: "点赞误记录", drawTime: Date.now() + 60000 },
        { postUrl: "https://www.nodeseek.com/post-702-1", title: "评论抽奖", drawTime: Date.now() + 60000 }
      ],
      lottery_participation_history: {
        lastKnownUserId: "42",
        users: { "42": { records: {
          "701": { postId: "701", title: "点赞误记录", status: "joined", evidence: ["like"] },
          "702": { postId: "702", title: "评论抽奖", status: "joined", evidence: ["comment"] }
        } } }
      }
    } })
  ]).then(() => true)`);
  const routedOptions = await inspectPage(`chrome-extension://${extensionId}/options/options.html`, `new Promise(resolve => setTimeout(() => resolve({
    activePanel: document.querySelector(".panel.active")?.dataset.panel,
    heading: document.querySelector("h1")?.textContent
  }), 300))`);

  const optionsLight = await inspectPage(`chrome-extension://${extensionId}/options/options.html`, `new Promise(resolve => setTimeout(async () => {
    const defaultPanel = document.querySelector(".panel.active")?.dataset.panel;
    const advancedFields = document.querySelectorAll("[data-gm-path]").length;
    const categoryCount = document.querySelectorAll(".nav-item").length;
    const userLabelSwitches = document.querySelectorAll('#user-label-options [data-gm-path^="inline_user_info.labels."]').length;
    const toastElement = document.querySelector("#toast");
    const initialSaveToastVisible = toastElement?.classList.contains("show") || false;
    const commentsLabel = document.querySelector('[data-gm-path="inline_user_info.labels.comments"]');
    if (commentsLabel) {
      commentsLabel.checked = true;
      commentsLabel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    document.querySelector('[data-theme-value="light"]')?.click();
    await new Promise(done => setTimeout(done, 450));
    const toastRect = toastElement?.getBoundingClientRect();
    const topbarRect = document.querySelector(".topbar")?.getBoundingClientRect();
    const saveToastAfterChange = {
      visible: toastElement?.classList.contains("show") || false,
      text: toastElement?.textContent || "",
      belowTopbar: Boolean(toastRect && topbarRect && toastRect.top >= topbarRect.bottom + 12),
      nearRight: Boolean(toastRect && innerWidth - toastRect.right < 40)
    };
    await new Promise(done => setTimeout(done, 2500));
    const saveToastDismissed = !toastElement?.classList.contains("show");
    const nodeImageInput = document.querySelector("#nodeimage-api-key");
    if (nodeImageInput) nodeImageInput.value = "smoke-nodeimage-key";
    document.querySelector("#save-nodeimage-key")?.click();
    await new Promise(done => setTimeout(done, 400));
    const { gmStorage = {} } = await chrome.storage.local.get("gmStorage");
    const imageUpload = gmStorage.settings?.image_upload || {};
    document.querySelector("#clear-nodeimage-key")?.click();
    await new Promise(done => setTimeout(done, 300));
    const clearedStorage = await chrome.storage.local.get("gmStorage");
    const clearedImageUpload = clearedStorage.gmStorage?.settings?.image_upload || {};
    const repairedSettings = await chrome.storage.local.get("settings");
    const repairedChannels = repairedSettings.settings?.notifications?.channels || {};
    const [forumTab] = await chrome.tabs.query({ url: "http://www.nodeseek.com:*/*" });
    let forumBackupRoundTrip = false;
    if (forumTab) {
      const marker = [{ postId: "123", title: "smoke-backup", time: new Date().toISOString(), uid: "7", author: "fixture-author" }];
      const recentMarker = [{ postId: "124", title: "smoke-recent", time: new Date().toISOString(), uid: "8", author: "recent-author" }];
      const applied = await chrome.tabs.sendMessage(forumTab.id, {
        type: "forumBackupApply",
        payload: { schemaVersion: 2, localStorage: { nsx_browsing_history: marker, nsx_recently_closed: recentMarker }, indexedDB: {} }
      });
      const collected = await chrome.tabs.sendMessage(forumTab.id, { type: "forumBackupCollect" });
      forumBackupRoundTrip = applied?.ok === true
        && collected?.ok === true
        && collected.data?.localStorage?.nsx_browsing_history?.[0]?.title === "smoke-backup"
        && collected.data?.localStorage?.nsx_recently_closed?.[0]?.title === "smoke-recent";
    }
    const deepFloodTabsBefore = (await chrome.tabs.query({ url: ["*://deepflood.com/*", "*://www.deepflood.com/*"] })).length;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    document.querySelector("#export-settings")?.click();
    await new Promise(done => setTimeout(done, 700));
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    const deepFloodTabsAfter = (await chrome.tabs.query({ url: ["*://deepflood.com/*", "*://www.deepflood.com/*"] })).length;
    const backupAvoidsDeepFloodTab = deepFloodTabsAfter === deepFloodTabsBefore;
    document.querySelector('[data-tab="content"]')?.click();
    const contentManagement = {
      keywordEditor: Boolean(document.querySelector("#edit-keyword-rules")),
      userEditor: Boolean(document.querySelector("#edit-user-rules")),
      groupButtons: document.querySelectorAll("[data-add-rule-group]").length,
      removedLowLevelSetting: !document.body.textContent.includes("低等级内容屏蔽"),
      siteSwitchRemoved: !document.querySelector('[data-panel="content"] [data-forum-site-tabs]')
    };
    document.querySelector('[data-add-rule-group="keywords"]')?.click();
    const keywordGroupName = document.querySelector("#rule-group-name");
    if (keywordGroupName) keywordGroupName.value = "测试关键词";
    document.querySelector("#management-dialog-save")?.click();
    await new Promise(done => setTimeout(done, 650));
    const dialogElement = document.querySelector("#management-dialog");
    const ruleValue = document.querySelector("#rule-editor-list .rule-value");
    if (ruleValue) ruleValue.value = "smoke-keyword";
    const selectedGroup = document.querySelector("#rule-editor-list .rule-group")?.value || "";
    const managementDialog = {
      open: dialogElement?.open || false,
      withinViewport: Boolean(dialogElement && dialogElement.getBoundingClientRect().right <= innerWidth),
      ruleEditorOpened: Boolean(ruleValue),
      groupPreselected: Boolean(selectedGroup)
    };
    document.querySelector("#management-dialog-save")?.click();
    await new Promise(done => setTimeout(done, 550));
    const keywordRuleSaved = document.querySelector("#keyword-rule-summary")?.textContent?.includes("1 个关键词") || false;
    document.querySelector('[data-tab="quick"]')?.click();
    document.querySelector("#add-phrase-group")?.click();
    const groupNameInput = document.querySelector("#phrase-group-name");
    if (groupNameInput) groupNameInput.value = "测试";
    document.querySelector("#management-dialog-save")?.click();
    await new Promise(done => setTimeout(done, 400));
    document.querySelector('[data-add-phrase="测试"]')?.click();
    const phraseOnlyBody = Boolean(document.querySelector("#phrase-content")) && !document.querySelector("#phrase-title");
    document.querySelector("#management-dialog-close")?.click();
    const quickPhraseManagement = {
      quickCommentToggle: Boolean(document.querySelector("#quick-comment-enabled")),
      enabledToggle: Boolean(document.querySelector("#quick-phrases-enabled")),
      autoSubmit: Boolean(document.querySelector("#quick-auto-submit")),
      addGroup: Boolean(document.querySelector("#add-phrase-group")),
      phraseOnlyBody,
      siteSwitchRemoved: !document.querySelector('[data-panel="quick"] [data-forum-site-tabs]')
    };
    document.querySelector('[data-tab="channels"]')?.click();
    const sharedTemplates = document.querySelectorAll('.notification-template textarea[data-path^="notifications.templates."]');
    const forumTemplate = document.querySelector('[data-path="notifications.templates.forum"]');
    const lotteryTemplate = document.querySelector('[data-path="notifications.templates.lottery"]');
    if (forumTemplate && lotteryTemplate) {
      forumTemplate.value = "[{site}] {type}\\n{actor}: {summary}\\n{url}";
      forumTemplate.dispatchEvent(new Event("change", { bubbles: true }));
      lotteryTemplate.value = "{subject}\\n开奖：{summary}\\n{url}";
      lotteryTemplate.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await new Promise(done => setTimeout(done, 400));
    const templateStorage = await chrome.storage.local.get("settings");
    const channelTemplateManagement = {
      fields: sharedTemplates.length,
      perChannelFieldsRemoved: !document.querySelector('.channel [data-path$=".messageTemplate"]'),
      variables: [...document.querySelectorAll(".template-variable-list > div")].map(row => row.textContent.trim()),
      saved: templateStorage.settings?.notifications?.templates?.forum === "[{site}] {type}\\n{actor}: {summary}\\n{url}"
        && templateStorage.settings?.notifications?.templates?.lottery === "{subject}\\n开奖：{summary}\\n{url}"
    };
    document.querySelector('[data-tab="lottery"]')?.click();
    const cleanedLotteryStorage = await chrome.storage.local.get("gmStorage");
    const lotteryRecords = {
      trackedUiRemoved: !document.body.textContent.includes("已跟踪") && !document.querySelector("#lottery-tracked-count"),
      visibleTitles: [...document.querySelectorAll("#lottery-record-list .lottery-record-title strong")].map(node => node.textContent),
      storedPostIds: Object.keys(cleanedLotteryStorage.gmStorage?.lottery_participation_history?.users?.["42"]?.records || {}),
      reminderPostIds: (cleanedLotteryStorage.gmStorage?.lottery_reminders || []).map(item => item.postUrl?.match(/post-(\\d+)/)?.[1])
    };
    window.confirm = () => true;
    document.querySelector("#clear-lottery-records")?.click();
    await new Promise(done => setTimeout(done, 400));
    const clearedLotteryStorage = await chrome.storage.local.get("gmStorage");
    const lotteryCleared = !clearedLotteryStorage.gmStorage?.lottery_reminders
      && !clearedLotteryStorage.gmStorage?.lottery_participation_history
      && Number(clearedLotteryStorage.gmStorage?.lottery_participation_cleared_at) > 0;
    document.querySelector('[data-tab="footprint"]')?.click();
    document.querySelector("#refresh-footprint-history")?.click();
    await new Promise(done => setTimeout(done, 700));
    const footprint = {
      panels: document.querySelectorAll(".footprint-panel").length,
      searches: document.querySelectorAll(".footprint-search input").length,
      historyGroups: document.querySelectorAll("#footprint-history-list .footprint-day").length,
      recentGroups: document.querySelectorAll("#footprint-recent-list .footprint-day").length,
      tabsRemoved: !document.querySelector("[data-footprint-tab]"),
      legacyColumnsRemoved: !document.querySelector(".footprint-columns")
    };
    resolve({
    title: document.title,
    heading: document.querySelector("h1")?.textContent,
    saveIndicatorRemoved: document.querySelector("#save-status") == null,
    initialSaveToastVisible,
    saveToastAfterChange,
    saveToastDismissed,
    channels: document.querySelectorAll(".channel").length,
    channelOrder: [...document.querySelectorAll(".channel h3")].map(element => element.textContent),
    legacyChannelsRemoved: !("bark" in repairedChannels) && !("discord" in repairedChannels),
    sidebarIcons: document.querySelectorAll(".nav-icon").length,
    aboutCardPresent: document.querySelectorAll('[data-panel="about"] .about-card').length === 1,
    extensionVersion: document.querySelector("#extension-version")?.textContent,
    nodeImageField: Boolean(nodeImageInput),
    nodeImageKeySaved: imageUpload.api_key === "smoke-nodeimage-key",
    nodeImageKeyCleared: clearedImageUpload.api_key === "" && clearedImageUpload.api_key_cleared === true,
    emptyChannelFields: document.querySelectorAll('.channel input:not([type="checkbox"])').length > 0
      && [...document.querySelectorAll('.channel input:not([type="checkbox"])')].every(input => input.value !== "[object Object]")
      && repairedChannels.telegram?.botToken === ""
      && repairedChannels.telegram?.chatId === ""
      && repairedChannels.email?.apiKey === ""
      && repairedChannels.dingtalk?.webhook === "",
    legacyImageHostKeys: ["active", "url", "token", "headers"].filter(key => key in imageUpload),
    defaultPanel,
    categoryCount,
    userLabelSwitches,
    advancedFields,
    retrySigninButtons: document.querySelectorAll(".retry-signin").length,
    notificationDataInMonitor: Boolean(document.querySelector('[data-panel="monitor"] #reset-baseline') && document.querySelector('[data-panel="monitor"] #clear-logs')),
    notificationDataOutsideSync: !document.querySelector('[data-panel="sync"] #reset-baseline') && !document.querySelector('[data-panel="sync"] #clear-logs'),
    forumBackupRoundTrip,
    backupAvoidsDeepFloodTab,
    contentManagement,
    managementDialog,
    keywordRuleSaved,
    quickPhraseManagement,
    channelTemplateManagement,
    lotteryRecords,
    lotteryCleared,
    footprint,
    userLabelValueSaved: gmStorage.settings?.inline_user_info?.labels?.comments === true,
    theme: document.documentElement.dataset.theme,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
    });
  }, 300))`, `${screenshotPrefix}-options.png`, { width: 1180, height: 820 });

  const optionsMobile = await inspectPage(`chrome-extension://${extensionId}/options/options.html`, `new Promise(resolve => setTimeout(() => resolve({
    categoryCount: document.querySelectorAll(".nav-item").length,
    labelColumns: getComputedStyle(document.querySelector("#user-label-options")).gridTemplateColumns,
    bodyWidth: document.body.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }), 300))`, `${screenshotPrefix}-options-mobile.png`, { width: 640, height: 900 });

  const aboutLight = await inspectPage(`chrome-extension://${extensionId}/options/options.html`, `new Promise(resolve => setTimeout(() => {
    document.querySelector('[data-tab="about"]')?.click();
    const panel = document.querySelector('[data-panel="about"]');
    resolve({
      activePanel: document.querySelector(".panel.active")?.dataset.panel,
      cards: panel?.querySelectorAll(".about-card").length,
      sections: panel?.querySelectorAll(".about-section").length,
      privacyItems: panel?.querySelectorAll(".about-section:first-of-type li").length,
      logoSource: panel?.querySelector(".about-logo")?.getAttribute("src"),
      logoWidth: panel?.querySelector(".about-logo")?.naturalWidth,
      metaRows: panel?.querySelectorAll(".about-meta > div").length,
      feedbackLinks: [...(panel?.querySelectorAll(".about-feedback .open-site") || [])].map(link => link.dataset.url),
      referenceLinks: [...(panel?.querySelectorAll(".about-references .open-site") || [])].map(link => link.dataset.url),
      version: panel?.querySelector("#extension-version")?.textContent,
      minimumVersion: panel?.querySelector("#minimum-browser-version")?.textContent,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    });
  }, 300))`, `${screenshotPrefix}-options-about.png`, { width: 1180, height: 900 });

  const aboutMobile = await inspectPage(`chrome-extension://${extensionId}/options/options.html`, `new Promise(resolve => setTimeout(() => {
    document.querySelector('[data-tab="about"]')?.click();
    resolve({
      activePanel: document.querySelector(".panel.active")?.dataset.panel,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      logoWidth: document.querySelector('.about-logo')?.getBoundingClientRect().width,
      cardWidth: document.querySelector('.about-card')?.getBoundingClientRect().width
    });
  }, 300))`, `${screenshotPrefix}-options-about-mobile.png`, { width: 640, height: 900 });

  const popupLight = await inspectPage(`chrome-extension://${extensionId}/popup/popup.html`, `new Promise(resolve => setTimeout(() => resolve({
    title: document.title,
    heading: document.querySelector("h1")?.textContent,
    buttons: document.querySelectorAll("footer button").length,
    theme: document.documentElement.dataset.theme,
    width: document.body.scrollWidth
  }), 300))`, `${screenshotPrefix}-popup.png`, { width: 380, height: 620 });

  const optionsDark = await inspectPage(`chrome-extension://${extensionId}/options/options.html`, `new Promise(resolve => setTimeout(async () => {
    document.querySelector('[data-theme-value="dark"]')?.click();
    let savedTheme = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(done => setTimeout(done, 100));
      const stored = await chrome.storage.local.get("settings");
      savedTheme = stored.settings?.appearance?.theme || "";
      if (savedTheme === "dark") break;
    }
    resolve({
      activePanel: document.querySelector(".panel.active")?.dataset.panel,
      theme: document.documentElement.dataset.theme,
      savedTheme
    });
  }, 300))`, `${screenshotPrefix}-options-dark.png`, { width: 1180, height: 820 });

  const aboutDark = await inspectPage(`chrome-extension://${extensionId}/options/options.html`, `new Promise(resolve => setTimeout(() => {
    document.querySelector('[data-tab="about"]')?.click();
    resolve({
      activePanel: document.querySelector(".panel.active")?.dataset.panel,
      theme: document.documentElement.dataset.theme,
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth
    });
  }, 300))`, `${screenshotPrefix}-options-about-dark.png`, { width: 1180, height: 900 });

  const popupDark = await inspectPage(`chrome-extension://${extensionId}/popup/popup.html`, `new Promise(resolve => setTimeout(() => resolve({
    theme: document.documentElement.dataset.theme,
    primaryHeading: document.querySelector(".primary-section h2")?.textContent,
    secondaryHeading: document.querySelector(".secondary-section h2")?.textContent
  }), 300))`, `${screenshotPrefix}-popup-dark.png`, { width: 380, height: 620 });

  const forumTarget = (await getJson("/json/list")).find(target => target.type === "page" && target.url === fixtureUrl);
  if (!forumTarget) throw new Error("Forum fixture page did not load");
  const forum = await inspectTarget(forumTarget, `({
    title: document.title,
    mobileClass: document.documentElement.classList.contains("nsx-mobile"),
    iconGroup: Boolean(document.querySelector("#nsx-icon-group")),
    baseStyle: Boolean(document.querySelector("#nsx-base")),
    runtimeReady: Boolean(window.__nsxRuntime),
    layuiReady: Boolean(window.layui?.layer),
    gmReady: typeof window.GM_getValue === "function"
  })`);

  const commentFootprintList = await inspectPage(fixtureUrl, `new Promise(resolve => setTimeout(() => {
    const replied = document.querySelector('.post-list-item a[href*="post-123-"]')?.closest('.post-list-item');
    const ordinary = document.querySelector('.post-list-item a[href*="post-124-"]')?.closest('.post-list-item');
    const badge = replied?.querySelector('.nsx-replied-badge');
    const category = replied?.querySelector('.post-category');
    const badgeRect = badge?.getBoundingClientRect();
    const categoryRect = category?.getBoundingClientRect();
    resolve({
      text: badge?.textContent || "",
      title: badge?.title || "",
      href: badge?.getAttribute("href") || "",
      ordinaryMarked: Boolean(ordinary?.querySelector('.nsx-replied-badge')),
      beforeCategory: badge?.nextElementSibling === category,
      groupedAtRight: badge?.parentElement === category?.parentElement,
      anchored: badge ? getComputedStyle(badge).position === 'absolute' : false,
      categoryGap: badgeRect && categoryRect ? Math.round(categoryRect.left - badgeRect.right) : null
    });
  }, 500))`);

  const commentFootprintPost = await inspectPage(`${fixtureUrl}post-123-1`, `new Promise(resolve => setTimeout(async () => {
    const links = [...document.querySelectorAll('.nsx-my-reply-floor')];
    links.find(link => link.textContent === '#3')?.click();
    await new Promise(done => setTimeout(done, 180));
    resolve({
      label: document.querySelector('.nsx-my-replies-label')?.textContent || "",
      floors: links.map(link => link.textContent),
      hrefs: links.map(link => link.getAttribute('href')),
      hash: location.hash,
      highlighted: document.getElementById('3')?.classList.contains('nsx-comment-floor-highlight') || false
    });
  }, 500))`, `${screenshotPrefix}-comment-footprint.png`, { width: 1180, height: 720 });

  const forumLabels = await inspectPage(`${fixtureUrl}post-123-1`, `new Promise(resolve => setTimeout(() => resolve({
    count: document.querySelectorAll(".nsx-user-data-badge").length,
    visible: [...document.querySelectorAll(".nsx-user-data-badge")].map(element => element.className.match(/nsx-user-data-([a-z_]+)/)?.[1]).filter(Boolean),
    texts: [...document.querySelectorAll(".nsx-user-data-badge")].map(element => element.textContent),
    topicHidden: document.querySelector(".nsx-user-data-topics") == null,
    commentVisible: document.querySelector(".nsx-user-data-comments")?.textContent === "评论 34"
  }), 2200))`, `${screenshotPrefix}-forum-labels.png`, { width: 1180, height: 520 });

  const forumQuickPhrases = await inspectPage(`${fixtureUrl}post-123-1`, `new Promise(resolve => setTimeout(() => {
    const button = document.querySelector(".nsx-quick-reply-btn");
    button?.click();
    const emptyText = document.querySelector(".nsx-quick-reply-empty")?.textContent || "";
    localStorage.setItem("nodeseek_quick_reply", JSON.stringify({ 常用: [{ title: "测试", content: "快捷短语内容" }] }));
    document.dispatchEvent(new CustomEvent("NSPRO_FORUM_DATA_CHANGED", { detail: JSON.stringify({ keys: ["nodeseek_quick_reply"] }) }));
    document.querySelector(".nsx-quick-reply-item")?.click();
    resolve({
      button: Boolean(button),
      icon: Boolean(button?.querySelector("svg")),
      emptyText,
      inserted: document.querySelector(".md-editor textarea")?.value === "快捷短语内容"
    });
  }, 2200))`, `${screenshotPrefix}-forum-quick-phrases.png`, { width: 1180, height: 620 });

  const forumKeywordPanel = await inspectPage(fixtureUrl, `new Promise(resolve => setTimeout(() => {
    document.querySelector(".filter-dropdown-on")?.click();
    const panel = document.querySelector("#nsx-filter-panel");
    resolve({
      open: panel?.classList.contains("show") || false,
      addText: panel?.querySelector('[data-a="add"]')?.textContent?.trim() || "",
      searchText: panel?.querySelector(".nsx-rel-search")?.childNodes?.[0]?.textContent?.trim() || "",
      tabs: [...(panel?.querySelectorAll(".nsx-rel-tab") || [])].map(node => node.textContent.trim()),
      decorativeSymbolsRemoved: !/[➕🔍🚫🎨]/u.test(panel?.textContent || "")
    });
  }, 2200))`, `${screenshotPrefix}-forum-keyword-panel.png`, { width: 1180, height: 720 });

  const lotteryRefreshPage = await inspectPage(`${fixtureUrl}post-702-1`, `new Promise(resolve => setTimeout(() => resolve({
    oldCommentVisible: document.querySelector('.comments a[href="/space/42"]')?.textContent === "fixture-user",
    lotteryState: document.querySelector(".nsx-lottery-state-tag")?.dataset.state || ""
  }), 2600))`);
  const lotteryRefreshStorage = await inspectTarget(await waitForExtensionWorker(), `chrome.storage.local.get("gmStorage").then(({ gmStorage = {} }) => ({
    records: gmStorage.lottery_participation_history || null,
    reminders: gmStorage.lottery_reminders || null,
    clearedAt: Number(gmStorage.lottery_participation_cleared_at || 0)
  }))`);

  const lotteryFreshCommentPage = await inspectPage(`${fixtureUrl}post-703-1`, `new Promise(resolve => setTimeout(async () => {
    const comment = document.createElement("article");
    comment.className = "content-item comment-item";
    comment.innerHTML = '<div class="author-info"><a href="/space/42">fixture-user</a><time>刚刚</time></div><div class="post-content">这是清空记录后刚发布的回复</div>';
    document.querySelector(".comments")?.appendChild(comment);
    await new Promise(done => setTimeout(done, 1200));
    resolve({
      lotteryState: document.querySelector(".nsx-lottery-state-tag")?.dataset.state || "",
      stateText: document.querySelector(".nsx-lottery-state-tag")?.textContent || ""
    });
  }, 2200))`);
  const lotteryFreshCommentStorage = await inspectTarget(await waitForExtensionWorker(), `chrome.storage.local.get("gmStorage").then(({ gmStorage = {} }) => ({
    record: gmStorage.lottery_participation_history?.users?.["42"]?.records?.["703"] || null,
    reminder: (gmStorage.lottery_reminders || []).find(item => /post-703-/.test(item.postUrl || "")) || null
  }))`);

  console.log(JSON.stringify({ browser: path.basename(browserExecutable), extensionId, workerState, nodeImageProbe, routeSetup, routedOptions, optionsLight, optionsMobile, aboutLight, aboutMobile, popupLight, optionsDark, aboutDark, popupDark, forum, commentFootprintList, commentFootprintPost, forumLabels, forumQuickPhrases, forumKeywordPanel, lotteryRefreshPage, lotteryRefreshStorage, lotteryFreshCommentPage, lotteryFreshCommentStorage }, null, 2));
  if (routedOptions.value?.activePanel !== "monitor") throw new Error("Options page did not honor the requested notification panel");
  if (optionsLight.value?.defaultPanel !== "labels") throw new Error("User labels are not the default options panel");
  if (optionsLight.value?.categoryCount !== 12 || optionsLight.value?.advancedFields < 45) throw new Error("Categorized upstream settings were not rendered");
  if (optionsLight.value?.userLabelSwitches < 17 || !optionsLight.value?.userLabelValueSaved) throw new Error("Independent user label settings did not persist");
  if (!optionsLight.value?.quickPhraseManagement?.phraseOnlyBody) throw new Error("Quick phrase dialog still exposes a title field");
  if (optionsLight.value?.channelTemplateManagement?.fields !== 2
    || !optionsLight.value?.channelTemplateManagement?.perChannelFieldsRemoved
    || optionsLight.value?.channelTemplateManagement?.variables?.length !== 8
    || !optionsLight.value?.channelTemplateManagement?.variables?.every(value => value.length > 8)
    || !optionsLight.value?.channelTemplateManagement?.saved) {
    throw new Error("Per-channel notification templates are incomplete");
  }
  if (!optionsLight.value?.lotteryRecords?.trackedUiRemoved
    || optionsLight.value?.lotteryRecords?.visibleTitles?.join(",") !== "评论抽奖"
    || optionsLight.value?.lotteryRecords?.storedPostIds?.join(",") !== "702"
    || optionsLight.value?.lotteryRecords?.reminderPostIds?.join(",") !== "702") {
    throw new Error("Lottery storage cleanup did not keep comment-backed records only");
  }
  if (optionsLight.value?.footprint?.panels !== 2
    || optionsLight.value?.footprint?.searches !== 2
    || optionsLight.value?.footprint?.historyGroups < 1
    || optionsLight.value?.footprint?.recentGroups < 1
    || !optionsLight.value?.footprint?.tabsRemoved
    || !optionsLight.value?.footprint?.legacyColumnsRemoved) {
    throw new Error("Options history and recently closed panels are not separated");
  }
  if (commentFootprintList.value?.text !== "已回复"
    || !commentFootprintList.value?.title.includes("#3")
    || !commentFootprintList.value?.title.includes("#21")
    || commentFootprintList.value?.href !== "/post-123-3#21"
    || commentFootprintList.value?.ordinaryMarked
    || !commentFootprintList.value?.beforeCategory
    || !commentFootprintList.value?.groupedAtRight
    || !commentFootprintList.value?.anchored
    || commentFootprintList.value?.categoryGap !== 8) {
    throw new Error(`Comment footprint list marker is incomplete: ${JSON.stringify(commentFootprintList.value)}`);
  }
  if (commentFootprintPost.value?.label !== "我的回复"
    || commentFootprintPost.value?.floors?.join(",") !== "#3,#21"
    || commentFootprintPost.value?.hrefs?.join(",") !== "/post-123-1#3,/post-123-3#21"
    || commentFootprintPost.value?.hash !== "#3"
    || !commentFootprintPost.value?.highlighted) {
    throw new Error(`Comment footprint floor navigation is incomplete: ${JSON.stringify(commentFootprintPost.value)}`);
  }
  if (!optionsLight.value?.lotteryCleared
    || !lotteryRefreshPage.value?.oldCommentVisible
    || lotteryRefreshStorage.value?.records
    || lotteryRefreshStorage.value?.reminders
    || !lotteryRefreshStorage.value?.clearedAt) {
    throw new Error("Cleared lottery records were restored from an old comment after refresh");
  }
  if (lotteryFreshCommentPage.value?.lotteryState !== "joined"
    || !lotteryFreshCommentPage.value?.stateText?.includes("已参加")
    || lotteryFreshCommentStorage.value?.record?.source !== "comment-after-clear"
    || !lotteryFreshCommentStorage.value?.record?.evidence?.includes("comment")
    || !lotteryFreshCommentStorage.value?.reminder) {
    throw new Error(`Fresh current-user comment was not recorded as lottery participation: ${JSON.stringify({ page: lotteryFreshCommentPage.value, storage: lotteryFreshCommentStorage.value })}`);
  }
  if (!optionsLight.value?.saveIndicatorRemoved || optionsLight.value?.initialSaveToastVisible) throw new Error("Save notification is visible before any setting changes");
  if (!optionsLight.value?.saveToastAfterChange?.visible || optionsLight.value?.saveToastAfterChange?.text !== "设置已保存" || !optionsLight.value?.saveToastAfterChange?.belowTopbar || !optionsLight.value?.saveToastAfterChange?.nearRight) {
    throw new Error("Automatic save did not show a toast below the top bar");
  }
  if (!optionsLight.value?.saveToastDismissed) throw new Error("Automatic save toast did not dismiss itself");
  if (optionsLight.value?.retrySigninButtons !== 2) throw new Error("Manual sign-in retry actions were not rendered");
  if (!optionsLight.value?.notificationDataInMonitor || !optionsLight.value?.notificationDataOutsideSync) throw new Error("Notification data actions are in the wrong panel");
  if (!optionsLight.value?.forumBackupRoundTrip) throw new Error("Forum backup bridge did not round-trip local data");
  if (!optionsLight.value?.backupAvoidsDeepFloodTab) throw new Error("Backup opened a DeepFlood tab");
  if (!optionsLight.value?.contentManagement?.keywordEditor || !optionsLight.value?.contentManagement?.userEditor || optionsLight.value?.contentManagement?.groupButtons !== 2 || !optionsLight.value?.contentManagement?.removedLowLevelSetting || !optionsLight.value?.contentManagement?.siteSwitchRemoved) {
    throw new Error("Content management editors are incomplete");
  }
  if (!optionsLight.value?.managementDialog?.open
    || !optionsLight.value?.managementDialog?.withinViewport
    || !optionsLight.value?.managementDialog?.ruleEditorOpened
    || !optionsLight.value?.managementDialog?.groupPreselected
    || !optionsLight.value?.keywordRuleSaved) {
    throw new Error("Content management rules cannot be added to a group");
  }
  if (!optionsLight.value?.quickPhraseManagement?.quickCommentToggle || !optionsLight.value?.quickPhraseManagement?.enabledToggle || !optionsLight.value?.quickPhraseManagement?.autoSubmit || !optionsLight.value?.quickPhraseManagement?.addGroup || !optionsLight.value?.quickPhraseManagement?.siteSwitchRemoved) {
    throw new Error("Quick phrase management is incomplete");
  }
  if (optionsMobile.value?.categoryCount !== 12 || optionsMobile.value?.bodyWidth > optionsMobile.value?.viewportWidth) throw new Error("Categorized settings overflow on mobile");
  if (aboutLight.value?.activePanel !== "about" || aboutLight.value?.cards !== 1 || aboutLight.value?.sections !== 2 || aboutLight.value?.privacyItems < 6 || aboutLight.value?.metaRows !== 4) {
    throw new Error("Detailed about page content is incomplete");
  }
  if (JSON.stringify(aboutLight.value?.feedbackLinks) !== JSON.stringify([
    "https://www.nodeseek.com/notification#/message?mode=talk&to=16143",
    "https://github.com/qh1314520/NodeSeek-Expansion-Tool"
  ])) throw new Error("About page feedback links are incorrect");
  if (JSON.stringify(aboutLight.value?.referenceLinks) !== JSON.stringify([
    "https://github.com/EISEN0516/nodeseek-pro-userscript",
    "https://greasyfork.org/zh-CN/scripts/567109-nodeseek-pro",
    "https://chromewebstore.google.com/detail/nodeseek-helper/fljjlmmflicoocnceopdeeibflcohenp"
  ])) throw new Error("About page reference project links are incorrect");
  if (aboutLight.value?.logoSource !== "../icons/icon128.png" || aboutLight.value?.logoWidth !== 128) throw new Error("About page did not render the replacement logo");
  if (aboutLight.value?.version !== workerState.value?.version || aboutLight.value?.minimumVersion !== "111") throw new Error("About page version information is incorrect");
  if (aboutLight.value?.bodyWidth > aboutLight.value?.viewportWidth || aboutMobile.value?.bodyWidth > aboutMobile.value?.viewportWidth || aboutDark.value?.bodyWidth > aboutDark.value?.viewportWidth) {
    throw new Error("Detailed about page overflows its viewport");
  }
  if (aboutMobile.value?.activePanel !== "about" || aboutDark.value?.activePanel !== "about" || aboutDark.value?.theme !== "dark") throw new Error("About page theme or routing is incorrect");
  if (optionsLight.value?.channels !== 6) throw new Error("Options page did not render all six channels");
  if (JSON.stringify(optionsLight.value?.channelOrder) !== JSON.stringify(["Telegram Bot", "邮件", "微信推送", "企业微信", "钉钉", "飞书"])) throw new Error("Notification channel order is incorrect");
  if (!optionsLight.value?.legacyChannelsRemoved) throw new Error("Removed Bark or Discord settings survived migration");
  if (optionsLight.value?.sidebarIcons !== 0) throw new Error("Sidebar icons were not removed");
  if (!optionsLight.value?.aboutCardPresent || optionsLight.value?.extensionVersion !== workerState.value?.version) throw new Error("About page information is incomplete");
  if (!optionsLight.value?.nodeImageField || !optionsLight.value?.nodeImageKeySaved) throw new Error("NodeImage API Key settings did not save");
  if (!optionsLight.value?.nodeImageKeyCleared) throw new Error("NodeImage API Key clear state did not persist");
  if (!optionsLight.value?.emptyChannelFields) throw new Error("Empty notification channel fields rendered object values");
  if (optionsLight.value?.legacyImageHostKeys?.length) throw new Error("Legacy image host settings were not removed");
  if (optionsLight.value?.theme !== "light" || popupLight.value?.theme !== "light") throw new Error("Light theme did not propagate to extension pages");
  if (optionsDark.value?.theme !== "dark" || optionsDark.value?.savedTheme !== "dark" || popupDark.value?.theme !== "dark") {
    throw new Error("Dark theme did not propagate to extension pages");
  }
  if (popupDark.value?.primaryHeading !== "网页增强" || popupDark.value?.secondaryHeading !== "信息通知") throw new Error("Popup feature hierarchy is incorrect");
  if (!workerState.value?.hasSettings) throw new Error("Extension service worker did not initialize settings");
  if (!workerState.value?.nodeImageOriginRule) throw new Error("NodeImage Origin removal rule was not installed");
  if (nodeImageProbe && (nodeImageProbe.value?.status !== 401 || !nodeImageProbe.value?.body?.includes("Invalid API key"))) {
    throw new Error("NodeImage Origin removal probe did not reach the API correctly");
  }
  if (!forum.value?.iconGroup || !forum.value?.baseStyle || !forum.value?.layuiReady || !forum.value?.gmReady) {
    throw new Error("Forum enhancement content scripts did not initialize");
  }
  if (forumLabels.value?.count < 8 || !forumLabels.value?.topicHidden || !forumLabels.value?.commentVisible) {
    throw new Error(`Forum user labels did not honor independent switches: ${JSON.stringify(forumLabels.value)}`);
  }
  if (!forumQuickPhrases.value?.button || !forumQuickPhrases.value?.icon || forumQuickPhrases.value?.emptyText !== "暂无快捷短语" || !forumQuickPhrases.value?.inserted) {
    throw new Error(`Forum quick phrases did not work: ${JSON.stringify(forumQuickPhrases.value)}`);
  }
  if (!forumKeywordPanel.value?.open
    || forumKeywordPanel.value?.addText !== "新增"
    || forumKeywordPanel.value?.tabs?.join(",") !== "屏蔽,高亮"
    || !forumKeywordPanel.value?.decorativeSymbolsRemoved) {
    throw new Error(`Forum keyword panel still contains decorative icons: ${JSON.stringify(forumKeywordPanel.value)}`);
  }
  if (workerState.errors.length || nodeImageProbe?.errors?.length || routeSetup.errors.length || routedOptions.errors.length || optionsLight.errors.length || optionsMobile.errors.length || aboutLight.errors.length || aboutMobile.errors.length || popupLight.errors.length || optionsDark.errors.length || aboutDark.errors.length || popupDark.errors.length || forum.errors.length || commentFootprintList.errors.length || commentFootprintPost.errors.length || forumLabels.errors.length || forumQuickPhrases.errors.length || forumKeywordPanel.errors.length || lotteryRefreshPage.errors.length || lotteryRefreshStorage.errors.length || lotteryFreshCommentPage.errors.length || lotteryFreshCommentStorage.errors.length) {
    throw new Error("Extension pages emitted console errors");
  }
} finally {
  try {
    const version = await getJson("/json/version");
    const client = cdp(version.webSocketDebuggerUrl);
    await client.send("Browser.close");
    await delay(500);
  } catch {
    browser.kill();
  }
  fixtureServer.close();
}

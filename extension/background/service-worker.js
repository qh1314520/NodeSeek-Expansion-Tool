import { DEFAULT_SETTINGS, mergeDefaults } from "../shared/config.js";
import { pollForums } from "./poller.js";
import { sendChannel, sendEnabledChannels } from "./channels.js";

const ALARM_NAME = "forum-notification-poll";
const NODEIMAGE_ORIGIN_RULE_ID = 9101;
const BRIDGE_XHR_HOSTS = new Set([
  "nodeseek.com",
  "www.nodeseek.com",
  "deepflood.com",
  "www.deepflood.com",
  "api.drand.sh",
  "api.nodeimage.com",
  "api.telegram.org",
  "api.resend.com",
  "api.sendgrid.com",
  "api.mailgun.net",
  "api.emailjs.com",
  "www.pushplus.plus",
  "sc.ftqq.com",
  "sctapi.ftqq.com",
  "oapi.dingtalk.com",
  "open.feishu.cn",
  "qyapi.weixin.qq.com"
]);
let gmStorageQueue = Promise.resolve();

async function configureNodeImageOriginRule() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [NODEIMAGE_ORIGIN_RULE_ID],
    addRules: [{
      id: NODEIMAGE_ORIGIN_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "origin", operation: "remove" }]
      },
      condition: {
        urlFilter: "|https://api.nodeimage.com/api/",
        requestDomains: ["api.nodeimage.com"],
        initiatorDomains: [chrome.runtime.id],
        resourceTypes: ["xmlhttprequest", "other"]
      }
    }]
  });
}

async function ensureSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  const merged = mergeDefaults(settings, DEFAULT_SETTINGS);
  await chrome.storage.local.set({ settings: merged });
  return merged;
}

async function configureAlarm() {
  const settings = await ensureSettings();
  const periodInMinutes = Math.max(1, Number(settings.notifications.pollMinutes) || 1);
  await chrome.alarms.clear(ALARM_NAME);
  if (settings.notifications.enabled) {
    await chrome.alarms.create(ALARM_NAME, { delayInMinutes: 0.1, periodInMinutes });
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value || "");
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function deserializeBody(body) {
  if (!body || body.kind === "empty") return undefined;
  if (body.kind === "text") return body.value;
  if (body.kind === "bytes") return base64ToBytes(body.base64);
  if (body.kind === "formData") {
    const form = new FormData();
    for (const entry of body.entries || []) {
      if (entry.value?.kind === "file") {
        const blob = new Blob([base64ToBytes(entry.value.base64)], { type: entry.value.type || "application/octet-stream" });
        form.append(entry.name, blob, entry.value.name || "file");
      } else {
        form.append(entry.name, String(entry.value?.value ?? ""));
      }
    }
    return form;
  }
  return undefined;
}

async function bridgeXhr(options) {
  let requestUrl;
  try {
    requestUrl = new URL(String(options?.url || ""));
  } catch {
    return { ok: false, error: "Invalid request URL" };
  }
  if (requestUrl.protocol !== "https:" || !BRIDGE_XHR_HOSTS.has(requestUrl.hostname)) {
    return { ok: false, error: `Host is not permitted: ${requestUrl.hostname || "unknown"}` };
  }

  const controller = new AbortController();
  const timeoutMs = Math.max(0, Number(options.timeout) || 0);
  const timer = timeoutMs ? setTimeout(() => controller.abort("timeout"), timeoutMs) : null;
  try {
    const response = await fetch(requestUrl.href, {
      method: options.method || "GET",
      headers: options.headers || {},
      body: deserializeBody(options.body),
      credentials: options.anonymous ? "omit" : "include",
      redirect: "follow",
      signal: controller.signal
    });
    const headers = [...response.headers.entries()].map(([key, value]) => `${key}: ${value}`).join("\r\n");
    if (options.responseType === "arraybuffer" || options.responseType === "blob") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        ok: true,
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.url,
        responseHeaders: headers,
        responseType: options.responseType,
        responseBase64: bytesToBase64(bytes),
        responseMime: response.headers.get("content-type") || "application/octet-stream"
      };
    }
    const responseText = await response.text();
    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      responseHeaders: headers,
      responseType: options.responseType || "text",
      responseText
    };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), timedOut: controller.signal.aborted };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await configureNodeImageOriginRule();
  await ensureSettings();
  await configureAlarm();
});

chrome.runtime.onStartup.addListener(configureAlarm);
configureNodeImageOriginRule().catch(console.error);

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) pollForums().catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) configureAlarm().catch(console.error);
});

chrome.notifications.onClicked.addListener(async notificationId => {
  const { notificationLinks = {}, gmNotificationCallbacks = {} } = await chrome.storage.session.get([
    "notificationLinks",
    "gmNotificationCallbacks"
  ]);
  const link = notificationLinks[notificationId];
  if (link?.url) await chrome.tabs.create({ url: link.url });
  const callback = gmNotificationCallbacks[notificationId];
  if (callback?.tabId != null) {
    chrome.tabs.sendMessage(callback.tabId, { type: "gmNotificationClick", callbackId: callback.callbackId }).catch(() => {});
  }
  await chrome.notifications.clear(notificationId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === "pollNow") return pollForums({ force: true });
    if (message?.type === "reconfigureAlarm") return configureAlarm();
    if (message?.type === "testChannel") {
      const settings = await ensureSettings();
      const channel = message.channel;
      const config = settings.notifications.channels[channel];
      await sendChannel(channel, config, {
        subject: "NodeSeek Expansion Tool 测试通知",
        body: "通知渠道配置有效。",
        url: "https://www.nodeseek.com/",
        site: "NodeSeek",
        type: "测试通知",
        actor: "NodeSeek Expansion Tool",
        summary: "通知渠道配置有效。",
        time: new Date().toISOString()
      }, settings.notifications.templates?.forum);
      return { ok: true };
    }
    if (message?.type === "bridge") {
      if (message.action === "xhr") return bridgeXhr(message.payload);
      if (message.action === "storageSet") {
        gmStorageQueue = gmStorageQueue.then(async () => {
          const { gmStorage = {} } = await chrome.storage.local.get("gmStorage");
          gmStorage[message.payload.key] = message.payload.value;
          await chrome.storage.local.set({ gmStorage });
        });
        await gmStorageQueue;
        return { ok: true };
      }
      if (message.action === "storageDelete") {
        gmStorageQueue = gmStorageQueue.then(async () => {
          const { gmStorage = {} } = await chrome.storage.local.get("gmStorage");
          delete gmStorage[message.payload.key];
          await chrome.storage.local.set({ gmStorage });
        });
        await gmStorageQueue;
        return { ok: true };
      }
      if (message.action === "openTab") {
        const tab = await chrome.tabs.create({ url: message.payload.url, active: message.payload.active !== false });
        return { ok: true, tabId: tab.id };
      }
      if (message.action === "openOptions") {
        const panel = String(message.payload?.panel || "lottery");
        await chrome.storage.session.set({ requestedOptionsPanel: panel });
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      }
      if (message.action === "lotteryNotify") {
        const settings = await ensureSettings();
        const lottery = settings.lotteryNotifications || {};
        const eventType = String(message.payload?.eventType || "result");
        const eventEnabled = eventType === "nearDraw" ? lottery.nearDraw !== false : lottery.result !== false;
        if (!lottery.enabled || !eventEnabled) return { ok: true, skipped: true, attempted: 0, succeeded: [], failed: [] };

        const subject = String(message.payload?.subject || "抽奖提醒");
        const body = String(message.payload?.body || "");
        const url = String(message.payload?.url || "");
        const succeeded = [];
        const failed = [];
        if (lottery.browserNotifications !== false) {
          try {
            const id = `lottery:${Date.now()}:${Math.random().toString(36).slice(2)}`;
            await chrome.notifications.create(id, {
              type: "basic",
              iconUrl: chrome.runtime.getURL("icons/icon128.png"),
              title: subject,
              message: body,
              priority: 1
            });
            if (url) {
              const { notificationLinks = {} } = await chrome.storage.session.get("notificationLinks");
              notificationLinks[id] = { url, createdAt: Date.now() };
              await chrome.storage.session.set({ notificationLinks });
            }
            succeeded.push("浏览器通知");
          } catch (error) {
            failed.push({ channel: "浏览器通知", message: String(error?.message || error) });
          }
        }

        if (lottery.pushEnabled !== false) {
          const results = await sendEnabledChannels(settings.notifications.channels, {
            subject,
            body,
            url,
            site: "NodeSeek",
            type: "抽奖提醒",
            actor: "NodeSeek Expansion Tool",
            summary: body,
            time: new Date().toISOString()
          }, null, settings.notifications.templates?.lottery);
          for (const result of results) {
            if (result.ok) succeeded.push(result.label);
            else failed.push({ channel: result.label, message: result.error || "发送失败" });
          }
        }
        const attempted = succeeded.length + failed.length;
        return {
          ok: attempted > 0 && failed.length === 0,
          skipped: attempted === 0,
          attempted,
          succeeded,
          failed
        };
      }
      if (message.action === "notify") {
        const id = `gm:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        await chrome.notifications.create(id, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icons/icon128.png"),
          title: String(message.payload.title || "NodeSeek Expansion Tool"),
          message: String(message.payload.text || ""),
          priority: 1
        });
        if (message.payload.callbackId && sender.tab?.id != null) {
          const { gmNotificationCallbacks = {} } = await chrome.storage.session.get("gmNotificationCallbacks");
          gmNotificationCallbacks[id] = { tabId: sender.tab.id, callbackId: message.payload.callbackId };
          await chrome.storage.session.set({ gmNotificationCallbacks });
        }
        return { ok: true, notificationId: id };
      }
    }
    return { ok: false, error: "Unknown message" };
  })().then(sendResponse).catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

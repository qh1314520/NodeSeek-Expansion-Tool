import { SITES, mergeDefaults, DEFAULT_SETTINGS } from "../shared/config.js";
import {
  formatNotification,
  isQuietTime,
  maxItemId,
  normalizeForumItems,
  selectNewItems
} from "../shared/notifications.js";
import { sendEnabledChannels } from "./channels.js";

const ENDPOINTS = {
  mention: "/api/notification/at-me/list",
  reply: "/api/notification/reply-to-me/list",
  message: "/api/notification/message/list"
};

async function fetchJson(url) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.success === false) throw new Error(payload.message || "论坛接口返回失败");
  return payload;
}

function retryDelay(attempts) {
  return Math.min(30 * 60 * 1000, 60 * 1000 * 2 ** Math.min(Math.max(0, attempts - 1), 8));
}

async function showBrowserNotification(item, message) {
  const id = `forum:${item.key}`;
  await chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: message.subject,
    message: message.body,
    contextMessage: item.siteName,
    priority: 1
  });
  const { notificationLinks = {} } = await chrome.storage.session.get("notificationLinks");
  notificationLinks[id] = { url: message.url, createdAt: Date.now() };
  await chrome.storage.session.set({ notificationLinks });
}

async function deliverItem(item, settings, onlyChannels = null) {
  const message = formatNotification(item);
  if (!onlyChannels && settings.browserNotifications && !isQuietTime(settings.quietHours)) {
    await showBrowserNotification(item, message);
  }
  const results = await sendEnabledChannels(settings.channels, message, onlyChannels, settings.templates?.forum);
  return { message, results };
}

function stateForSite(pollState, siteId) {
  pollState.sites ||= {};
  pollState.sites[siteId] ||= {
    initialized: false,
    lastIds: { mention: 0, reply: 0, message: 0 },
    lastPollAt: 0,
    lastSuccessAt: 0,
    error: ""
  };
  return pollState.sites[siteId];
}

function addLog(logs, entry) {
  logs.unshift({ at: Date.now(), ...entry });
  logs.splice(80);
}

export async function pollForums({ force = false } = {}) {
  const stored = await chrome.storage.local.get(["settings", "pollState", "deliveryLogs", "pendingDeliveries"]);
  const root = mergeDefaults(stored.settings, DEFAULT_SETTINGS);
  const settings = root.notifications;
  const pollState = stored.pollState || { sites: {} };
  const logs = Array.isArray(stored.deliveryLogs) ? stored.deliveryLogs : [];
  const pending = Array.isArray(stored.pendingDeliveries) ? stored.pendingDeliveries : [];
  const summary = { newItems: 0, sites: {}, errors: [] };

  if (!settings.enabled && !force) return summary;

  for (const site of Object.values(SITES)) {
    if (!settings.sites?.[site.id]) continue;
    const siteState = stateForSite(pollState, site.id);
    const enabledTypes = Object.keys(ENDPOINTS).filter(type => settings.types?.[type]);
    try {
      const payloads = await Promise.all(enabledTypes.map(type => fetchJson(site.origin + ENDPOINTS[type])));
      const allItems = {};
      enabledTypes.forEach((type, index) => {
        allItems[type] = normalizeForumItems(type, payloads[index], site, {
          includePreview: settings.includePreview
        });
      });

      if (!siteState.initialized) {
        for (const type of enabledTypes) siteState.lastIds[type] = maxItemId(allItems[type], siteState.lastIds[type]);
        siteState.initialized = true;
        addLog(logs, { siteId: site.id, kind: "baseline", ok: true, message: `${site.name} 已建立通知基线` });
      } else {
        for (const type of enabledTypes) {
          const fresh = selectNewItems(allItems[type], siteState.lastIds[type]);
          for (const item of fresh) {
            const delivery = await deliverItem(item, settings);
            const failedChannels = delivery.results.filter(result => !result.ok).map(result => result.channel);
            if (failedChannels.length) {
              pending.push({ item, channels: failedChannels, attempts: 1, nextAt: Date.now() + retryDelay(1) });
            }
            addLog(logs, {
              siteId: site.id,
              kind: type,
              ok: failedChannels.length === 0,
              message: delivery.message.body,
              url: delivery.message.url,
              failedChannels
            });
            summary.newItems += 1;
          }
          siteState.lastIds[type] = maxItemId(allItems[type], siteState.lastIds[type]);
        }
      }

      siteState.lastPollAt = Date.now();
      siteState.lastSuccessAt = Date.now();
      siteState.error = "";
      summary.sites[site.id] = { ok: true };
    } catch (error) {
      siteState.lastPollAt = Date.now();
      siteState.error = String(error?.message || error);
      summary.sites[site.id] = { ok: false, error: siteState.error };
      summary.errors.push(`${site.name}: ${siteState.error}`);
      addLog(logs, { siteId: site.id, kind: "poll", ok: false, message: siteState.error });
    }
  }

  const now = Date.now();
  for (let index = pending.length - 1; index >= 0; index -= 1) {
    const job = pending[index];
    if (Number(job.nextAt) > now) continue;
    const delivery = await deliverItem(job.item, settings, job.channels);
    const failed = delivery.results.filter(result => !result.ok).map(result => result.channel);
    if (!failed.length) {
      pending.splice(index, 1);
      addLog(logs, { siteId: job.item.siteId, kind: "retry", ok: true, message: delivery.message.body });
    } else {
      job.channels = failed;
      job.attempts = Number(job.attempts || 0) + 1;
      job.nextAt = now + retryDelay(job.attempts);
      if (job.attempts >= 8) {
        pending.splice(index, 1);
        addLog(logs, { siteId: job.item.siteId, kind: "retry", ok: false, message: "通知渠道重试已停止", failedChannels: failed });
      }
    }
  }

  await chrome.storage.local.set({
    settings: root,
    pollState,
    deliveryLogs: logs,
    pendingDeliveries: pending.slice(-100),
    lastPollSummary: { ...summary, at: Date.now() }
  });
  return summary;
}

(() => {
  const REQUEST_EVENT = "NSPRO_BRIDGE_REQUEST";
  const RESPONSE_EVENT = "NSPRO_BRIDGE_RESPONSE";
  const BACKUP_SCHEMA_VERSION = 2;
  const BACKUP_LOCAL_KEYS = [
    "nsx_advanced_keywords",
    "nsx_content_rule_groups",
    "nsx_browsing_history",
    "nsx_recently_closed",
    "nodeseek_quick_reply",
    "nodeseek_quick_reply_auto_submit",
    "nsx_advanced_friends",
    "nsx_advanced_blacklist",
    "nsx_visited_posts"
  ];
  const BACKUP_PLAIN_STRING_KEYS = new Set(["nodeseek_quick_reply_auto_submit"]);
  const MANAGED_LOCAL_KEYS = new Set([
    "nsx_advanced_keywords",
    "nsx_content_rule_groups",
    "nsx_advanced_friends",
    "nsx_advanced_blacklist",
    "nsx_browsing_history",
    "nsx_recently_closed",
    "nodeseek_quick_reply",
    "nodeseek_quick_reply_auto_submit"
  ]);
  const BACKUP_NS_PREFERENCE_DB = "ns-preference-db";
  const BACKUP_NS_PREFERENCE_STORE = "ns-preference-store";

  function emit(name, value) {
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(value) }));
  }

  chrome.storage.local.get("gmStorage").then(({ gmStorage = {} }) => {
    emit("NSPRO_STORAGE_READY", gmStorage);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.gmStorage) return;
    emit("NSPRO_STORAGE_UPDATED", changes.gmStorage.newValue || {});
  });

  function readLocalValue(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    if (BACKUP_PLAIN_STRING_KEYS.has(key)) return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  function writeLocalValue(key, value) {
    if (value == null) localStorage.removeItem(key);
    else if (BACKUP_PLAIN_STRING_KEYS.has(key)) localStorage.setItem(key, String(value));
    else localStorage.setItem(key, JSON.stringify(value));
  }

  function readPreferenceConfig() {
    return new Promise(resolve => {
      try {
        const request = indexedDB.open(BACKUP_NS_PREFERENCE_DB);
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(BACKUP_NS_PREFERENCE_STORE)) {
            database.close();
            resolve(null);
            return;
          }
          const getRequest = database.transaction(BACKUP_NS_PREFERENCE_STORE, "readonly")
            .objectStore(BACKUP_NS_PREFERENCE_STORE)
            .get("configuration");
          getRequest.onerror = () => {
            database.close();
            resolve(null);
          };
          getRequest.onsuccess = () => {
            const value = getRequest.result;
            database.close();
            resolve(value && typeof value === "object" ? structuredClone(value) : null);
          };
        };
      } catch {
        resolve(null);
      }
    });
  }

  function writePreferenceConfig(config) {
    return new Promise(resolve => {
      try {
        const request = indexedDB.open(BACKUP_NS_PREFERENCE_DB);
        request.onerror = () => resolve(false);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(BACKUP_NS_PREFERENCE_STORE)) {
            request.result.createObjectStore(BACKUP_NS_PREFERENCE_STORE);
          }
        };
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains(BACKUP_NS_PREFERENCE_STORE)) {
            database.close();
            resolve(false);
            return;
          }
          const putRequest = database.transaction(BACKUP_NS_PREFERENCE_STORE, "readwrite")
            .objectStore(BACKUP_NS_PREFERENCE_STORE)
            .put(config || {}, "configuration");
          putRequest.onerror = () => {
            database.close();
            resolve(false);
          };
          putRequest.onsuccess = () => {
            database.close();
            resolve(true);
          };
        };
      } catch {
        resolve(false);
      }
    });
  }

  async function collectForumBackup() {
    const localData = {};
    for (const key of BACKUP_LOCAL_KEYS) {
      const value = readLocalValue(key);
      if (value !== null) localData[key] = value;
    }
    return {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      origin: location.origin,
      localStorage: localData,
      indexedDB: { nsPreferenceConfiguration: await readPreferenceConfig() }
    };
  }

  async function applyForumBackup(payload) {
    const localData = payload?.localStorage && typeof payload.localStorage === "object" ? payload.localStorage : {};
    const clearMissing = payload?.partial !== true && Number(payload?.schemaVersion || 1) >= BACKUP_SCHEMA_VERSION;
    for (const key of BACKUP_LOCAL_KEYS) {
      if (Object.prototype.hasOwnProperty.call(localData, key)) writeLocalValue(key, localData[key]);
      else if (clearMissing) localStorage.removeItem(key);
    }
    const preference = payload?.indexedDB?.nsPreferenceConfiguration;
    if (preference && typeof preference === "object") await writePreferenceConfig(preference);
    return { ok: true };
  }

  document.addEventListener(REQUEST_EVENT, event => {
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch {
      return;
    }
    chrome.runtime.sendMessage({
      type: "bridge",
      action: request.action,
      payload: request.payload
    }).then(response => {
      emit(RESPONSE_EVENT, { id: request.id, response });
    }).catch(error => {
      emit(RESPONSE_EVENT, { id: request.id, response: { ok: false, error: String(error?.message || error) } });
    });
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "gmNotificationClick" && message.callbackId) {
      emit("NSPRO_NOTIFICATION_CLICK", { callbackId: message.callbackId });
    }
    if (message?.type === "forumBackupCollect") {
      collectForumBackup().then(data => sendResponse({ ok: true, data })).catch(error => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
      return true;
    }
    if (message?.type === "forumBackupApply") {
      applyForumBackup(message.payload).then(sendResponse).catch(error => {
        sendResponse({ ok: false, error: String(error?.message || error) });
      });
      return true;
    }
    if (message?.type === "forumDataGet") {
      const keys = Array.isArray(message.keys) ? message.keys.filter(key => MANAGED_LOCAL_KEYS.has(key)) : [];
      sendResponse({ ok: true, data: Object.fromEntries(keys.map(key => [key, readLocalValue(key)])) });
      return;
    }
    if (message?.type === "forumDataSet") {
      const values = message.values && typeof message.values === "object" ? message.values : {};
      const changedKeys = [];
      for (const [key, value] of Object.entries(values)) {
        if (!MANAGED_LOCAL_KEYS.has(key)) continue;
        writeLocalValue(key, value);
        changedKeys.push(key);
      }
      if (changedKeys.length) emit("NSPRO_FORUM_DATA_CHANGED", { keys: changedKeys });
      sendResponse({ ok: true, data: { keys: changedKeys } });
      return;
    }
  });
})();

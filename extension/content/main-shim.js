(() => {
  const extensionOrigin = String(new Error().stack || "").match(/chrome-extension:\/\/[^/]+/)?.[0] || "";
  globalThis.LAYUI_GLOBAL = {
    ...(globalThis.LAYUI_GLOBAL || {}),
    dir: extensionOrigin ? `${extensionOrigin}/vendor/layui/` : "",
    layer_dir: extensionOrigin ? `${extensionOrigin}/vendor/layui/` : ""
  };
  const REQUEST_EVENT = "NSPRO_BRIDGE_REQUEST";
  const RESPONSE_EVENT = "NSPRO_BRIDGE_RESPONSE";
  const pending = new Map();
  const notificationCallbacks = new Map();
  const menuCallbacks = new Map();
  const gmCache = Object.create(null);
  let sequence = 0;

  const replaceGmCache = value => {
    Object.keys(gmCache).forEach(key => delete gmCache[key]);
    if (value && typeof value === "object") Object.assign(gmCache, structuredClone(value));
  };

  const request = (action, payload) => new Promise(resolve => {
    const id = `nspro:${Date.now()}:${++sequence}`;
    pending.set(id, resolve);
    document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: JSON.stringify({ id, action, payload })
    }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      resolve({ ok: false, error: "扩展后台响应超时" });
    }, 120000);
  });

  document.addEventListener(RESPONSE_EVENT, event => {
    try {
      const detail = JSON.parse(event.detail);
      const resolve = pending.get(detail.id);
      if (!resolve) return;
      pending.delete(detail.id);
      resolve(detail.response);
    } catch {
      // Ignore malformed bridge messages.
    }
  });

  document.addEventListener("NSPRO_NOTIFICATION_CLICK", event => {
    try {
      const { callbackId } = JSON.parse(event.detail);
      notificationCallbacks.get(callbackId)?.();
    } catch {
      // Ignore stale notification callbacks.
    }
  });

  globalThis.__NSPRO_READY = new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    document.addEventListener("NSPRO_STORAGE_READY", event => {
      try {
        replaceGmCache(JSON.parse(event.detail));
      } catch {
        // Start with defaults when the saved cache cannot be read.
      }
      finish();
    }, { once: true });
    setTimeout(finish, 1500);
  });

  document.addEventListener("NSPRO_STORAGE_UPDATED", event => {
    try {
      replaceGmCache(JSON.parse(event.detail));
      document.dispatchEvent(new CustomEvent("NSPRO_GM_SETTINGS_CHANGED", {
        detail: JSON.stringify({ settings: gmCache.settings || {} })
      }));
    } catch {
      // Ignore malformed storage change events.
    }
  });

  globalThis.GM_getValue = (key, fallback) => key in gmCache ? structuredClone(gmCache[key]) : fallback;
  globalThis.GM_setValue = (key, value) => {
    gmCache[key] = structuredClone(value);
    request("storageSet", { key, value: gmCache[key] });
  };
  globalThis.GM_deleteValue = key => {
    delete gmCache[key];
    request("storageDelete", { key });
  };
  globalThis.GM_info = {
    script: {
      name: "Nodeseek Max-iSen (Extension Edition)",
      version: "1.1.21-extension.1",
      namespace: "https://github.com/EISEN0516/nodeseek-pro-userscript"
    }
  };
  globalThis.unsafeWindow = globalThis;

  globalThis.GM_getResourceURL = () => "";
  globalThis.GM_addStyle = css => {
    const style = document.createElement("style");
    style.textContent = String(css || "");
    (document.head || document.documentElement).appendChild(style);
    return style;
  };
  globalThis.GM_addElement = (parent, tag, attributes = {}) => {
    if (typeof parent === "string") {
      attributes = tag || {};
      tag = parent;
      parent = document.head || document.documentElement;
    }
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes || {})) {
      if (key === "textContent") element.textContent = value;
      else element.setAttribute(key, value);
    }
    (parent || document.head || document.documentElement).appendChild(element);
    return element;
  };

  globalThis.GM_openInTab = (url, options = {}) => {
    request("openTab", { url: String(url), active: options.active !== false });
    return { close() {} };
  };

  globalThis.__NSPRO_OPEN_OPTIONS = panel => request("openOptions", { panel: String(panel || "") });
  globalThis.__NSPRO_SEND_LOTTERY_NOTIFICATION = payload => request("lotteryNotify", payload || {});

  globalThis.GM_notification = options => {
    const value = typeof options === "string" ? { text: options } : (options || {});
    const callbackId = value.onclick ? `notify:${Date.now()}:${++sequence}` : "";
    if (callbackId) notificationCallbacks.set(callbackId, value.onclick);
    request("notify", {
      title: value.title || "NodeSeek Expansion Tool",
      text: value.text || value.message || "",
      callbackId
    });
  };

  globalThis.GM_registerMenuCommand = (name, callback) => {
    const id = `menu:${++sequence}`;
    menuCallbacks.set(id, { name, callback });
    globalThis.__NSPRO_MENU_COMMANDS = menuCallbacks;
    return id;
  };
  globalThis.GM_unregisterMenuCommand = id => menuCallbacks.delete(id);

  const toBase64 = bytes => {
    let binary = "";
    for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
    return btoa(binary);
  };

  const fromBase64 = value => {
    const binary = atob(value || "");
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  };

  async function serializeBody(data) {
    if (data == null) return { kind: "empty" };
    if (typeof data === "string" || data instanceof URLSearchParams) {
      return { kind: "text", value: String(data) };
    }
    if (data instanceof FormData) {
      const entries = [];
      for (const [name, value] of data.entries()) {
        if (value instanceof Blob) {
          entries.push({
            name,
            value: {
              kind: "file",
              name: value.name || "file",
              type: value.type,
              base64: toBase64(await value.arrayBuffer())
            }
          });
        } else {
          entries.push({ name, value: { kind: "text", value: String(value) } });
        }
      }
      return { kind: "formData", entries };
    }
    if (data instanceof Blob) return { kind: "bytes", base64: toBase64(await data.arrayBuffer()) };
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const buffer = data instanceof ArrayBuffer ? data : data.buffer;
      return { kind: "bytes", base64: toBase64(buffer) };
    }
    return { kind: "text", value: String(data) };
  }

  globalThis.GM_xmlhttpRequest = details => {
    let aborted = false;
    (async () => {
      const response = await request("xhr", {
        method: details.method || "GET",
        url: details.url,
        headers: details.headers || {},
        body: await serializeBody(details.data),
        responseType: details.responseType || "text",
        timeout: details.timeout || 0,
        anonymous: Boolean(details.anonymous)
      });
      if (aborted) return;
      if (!response?.ok) {
        const handler = response?.timedOut ? details.ontimeout : details.onerror;
        handler?.({ error: response?.error || "请求失败" });
        return;
      }
      let body = response.responseText;
      if (response.responseBase64) {
        const bytes = fromBase64(response.responseBase64);
        body = response.responseType === "blob"
          ? new Blob([bytes], { type: response.responseMime })
          : bytes.buffer;
      } else if (details.responseType === "json") {
        try { body = JSON.parse(response.responseText); } catch { body = null; }
      }
      details.onload?.({
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.finalUrl,
        responseHeaders: response.responseHeaders,
        responseText: response.responseText,
        response: body
      });
    })();
    return {
      abort() {
        aborted = true;
        details.onabort?.();
      }
    };
  };

  addEventListener("DOMContentLoaded", () => {
    if (globalThis.hljs?.highlightAll) globalThis.hljs.highlightAll();
  }, { once: true });
})();

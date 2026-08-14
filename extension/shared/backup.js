export const BACKUP_FORMAT = "nspro-extension-backup";
export const BACKUP_SCHEMA_VERSION = 2;

export const LOTTERY_GM_STORAGE_KEYS = [
  "lottery_reminders",
  "lottery_participation_history",
  "notify_config"
];

export const FORUM_LOCAL_STORAGE_KEYS = [
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

export const USER_SETTINGS_FORUM_KEYS = [
  "nsx_advanced_keywords",
  "nsx_content_rule_groups",
  "nodeseek_quick_reply",
  "nodeseek_quick_reply_auto_submit",
  "nsx_advanced_friends",
  "nsx_advanced_blacklist"
];

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function createExtensionBackup({ settings, gmStorage, forums, extensionVersion }) {
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    extensionVersion,
    data: {
      extensionSettings: settings,
      gmStorage,
      forums
    }
  };
}

function cloneRecord(value) {
  return isRecord(value) ? structuredClone(value) : {};
}

function userGmSettings(value) {
  const result = cloneRecord(value);
  for (const site of ["ns", "df"]) {
    if (!isRecord(result.sign_in?.[site])) continue;
    delete result.sign_in[site].last_date;
    delete result.sign_in[site].ignore_date;
  }
  return result;
}

export function createUserInfoBackup({ settings, gmStorage, forums, extensionVersion }) {
  const source = isRecord(gmStorage) ? gmStorage : {};
  const exportedGmStorage = { settings: userGmSettings(source.settings) };
  if (isRecord(source.notify_config)) exportedGmStorage.notify_config = cloneRecord(source.notify_config);
  const exportedForums = Object.fromEntries(Object.entries(isRecord(forums) ? forums : {}).map(([siteId, forum]) => {
    const localStorage = isRecord(forum?.localStorage)
      ? Object.fromEntries(USER_SETTINGS_FORUM_KEYS
        .filter(key => Object.prototype.hasOwnProperty.call(forum.localStorage, key))
        .map(key => [key, structuredClone(forum.localStorage[key])]))
      : {};
    return [siteId, {
      schemaVersion: BACKUP_SCHEMA_VERSION,
      partial: true,
      origin: String(forum?.origin || ""),
      localStorage,
      indexedDB: {}
    }];
  }));
  return {
    format: BACKUP_FORMAT,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    scope: "user-settings",
    exportedAt: new Date().toISOString(),
    extensionVersion,
    data: {
      extensionSettings: cloneRecord(settings),
      gmStorage: exportedGmStorage,
      forums: exportedForums
    }
  };
}

export function parseBackupPayload(payload) {
  if (!isRecord(payload)) throw new Error("备份文件格式不正确");

  if (payload.format === BACKUP_FORMAT) {
    if (!isRecord(payload.data) || !isRecord(payload.data.extensionSettings) || !isRecord(payload.data.gmStorage)) {
      throw new Error("扩展备份缺少必要配置");
    }
    return {
      kind: "extension",
      partial: payload.scope === "user-settings",
      extensionSettings: payload.data.extensionSettings,
      gmStorage: payload.data.gmStorage,
      forums: isRecord(payload.data.forums) ? payload.data.forums : {}
    };
  }

  if (payload.format === "nsx-backup") {
    if (!isRecord(payload.data) || !isRecord(payload.data.settings)) {
      throw new Error("GreasyFork 备份缺少网页增强配置");
    }
    const forumData = {
      schemaVersion: Number(payload.schemaVersion || 1),
      localStorage: isRecord(payload.data.localStorage) ? payload.data.localStorage : {},
      indexedDB: isRecord(payload.data.indexedDB) ? payload.data.indexedDB : {}
    };
    return {
      kind: "greasyfork",
      partial: false,
      extensionSettings: null,
      gmStorage: { settings: payload.data.settings },
      forums: { nodeseek: forumData, deepflood: forumData }
    };
  }

  if (isRecord(payload.settings) || isRecord(payload.gmStorage)) {
    return {
      kind: "legacy-extension",
      partial: false,
      extensionSettings: isRecord(payload.settings) ? payload.settings : null,
      gmStorage: isRecord(payload.gmStorage) ? payload.gmStorage : null,
      forums: {}
    };
  }

  throw new Error("不支持的备份文件格式");
}

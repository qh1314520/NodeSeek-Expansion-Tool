export const SITES = {
  nodeseek: {
    id: "nodeseek",
    name: "NodeSeek",
    origin: "https://www.nodeseek.com"
  },
  deepflood: {
    id: "deepflood",
    name: "DeepFlood",
    origin: "https://www.deepflood.com"
  }
};

export const TYPE_LABELS = {
  mention: "有人艾特你",
  reply: "主题收到回复",
  message: "收到站内私信"
};

export const CHANNEL_LABELS = {
  telegram: "Telegram Bot",
  email: "邮件",
  wechat: "微信推送",
  wecom: "企业微信",
  dingtalk: "钉钉",
  feishu: "飞书"
};

export const DEFAULT_SETTINGS = {
  version: 1,
  appearance: {
    theme: "system"
  },
  lotteryNotifications: {
    enabled: true,
    browserNotifications: true,
    pushEnabled: true,
    nearDraw: true,
    result: true
  },
  notifications: {
    enabled: true,
    pollMinutes: 1,
    browserNotifications: true,
    includePreview: true,
    sites: {
      nodeseek: true,
      deepflood: true
    },
    types: {
      mention: true,
      reply: true,
      message: true
    },
    quietHours: {
      enabled: false,
      start: "23:00",
      end: "08:00"
    },
    templates: {
      forum: "{subject}\n{body}\n{url}",
      lottery: "{subject}\n{body}\n{url}"
    },
    channels: {
      telegram: { enabled: false, botToken: "", chatId: "", silent: false },
      email: {
        enabled: false,
        provider: "resend",
        apiKey: "",
        from: "",
        to: "",
        domain: "",
        serviceId: "",
        templateId: "",
        userId: ""
      },
      wechat: { enabled: false, provider: "serverchan3", sendKey: "", token: "" },
      wecom: { enabled: false, webhook: "" },
      dingtalk: { enabled: false, webhook: "", secret: "", atMobiles: "" },
      feishu: { enabled: false, webhook: "", secret: "" }
    }
  }
};

export function mergeDefaults(saved, defaults = DEFAULT_SETTINGS) {
  if (Array.isArray(defaults)) return Array.isArray(saved) ? saved : [...defaults];
  if (!defaults || typeof defaults !== "object") {
    if (saved === undefined || saved === null) return defaults;
    return typeof saved === typeof defaults ? saved : defaults;
  }
  if (saved !== undefined && (!saved || typeof saved !== "object" || Array.isArray(saved))) {
    saved = undefined;
  }
  const result = {};
  for (const [key, value] of Object.entries(defaults)) {
    result[key] = mergeDefaults(saved?.[key], value);
  }
  for (const [key, value] of Object.entries(saved || {})) {
    if (!(key in result)) result[key] = value;
  }
  if (defaults === DEFAULT_SETTINGS && result.notifications?.channels) {
    delete result.notifications.channels.bark;
    delete result.notifications.channels.discord;
    const legacyTemplate = Object.values(saved?.notifications?.channels || {})
      .map(channel => typeof channel?.messageTemplate === "string" ? channel.messageTemplate.trim() : "")
      .find(Boolean);
    if (!saved?.notifications?.templates && legacyTemplate) {
      result.notifications.templates.forum = legacyTemplate;
      result.notifications.templates.lottery = legacyTemplate;
    }
    for (const channel of Object.values(result.notifications.channels)) delete channel.messageTemplate;
  }
  return result;
}

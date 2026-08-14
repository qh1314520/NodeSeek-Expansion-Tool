import { CHANNEL_LABELS } from "../shared/config.js";

function requireHttps(value, allowedHosts = []) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("地址必须使用 HTTPS");
  if (allowedHosts.length && !allowedHosts.includes(url.hostname)) throw new Error("Webhook 域名不受支持");
  return url.href;
}

async function responseOrThrow(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 180)}`);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed?.ok === false || parsed?.success === false || Number(parsed?.errcode) > 0 || Number(parsed?.code) > 0) {
      throw new Error(parsed.description || parsed.message || parsed.errmsg || `服务返回错误 ${parsed.code}`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) return text;
    throw error;
  }
}

async function postJson(url, payload, headers = {}) {
  return responseOrThrow(await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload)
  }));
}

function recipients(value) {
  return String(value || "").split(",").map(item => item.trim()).filter(Boolean);
}

export function renderMessageTemplate(template, message) {
  const source = String(template || "").trim();
  if (!source) return "";
  const values = {
    subject: message?.subject,
    body: message?.body,
    url: message?.url,
    site: message?.site,
    type: message?.type,
    actor: message?.actor,
    summary: message?.summary,
    time: message?.time
  };
  return source.replace(/\{(subject|body|url|site|type|actor|summary|time)\}/g, (_, key) => String(values[key] || ""));
}

function channelContent(template, message, fallback) {
  return renderMessageTemplate(template, message) || fallback;
}

async function hmacBase64(keyText, message) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyText),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const senders = {
  async telegram(config, message, template) {
    if (!config.botToken || !config.chatId) throw new Error("Bot Token 或 Chat ID 未填写");
    const token = String(config.botToken).trim();
    if (!/^[A-Za-z0-9_:-]+$/.test(token)) throw new Error("Bot Token 格式无效");
    return postJson(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: config.chatId,
      text: channelContent(template, message, `${message.subject}\n${message.body}\n${message.url || ""}`.trim()),
      disable_notification: Boolean(config.silent),
      disable_web_page_preview: true
    });
  },

  async email(config, message, template) {
    const to = recipients(config.to);
    if (!to.length) throw new Error("收件人未填写");
    const content = channelContent(template, message, `${message.body}${message.url ? `\n\n${message.url}` : ""}`);
    if (config.provider === "resend") {
      if (!config.apiKey || !config.from) throw new Error("Resend API Key 或发件人未填写");
      return postJson("https://api.resend.com/emails", {
        from: config.from,
        to,
        subject: message.subject,
        text: content
      }, { Authorization: `Bearer ${config.apiKey}` });
    }
    if (config.provider === "sendgrid") {
      if (!config.apiKey || !config.from) throw new Error("SendGrid API Key 或发件人未填写");
      return postJson("https://api.sendgrid.com/v3/mail/send", {
        personalizations: [{ to: to.map(email => ({ email })) }],
        from: { email: config.from },
        subject: message.subject,
        content: [{ type: "text/plain", value: content }]
      }, { Authorization: `Bearer ${config.apiKey}` });
    }
    if (config.provider === "mailgun") {
      if (!config.apiKey || !config.domain || !config.from) throw new Error("Mailgun 配置不完整");
      const form = new URLSearchParams();
      form.set("from", config.from);
      for (const address of to) form.append("to", address);
      form.set("subject", message.subject);
      form.set("text", content);
      return responseOrThrow(await fetch(`https://api.mailgun.net/v3/${encodeURIComponent(config.domain)}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`api:${config.apiKey}`)}`,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: form.toString()
      }));
    }
    if (config.provider === "emailjs") {
      if (!config.serviceId || !config.templateId || !config.userId) throw new Error("EmailJS 配置不完整");
      return postJson("https://api.emailjs.com/api/v1.0/email/send", {
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.userId,
        template_params: {
          to_email: to.join(","),
          subject: message.subject,
          message: content
        }
      });
    }
    throw new Error("不支持的邮件服务商");
  },

  async wechat(config, message, template) {
    const content = channelContent(template, message, `${message.body}${message.url ? `\n\n[查看详情](${message.url})` : ""}`);
    if (config.provider === "pushplus") {
      if (!config.token) throw new Error("PushPlus Token 未填写");
      return postJson("https://www.pushplus.plus/send", {
        token: config.token,
        title: message.subject,
        content,
        template: "markdown"
      });
    }
    if (!config.sendKey) throw new Error("Server 酱 SendKey 未填写");
    const endpoint = config.provider === "serverchan"
      ? `https://sc.ftqq.com/${encodeURIComponent(config.sendKey)}.send`
      : `https://sctapi.ftqq.com/${encodeURIComponent(config.sendKey)}.send`;
    const form = new URLSearchParams(config.provider === "serverchan"
      ? { text: message.subject, desp: content }
      : { title: message.subject, desp: content });
    return responseOrThrow(await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    }));
  },

  async dingtalk(config, message, template) {
    if (!config.webhook) throw new Error("钉钉 Webhook 未填写");
    let webhook = requireHttps(config.webhook, ["oapi.dingtalk.com"]);
    if (config.secret) {
      const timestamp = Date.now();
      const sign = await hmacBase64(config.secret, `${timestamp}\n${config.secret}`);
      const parsed = new URL(webhook);
      parsed.searchParams.set("timestamp", String(timestamp));
      parsed.searchParams.set("sign", sign);
      webhook = parsed.href;
    }
    const customContent = renderMessageTemplate(template, message);
    const content = customContent || `${message.body}${message.url ? `\n\n[查看详情](${message.url})` : ""}`;
    return postJson(webhook, {
      msgtype: "markdown",
      markdown: { title: message.subject, text: customContent || `#### ${message.subject}\n${content}` },
      at: { atMobiles: recipients(config.atMobiles), isAtAll: false }
    });
  },

  async feishu(config, message, template) {
    if (!config.webhook) throw new Error("飞书 Webhook 未填写");
    const payload = {
      msg_type: "text",
      content: { text: channelContent(template, message, `${message.subject}\n${message.body}${message.url ? `\n${message.url}` : ""}`) }
    };
    if (config.secret) {
      const timestamp = Math.floor(Date.now() / 1000);
      payload.timestamp = String(timestamp);
      payload.sign = await hmacBase64(`${timestamp}\n${config.secret}`, "");
    }
    return postJson(requireHttps(config.webhook, ["open.feishu.cn"]), payload);
  },

  async wecom(config, message, template) {
    if (!config.webhook) throw new Error("企业微信 Webhook 未填写");
    const content = channelContent(template, message, `**${message.subject}**\n${message.body}${message.url ? `\n[查看详情](${message.url})` : ""}`);
    return postJson(requireHttps(config.webhook, ["qyapi.weixin.qq.com"]), {
      msgtype: "markdown",
      markdown: { content }
    });
  }
};

export async function sendChannel(channel, config, message, template = "") {
  const sender = senders[channel];
  if (!sender) throw new Error(`未知通知渠道：${channel}`);
  return sender(config, message, template);
}

export async function sendEnabledChannels(channels, message, onlyChannels = null, template = "") {
  const selected = Object.entries(channels || {}).filter(([name, config]) => {
    return config?.enabled && (!onlyChannels || onlyChannels.includes(name));
  });
  const settled = await Promise.allSettled(selected.map(([name, config]) => sendChannel(name, config, message, template)));
  return selected.map(([name], index) => {
    const result = settled[index];
    return result.status === "fulfilled"
      ? { channel: name, label: CHANNEL_LABELS[name], ok: true }
      : { channel: name, label: CHANNEL_LABELS[name], ok: false, error: String(result.reason?.message || result.reason) };
  });
}

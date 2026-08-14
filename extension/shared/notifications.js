import { TYPE_LABELS } from "./config.js";

export function inferCurrentUserId(messages = []) {
  const counts = new Map();
  for (const item of messages) {
    for (const value of [item?.sender_id, item?.receiver_id]) {
      const id = Number(value);
      if (Number.isFinite(id)) counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export function postPageForFloor(floor) {
  return Math.max(1, Math.ceil(Math.max(1, Number(floor) || 1) / 10));
}

export function normalizeForumItems(type, payload, site, options = {}) {
  const includePreview = options.includePreview !== false;
  if (type === "message") {
    const rows = Array.isArray(payload?.msgArray) ? payload.msgArray : [];
    const currentUserId = inferCurrentUserId(rows);
    return rows
      .filter(item => currentUserId == null || Number(item.receiver_id) === currentUserId)
      .map(item => ({
        key: `${site.id}:message:${item.max_id}`,
        id: Number(item.max_id) || 0,
        type,
        siteId: site.id,
        siteName: site.name,
        title: TYPE_LABELS.message,
        actor: String(item.sender_name || "论坛用户"),
        summary: includePreview ? String(item.content || "").trim().slice(0, 280) : "打开论坛查看私信内容",
        createdAt: item.created_at || "",
        url: `${site.origin}/notification#/message?mode=talk&to=${encodeURIComponent(item.sender_id)}`
      }));
  }

  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows.map(item => {
    const floor = Number(item.floor_id) || 0;
    const postId = Number(item.post_id) || 0;
    const page = postPageForFloor(floor);
    return {
      key: `${site.id}:${type}:${item.id}`,
      id: Number(item.id) || 0,
      type,
      siteId: site.id,
      siteName: site.name,
      title: TYPE_LABELS[type],
      actor: String(item.commenter_name || "论坛用户"),
      summary: String(item.title || "论坛主题").trim().slice(0, 280),
      createdAt: item.created_at || "",
      url: `${site.origin}/post-${postId}-${page}#${floor}`
    };
  });
}

export function selectNewItems(items, lastId) {
  const baseline = Number(lastId) || 0;
  return items.filter(item => Number(item.id) > baseline).sort((a, b) => a.id - b.id);
}

export function maxItemId(items, fallback = 0) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), Number(fallback) || 0);
}

export function formatNotification(item) {
  const subject = `[${item.siteName}] ${item.title}`;
  const body = `${item.actor}：${item.summary}`;
  return {
    subject,
    body,
    url: item.url,
    site: item.siteName,
    type: item.title,
    actor: item.actor,
    summary: item.summary,
    time: item.createdAt
  };
}

export function isQuietTime(quietHours, date = new Date()) {
  if (!quietHours?.enabled) return false;
  const parse = value => {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const start = parse(quietHours.start);
  const end = parse(quietHours.end);
  if (start == null || end == null || start === end) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  return start < end ? now >= start && now < end : now >= start || now < end;
}

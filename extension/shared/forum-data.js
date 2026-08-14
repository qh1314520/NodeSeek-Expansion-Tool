export const CONTENT_GROUPS_KEY = "nsx_content_rule_groups";
export const KEYWORD_RULES_KEY = "nsx_advanced_keywords";
export const USER_BLOCK_RULES_KEY = "nsx_advanced_blacklist";
export const QUICK_PHRASES_KEY = "nodeseek_quick_reply";
export const QUICK_AUTO_SUBMIT_KEY = "nodeseek_quick_reply_auto_submit";
export const BROWSING_HISTORY_KEY = "nsx_browsing_history";
export const RECENTLY_CLOSED_KEY = "nsx_recently_closed";

export const MANAGED_FORUM_DATA_KEYS = [
  CONTENT_GROUPS_KEY,
  KEYWORD_RULES_KEY,
  USER_BLOCK_RULES_KEY,
  QUICK_PHRASES_KEY,
  QUICK_AUTO_SUBMIT_KEY,
  BROWSING_HISTORY_KEY,
  RECENTLY_CLOSED_KEY
];

const isRecord = value => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const cleanText = value => String(value ?? "").trim();
const safeColor = (value, fallback) => /^#[\da-f]{6}$/i.test(cleanText(value)) ? cleanText(value) : fallback;
const safeEntries = entries => Object.fromEntries(entries.filter(([key]) => key && !["__proto__", "prototype", "constructor"].includes(key)));

function normalizeGroupList(value, kind) {
  const source = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([id, item]) => isRecord(item) ? { id, ...item } : { id, name: item })
      : [];
  const seen = new Set();
  return source.map((item, index) => {
    const sourceItem = isRecord(item) ? item : { name: item };
    const name = cleanText(sourceItem.name || sourceItem.label || sourceItem.title);
    if (!name) return null;
    let id = cleanText(sourceItem.id) || `${kind}-${index + 1}`;
    if (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id,
      name,
      color: safeColor(sourceItem.color, kind === "keywords" ? "#f59e0b" : "#ef4444"),
      enabled: sourceItem.enabled !== false
    };
  }).filter(Boolean);
}

export function normalizeContentGroups(value) {
  const source = isRecord(value) ? value : {};
  return {
    keywords: normalizeGroupList(source.keywords, "keywords"),
    users: normalizeGroupList(source.users, "users")
  };
}

export function normalizeKeywordRules(value) {
  if (Array.isArray(value)) {
    value = safeEntries(value.map(item => [cleanText(isRecord(item) ? item.word || item.keyword : item), item]));
  }
  if (!isRecord(value)) return {};
  return safeEntries(Object.entries(value).map(([rawWord, rawRule]) => {
    const word = cleanText(rawWord);
    if (!word) return ["", null];
    const rule = isRecord(rawRule) ? rawRule : {};
    const type = rule.type === "highlight" ? "highlight" : "block";
    return [word, {
      type,
      mode: type === "block" && rule.mode === "hide" ? "hide" : type === "block" ? "fold" : null,
      color: type === "highlight" ? safeColor(rule.color, "#fff9c4") : null,
      group: cleanText(rule.group),
      enabled: rule.enabled !== false,
      time: cleanText(rule.time)
    }];
  }));
}

export function normalizeUserBlockRules(value) {
  if (Array.isArray(value)) {
    value = safeEntries(value.map(item => [cleanText(isRecord(item) ? item.username || item.name : item), item]));
  }
  if (!isRecord(value)) return {};
  return safeEntries(Object.entries(value).map(([rawUsername, rawRule]) => {
    const username = cleanText(rawUsername);
    if (!username) return ["", null];
    const rule = isRecord(rawRule) ? rawRule : {};
    const rawMode = cleanText(rule.mode);
    const mode = rawMode === "hide" || rawMode === "official" ? "official" : rawMode === "mark" ? "mark" : "fold";
    return [username, {
      remark: cleanText(rule.remark),
      userId: cleanText(rule.userId),
      mode,
      group: cleanText(rule.group),
      enabled: rule.enabled !== false,
      time: cleanText(rule.time)
    }];
  }));
}

function normalizePhraseItems(value) {
  const source = Array.isArray(value) ? value : isRecord(value) ? Object.values(value) : [value];
  return source.map(item => {
    if (typeof item === "string") {
      const content = cleanText(item);
      return content ? { title: shrinkPhrase(content), content } : null;
    }
    if (!isRecord(item)) return null;
    const content = cleanText(item.content ?? item.text ?? item.value);
    if (!content) return null;
    return { title: cleanText(item.title ?? item.name ?? item.label) || shrinkPhrase(content), content };
  }).filter(Boolean);
}

export function normalizeQuickPhrases(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = { "默认": [value] };
    }
  }
  if (Array.isArray(value)) value = { "默认": value };
  if (!isRecord(value)) return {};
  return safeEntries(Object.entries(value).map(([rawName, items]) => [cleanText(rawName), normalizePhraseItems(items)]));
}

export function normalizeForumHistory(value) {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.map(item => {
    if (!isRecord(item)) return null;
    const postId = cleanText(item.postId ?? item.post_id);
    if (!/^\d+$/.test(postId) || seen.has(postId)) return null;
    const time = new Date(item.time);
    if (!Number.isFinite(time.getTime())) return null;
    seen.add(postId);
    return {
      postId,
      title: cleanText(item.title) || `帖子 ${postId}`,
      time: time.toISOString(),
      uid: cleanText(item.uid) || null,
      author: cleanText(item.author) || null
    };
  }).filter(Boolean).sort((left, right) => new Date(right.time) - new Date(left.time));
}

export function shrinkPhrase(value, length = 28) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > length ? `${text.slice(0, length)}...` : text;
}

export function makeForumRuleId(prefix = "group") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

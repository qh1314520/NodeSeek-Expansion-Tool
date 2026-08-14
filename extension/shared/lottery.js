const RESULT_LABELS = {
  won: "已中奖",
  lost: "未中奖",
  unknown: "已开奖"
};

export const LOTTERY_EVIDENCE_LABELS = {
  comment: "评论",
  like: "点赞",
  coin: "加鸡腿",
  favorite: "收藏"
};

export function lotteryPostId(value) {
  return String(value || "").match(/\/post-(\d+)/)?.[1] || "";
}

function lotteryTitleMatches(value) {
  return /(?:抽奖|giveaway|raffle)/i.test(String(value || ""));
}

function hasValidLuckyUrl(value) {
  try {
    const url = new URL(String(value || ""), "https://www.nodeseek.com/");
    return /(^|\.)nodeseek\.com$/i.test(url.hostname)
      && /^\/lucky\/?$/i.test(url.pathname)
      && /^\d+$/.test(String(url.searchParams.get("post") || ""));
  } catch {
    return false;
  }
}

function isTrackedLotteryReminder(reminder) {
  return !!reminder && lotteryTitleMatches(reminder.title) && hasValidLuckyUrl(reminder.luckyUrl);
}

export function lotteryNotificationStatus(reminder, now = Date.now()) {
  if (reminder?.resultNotified) return `开奖结果已通知 · ${RESULT_LABELS[reminder.resultStatus] || "已开奖"}`;
  if (reminder?.resultCheckedAt) {
    const result = `开奖结果已识别 · ${RESULT_LABELS[reminder.resultStatus] || "已开奖"}`;
    if (reminder.resultNotifyLastError) return `${result} · 通知失败，等待重试`;
    if (reminder.resultNotifySkippedAt) return `${result} · 通知未启用或没有可用渠道`;
    return `${result} · 等待发送通知`;
  }
  if (reminder?.resultCheckLastError) return "开奖结果识别失败，等待重试";
  if (reminder?.resultNotifyLastError) return "开奖结果通知失败，等待重试";
  if (reminder?.resultNotifySkippedAt) return "开奖结果通知未启用或没有可用渠道";
  if (reminder?.drawNotified) return "开奖通知已发送";
  if (reminder?.drawNotifyLastError) return "开奖通知失败，等待重试";
  if (reminder?.drawNotifySkippedAt) return "开奖通知未启用或没有可用渠道";
  if (reminder?.nearDrawNotified) return "开奖前提醒已发送";
  if (reminder?.nearDrawNotifyLastError) return "开奖前提醒失败，等待重试";
  if (reminder?.nearDrawNotifySkippedAt) return "开奖前提醒未启用或没有可用渠道";
  const drawTime = Number(reminder?.drawTime);
  if (!Number.isFinite(drawTime) || drawTime <= 0) return "未识别开奖时间";
  return drawTime <= Number(now) ? "等待开奖结果通知" : "等待开奖前提醒";
}

function hasCommentEvidence(record) {
  return record?.status === "joined"
    && Array.isArray(record.evidence)
    && record.evidence.includes("comment");
}

export function sanitizeLotteryStorage(gmStorage) {
  const storage = gmStorage && typeof gmStorage === "object" ? gmStorage : {};
  const history = storage.lottery_participation_history;
  const users = history?.users && typeof history.users === "object" && !Array.isArray(history.users) ? history.users : {};
  const activeUserId = String(history?.lastKnownUserId || "");
  const commentPostIds = new Set();
  let changed = false;

  for (const [userId, profile] of Object.entries(users)) {
    if (!profile?.records || typeof profile.records !== "object" || Array.isArray(profile.records)) continue;
    for (const [savedPostId, record] of Object.entries(profile.records)) {
      const postId = String(record?.postId || savedPostId || lotteryPostId(record?.postUrl));
      if (!/^\d+$/.test(postId) || !hasCommentEvidence(record)) {
        delete profile.records[savedPostId];
        changed = true;
        continue;
      }
      if (!activeUserId || userId === activeUserId) commentPostIds.add(postId);
    }
  }

  if (Array.isArray(storage.lottery_reminders)) {
    const reminders = storage.lottery_reminders.filter(reminder => commentPostIds.has(lotteryPostId(reminder?.postUrl))
      && isTrackedLotteryReminder(reminder));
    if (reminders.length !== storage.lottery_reminders.length) {
      storage.lottery_reminders = reminders;
      changed = true;
    }
  }

  return { storage, changed };
}

export function buildLotteryRecords(gmStorage, now = Date.now()) {
  const storage = gmStorage && typeof gmStorage === "object" ? gmStorage : {};
  const reminders = Array.isArray(storage.lottery_reminders) ? storage.lottery_reminders : [];
  const reminderByPost = new Map(reminders.map(reminder => [lotteryPostId(reminder?.postUrl), reminder]).filter(([id]) => id));
  const history = storage.lottery_participation_history;
  const users = history?.users && typeof history.users === "object" && !Array.isArray(history.users) ? history.users : {};
  const activeUserId = String(history?.lastKnownUserId || "");
  const profiles = activeUserId && users[activeUserId] ? [[activeUserId, users[activeUserId]]] : Object.entries(users);
  const records = [];

  for (const [userId, profile] of profiles) {
    const participation = profile?.records && typeof profile.records === "object" && !Array.isArray(profile.records)
      ? profile.records
      : {};
    for (const [savedPostId, record] of Object.entries(participation)) {
      if (!hasCommentEvidence(record)) continue;
      const evidence = Array.isArray(record.evidence) ? record.evidence.filter(key => LOTTERY_EVIDENCE_LABELS[key]) : [];
      const postId = String(record.postId || savedPostId || lotteryPostId(record.postUrl));
      if (!/^\d+$/.test(postId)) continue;
      const reminder = reminderByPost.get(postId) || null;
      const title = String(record.title || reminder?.title || "").trim();
      if (!isTrackedLotteryReminder(reminder)) continue;
      records.push({
        key: `${userId}:${postId}`,
        postId,
        postUrl: record.postUrl || reminder?.postUrl || `https://www.nodeseek.com/post-${postId}-1`,
        title: title || "抽奖活动",
        userId,
        username: record.username || profile?.username || "",
        joined: true,
        confirmedAt: Number(record.confirmedAt) || Number(reminder?.participatedAt) || 0,
        evidence,
        source: record.source || "",
        reminder,
        drawTime: Number(reminder?.drawTime) || 0,
        notificationStatus: lotteryNotificationStatus(reminder, now)
      });
    }
  }

  records.sort((left, right) => {
    const leftTime = left.confirmedAt || Number(left.reminder?.added) || left.drawTime || 0;
    const rightTime = right.confirmedAt || Number(right.reminder?.added) || right.drawTime || 0;
    return rightTime - leftTime;
  });

  return {
    records,
    joinedCount: records.length,
    pendingNotificationCount: records.filter(record => {
      const reminder = record.reminder;
      if (!reminder) return false;
      const drawTime = Number(reminder?.drawTime);
      if (!Number.isFinite(drawTime) || drawTime <= 0) return false;
      if (drawTime > Number(now)) return !reminder.nearDrawNotified && !reminder.nearDrawNotifySkippedAt;
      if (reminder.resultNotified || reminder.drawNotified) return false;
      if (reminder.resultCheckedAt && reminder.resultNotifySkippedAt) return false;
      if (!reminder.resultCheckedAt && reminder.drawNotifySkippedAt) return false;
      return true;
    }).length
  };
}

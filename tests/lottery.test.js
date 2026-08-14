import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildLotteryRecords, lotteryNotificationStatus, sanitizeLotteryStorage } from "../extension/shared/lottery.js";

function functionSource(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\n                ${nextName}`, start);
  assert.ok(start >= 0 && end > start, `${name} should be present`);
  return source.slice(start, end).trim();
}

test("lottery records merge participation history with tracked reminders", () => {
  const drawTime = Date.now() + 60000;
  const summary = buildLotteryRecords({
    lottery_reminders: [{
      postUrl: "https://www.nodeseek.com/post-42-1",
      title: "测试抽奖",
      luckyUrl: "https://www.nodeseek.com/lucky?post=999&time=1786809599000&count=1&start=1&duplicate=false&mode=view",
      drawTime,
      nearDrawNotified: true
    }],
    lottery_participation_history: {
      users: {
        "7": {
          username: "tester",
          records: {
            "42": {
              postId: "42",
              postUrl: "https://www.nodeseek.com/post-42-1",
              title: "测试抽奖",
              status: "joined",
              confirmedAt: 123,
              evidence: ["comment", "like"]
            }
          }
        }
      }
    }
  });
  assert.equal(summary.records.length, 1);
  assert.equal(summary.joinedCount, 1);
  assert.equal(summary.pendingNotificationCount, 0);
  assert.deepEqual(summary.records[0].evidence, ["comment", "like"]);
  assert.equal(summary.records[0].notificationStatus, "开奖前提醒已发送");
});

test("untracked ordinary comments are excluded from lottery records", () => {
  const summary = buildLotteryRecords({
    lottery_participation_history: {
      users: {
        "7": {
          records: {
            "99": { postId: "99", title: "普通技术讨论", status: "joined", evidence: ["comment"] }
          }
        }
      }
    }
  });
  assert.equal(summary.records.length, 0);
});

test("reminder-only lotteries are excluded from records and pending counts", () => {
  const summary = buildLotteryRecords({
    lottery_reminders: [{
      postUrl: "https://www.nodeseek.com/post-101-1",
      title: "测试抽奖",
      drawTime: Date.now() + 60000
    }]
  });
  assert.equal(summary.records.length, 0);
  assert.equal(summary.pendingNotificationCount, 0);
});

test("lottery storage cleanup removes legacy non-comment records and reminders", () => {
  const gmStorage = {
    lottery_reminders: [
      { postUrl: "https://www.nodeseek.com/post-201-1" },
      {
        postUrl: "https://www.nodeseek.com/post-202-1",
        title: "测试抽奖",
        luckyUrl: "https://www.nodeseek.com/lucky?post=999&time=1786809599000&count=1&start=1&duplicate=false&mode=view"
      }
    ],
    lottery_participation_history: {
      lastKnownUserId: "7",
      users: {
        "7": {
          records: {
            "201": { postId: "201", status: "joined", evidence: ["like"] },
            "202": { postId: "202", status: "joined", evidence: ["comment"] }
          }
        }
      }
    }
  };
  const result = sanitizeLotteryStorage(gmStorage);
  assert.equal(result.changed, true);
  assert.deepEqual(Object.keys(result.storage.lottery_participation_history.users["7"].records), ["202"]);
  assert.equal(result.storage.lottery_reminders.length, 1);
  assert.match(result.storage.lottery_reminders[0].postUrl, /post-202-/);
});

test("lottery records only show the current account profile", () => {
  const summary = buildLotteryRecords({
    lottery_reminders: [{
      postUrl: "https://www.nodeseek.com/post-302-1",
      title: "当前账号抽奖",
      luckyUrl: "https://www.nodeseek.com/lucky?post=999&time=1786809599000&count=1&start=1&duplicate=false&mode=view"
    }],
    lottery_participation_history: {
      lastKnownUserId: "8",
      users: {
        "7": { records: { "301": { postId: "301", title: "旧账号抽奖", status: "joined", evidence: ["comment"] } } },
        "8": { records: { "302": { postId: "302", title: "当前账号抽奖", status: "joined", evidence: ["comment"] } } }
      }
    }
  });
  assert.deepEqual(summary.records.map(record => record.postId), ["302"]);
});

test("action-only participation is excluded from lottery records", () => {
  const summary = buildLotteryRecords({
    lottery_reminders: [{
      postUrl: "https://www.nodeseek.com/post-102-1",
      title: "测试抽奖",
      drawTime: Date.now() + 60000
    }],
    lottery_participation_history: {
      users: {
        "7": { records: { "102": { postId: "102", title: "测试抽奖", status: "joined", evidence: ["like", "coin"] } } }
      }
    }
  });
  assert.equal(summary.records.length, 0);
  assert.equal(summary.pendingNotificationCount, 0);
});

test("legacy generic comment-history titles are not treated as lotteries", () => {
  const summary = buildLotteryRecords({
    lottery_participation_history: {
      users: {
        "7": {
          records: {
            "100": { postId: "100", title: "抽奖活动", status: "joined", source: "comment-history", evidence: ["comment"] }
          }
        }
      }
    }
  });
  assert.equal(summary.records.length, 0);
});

test("lottery notification status exposes disabled and failed delivery states", () => {
  assert.equal(lotteryNotificationStatus({ nearDrawNotifySkippedAt: 1 }), "开奖前提醒未启用或没有可用渠道");
  assert.equal(lotteryNotificationStatus({ resultNotifyLastError: "timeout" }), "开奖结果通知失败，等待重试");
  assert.equal(lotteryNotificationStatus({ resultNotified: true, resultStatus: "won" }), "开奖结果已通知 · 已中奖");
  assert.equal(lotteryNotificationStatus({ resultCheckedAt: 1, resultStatus: "lost", resultNotifySkippedAt: 2 }), "开奖结果已识别 · 未中奖 · 通知未启用或没有可用渠道");
});

test("official NodeSeek lottery algorithm reproduces the published winner", async () => {
  const source = await readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
  const resolver = source.match(/\/\* LOTTERY_RESULT_RESOLVER_START \*\/([\s\S]*?)\/\* LOTTERY_RESULT_RESOLVER_END \*\//)?.[1];
  assert.ok(resolver, "official lottery result resolver should be present");
  const helpers = new Function(`${resolver}; return { parseOfficialLotteryInfo, officialLotteryIndices, selectOfficialLotteryWinners, identifyOfficialLotteryResult };`)();
  const info = helpers.parseOfficialLotteryInfo("https://www.nodeseek.com/lucky?post=871732&time=1786630942000&count=1&start=1&duplicate=false&mode=view");
  const floors = Array.from({ length: 107 }, (_, floor) => ({ member_id: floor + 1000, member_name: `user-${floor}`, floor_id: floor }));
  floors[56] = { member_id: 60179, member_name: "alex0808", floor_id: 56 };
  const winners = helpers.selectOfficialLotteryWinners(floors, info, "79c12989cf17789b14b3d53e800f608c09a37c2466424a8563006240261aaa04");
  assert.deepEqual(winners, [{ memberId: 60179, username: "alex0808", floor: 56 }]);
  assert.equal(helpers.identifyOfficialLotteryResult(winners, { username: "alex0808" }), "won");
  assert.equal(helpers.identifyOfficialLotteryResult(winners, { memberId: 16143, username: "qh1314" }), "lost");
});

test("recognized lottery results are not counted as pending when delivery is disabled", () => {
  const summary = buildLotteryRecords({
    lottery_reminders: [{
      postUrl: "https://www.nodeseek.com/post-871732-1",
      title: "抽奖帖",
      luckyUrl: "https://www.nodeseek.com/lucky?post=999&time=1786630942000&count=1&start=1&duplicate=false&mode=view",
      drawTime: Date.now() - 60000,
      resultCheckedAt: Date.now(),
      resultStatus: "lost",
      resultNotifySkippedAt: Date.now(),
      winners: [{ memberId: 60179, username: "alex0808", floor: 56 }]
    }],
    lottery_participation_history: {
      lastKnownUserId: "16143",
      users: {
        "16143": { records: { "871732": { postId: "871732", title: "抽奖帖", status: "joined", evidence: ["comment"] } } }
      }
    }
  });
  assert.equal(summary.pendingNotificationCount, 0);
  assert.match(summary.records[0].notificationStatus, /开奖结果已识别 · 未中奖/);
});

test("front and back lottery views render stored winners", async () => {
  const [content, options] = await Promise.all([
    readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8"),
    readFile(new URL("../extension/options/options.js", import.meta.url), "utf8")
  ]);
  assert.match(content, /reminder\.winners = result\.winners/);
  assert.match(content, /needsResultBackfill/);
  assert.match(content, /开奖结果通知失败/);
  assert.match(content, /中奖者：/);
  assert.match(options, /lottery-winner-list/);
  assert.match(options, /winner\.floor/);
});

test("forum participation confirmation creates a tracked reminder", async () => {
  const source = await readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
  assert.match(source, /confirmedEvidence\.includes\("comment"\)/);
  assert.match(source, /pendingCommentSubmission/);
  assert.match(source, /matchingUserCommentCount\(details\) > pendingCommentSubmission\.commentCount/);
  assert.match(source, /hasUserCommentAfter\(details, clearedAt\)/);
  assert.match(source, /parseCommentTimeValue/);
  assert.match(source, /comment-after-clear/);
  const stopMonitor = source.match(/function stopParticipationMonitor\(\) \{[\s\S]*?\n                \}/)?.[0] || "";
  assert.doesNotMatch(stopMonitor, /savePendingCommentSubmission\(null\)/);
  assert.match(source, /"comment-submit"/);
  assert.doesNotMatch(source, /syncParticipationHistory/);
  assert.doesNotMatch(source, /mergeCommentHistory/);
  assert.match(source, /const reminders = commentBackedReminders\(\)/);
  assert.match(source, /saveLotteryDetails\(\{ \.\.\.details, participatedAt: next\.confirmedAt \}\)/);
  assert.match(source, /__NSPRO_SEND_LOTTERY_NOTIFICATION/);
  assert.match(source, /openLotterySettings/);
});

test("lottery detection ignores sidebar lucky links and unrelated post text", async () => {
  const source = await readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
  assert.match(source, /function extractLuckyUrl\(html, expectedPostId = null\)/);
  assert.match(source, /linkedPostId !== expected/);
  assert.match(source, /if \(!\/\^\\d\+\$\/\.test\(linkedPostId\)\) return null/);
  assert.match(source, /function lotteryTextFromRoot\(root\)/);
  assert.match(source, /root\?\.querySelector\?\.\(":scope > \.post-content,\.post-content"\)/);
  assert.match(source, /function lotteryTitleMatches\(value\)/);
  assert.match(source, /const contentNode = lotteryContentNode\(root\)/);
  assert.match(source, /const luckyUrl = extractLuckyUrl\(contentNode\?\.outerHTML \|\| ""\)/);
  assert.match(source, /if \(!lotteryTitleMatches\(title\)\) return null/);
  assert.match(source, /if \(!luckyUrl\) return null/);
  assert.match(source, /return detectLottery\(root, canonicalPostUrl\(location\.href\)\)/);
  assert.match(source, /\|\| "未命名帖子"/);
  assert.doesNotMatch(source, /extractLuckyUrl\(document\.documentElement\.outerHTML/);
  const detectLottery = source.match(/function detectLottery\(root, explicitPostUrl\) \{[\s\S]*?\n                \}/)?.[0] || "";
  assert.match(detectLottery, /extractLuckyUrl\(contentNode\?\.outerHTML \|\| ""\)/);
  assert.doesNotMatch(detectLottery, /extractLuckyUrl\([^\n]*postId/, "detection must allow lucky links that point to another post");
});

test("home page lottery markers verify candidate post bodies asynchronously", async () => {
  const source = await readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
  assert.match(source, /const lotteryListValidationCache = new Map\(\)/);
  assert.match(source, /const LOTTERY_LIST_VALIDATION_CONCURRENCY = 6/);
  assert.match(source, /LOTTERY_LIST_CACHE_KEY/);
  assert.match(source, /readLotteryListCache\(\)/);
  assert.match(source, /writeLotteryListCache\(\)/);
  assert.match(source, /const reminder = findReminder\(key\)/);
  assert.match(source, /reminder\?\.luckyUrl && lotteryTitleMatches\(reminder\.title\)/);
  assert.match(source, /function lotteryRootPriority\(root\)/);
  assert.match(source, /function validateLotteryListPost\(postUrl, postId, priority = 0\)/);
  assert.match(source, /fetchFirstPageLotteryDetails\(postUrl, false\)/);
  assert.match(source, /\? await compareLotteryDrawTimeSources\(luckyUrl, text\)/);
  assert.match(source, /: resolveLotteryDrawTime\(luckyUrl, text\)/);
  assert.match(source, /if \(!postId \|\| !lotteryTitleMatches\(title\)\)/);
  assert.match(source, /const details = cachedLotteryListDetails\(postId\)/);
  assert.match(source, /validateLotteryListPost\(postUrl, postId, lotteryRootPriority\(root\)\)/);
});

test("lottery records require both a lottery title and a lucky link", () => {
  const history = {
    lastKnownUserId: "7",
    users: {
      "7": {
        records: {
          "401": { postId: "401", title: "只有标题的抽奖", status: "joined", evidence: ["comment"] },
          "402": { postId: "402", title: "普通帖子", status: "joined", evidence: ["comment"] },
          "403": { postId: "403", title: "有效抽奖", status: "joined", evidence: ["comment"] }
        }
      }
    }
  };
  const summary = buildLotteryRecords({
    lottery_participation_history: history,
    lottery_reminders: [
      { postUrl: "https://www.nodeseek.com/post-401-1", title: "只有标题的抽奖" },
      { postUrl: "https://www.nodeseek.com/post-402-1", title: "普通帖子", luckyUrl: "https://www.nodeseek.com/lucky?post=999" },
      { postUrl: "https://www.nodeseek.com/post-403-1", title: "有效抽奖", luckyUrl: "https://www.nodeseek.com/lucky?post=999" }
    ]
  });
  assert.deepEqual(summary.records.map(record => record.postId), ["403"]);
});

test("lottery comment times support NodeSeek relative time combinations", async () => {
  const source = await readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
  const functionSource = source.match(/function parseCommentTimeValue\(value, now = Date\.now\(\)\) \{[\s\S]*?\n                \}/)?.[0];
  assert.ok(functionSource, "parseCommentTimeValue should be present");
  const parseCommentTimeValue = new Function("normalizeLotteryText", `return (${functionSource})`)(value => String(value || "").replace(/\s+/g, " ").trim());
  const now = Date.parse("2026-08-13T05:00:00.000Z");
  assert.equal(parseCommentTimeValue("刚刚", now), now);
  assert.equal(parseCommentTimeValue("23秒前", now), now - 23_000);
  assert.equal(parseCommentTimeValue("1小时42分钟前", now), now - 6_120_000);
  assert.equal(parseCommentTimeValue("2天3小时5分钟前", now), now - 183_900_000);
  assert.equal(parseCommentTimeValue("2026-08-13T04:30:00.000Z", now), Date.parse("2026-08-13T04:30:00.000Z"));
});

test("lottery draw times compare link, lucky page and post sources", async () => {
  const source = await readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
  const getDrawTime = new Function(`return (${functionSource(source, "getDrawTime", "const normalizeLotteryText")})`)();
  const compareLotteryDrawTimes = new Function(`return (${functionSource(source, "compareLotteryDrawTimes", "function resolveLotteryDrawTime")})`)();
  const luckyUrl = "https://www.nodeseek.com/lucky?post=870988&time=1786809599000&count=5&start=1&duplicate=false&mode=view";
  const linkTime = getDrawTime(luckyUrl);
  assert.equal(linkTime, 1786809599000);
  assert.equal(new Date(linkTime).toISOString(), "2026-08-15T15:59:59.000Z");

  const same = compareLotteryDrawTimes(linkTime, linkTime, linkTime);
  assert.equal(same.drawTime, linkTime);
  assert.equal(same.drawTimeSource, "link");
  assert.equal(same.drawTimeConflict, false);

  const conflictingPostTime = linkTime + 3600000;
  const conflict = compareLotteryDrawTimes(linkTime, linkTime, conflictingPostTime);
  assert.equal(conflict.drawTime, linkTime);
  assert.equal(conflict.drawTimeSource, "link");
  assert.equal(conflict.drawTimeConflict, true);

  const pageFallback = compareLotteryDrawTimes(null, linkTime, conflictingPostTime);
  assert.equal(pageFallback.drawTime, linkTime);
  assert.equal(pageFallback.drawTimeSource, "luckyPage");
});

test("lottery post parser preserves seconds and old reminders are enriched", async () => {
  const source = await readFile(new URL("../extension/content/nodeseek-max.js", import.meta.url), "utf8");
  const parser = source.match(/\/\* LOTTERY_TIME_PARSER_START \*\/([\s\S]*?)\/\* LOTTERY_TIME_PARSER_END \*\//)?.[1];
  assert.ok(parser, "lottery time parser should be present");
  const parseLotteryDrawTime = new Function(`${parser}; return parseLotteryDrawTime;`)();
  const parsed = parseLotteryDrawTime("开奖时间：2026-08-15 23:59:59", Date.parse("2026-08-12T12:00:00.000Z"));
  assert.equal(parsed, 1786809599000);
  assert.match(source, /compareLotteryDrawTimeSources\(luckyUrl, text\)/);
  assert.match(source, /fetchLuckyPageDrawTime\(luckyUrl\)/);
  assert.match(source, /refreshStoredLotteryDetails\(\)/);
  assert.match(source, /filter\(reminder => !reminder\.drawTimeCheckedAt \|\| !reminder\.luckyUrl \|\| !reminder\.drawTime\)/);
});

test("options lottery records expose all three compared time sources", async () => {
  const options = await readFile(new URL("../extension/options/options.js", import.meta.url), "utf8");
  assert.match(options, /\["链接参数", drawCandidates\.link\]/);
  assert.match(options, /\["开奖页", drawCandidates\.luckyPage\]/);
  assert.match(options, /\["帖子正文", drawCandidates\.post\]/);
  assert.match(options, /三处对比：/);
});

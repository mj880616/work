import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// OPS-수집점검원본맞추기: the home 수집 점검 thresholds must stay consistent with the real schedules kept in this repo.
const mod = await import('../app/collection-status.js');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('heartbeat script runs hourly and the "signal cut" threshold leaves room for hourly-trigger jitter', () => {
  assert.match(read('docs/ops/collector-heartbeat.gs'), /web2Heartbeat_send'\)\.timeBased\(\)\.everyHours\(1\)/);
  // An hourly Apps Script trigger fires at any minute of the hour: consecutive runs can be almost 2h apart.
  assert.ok(mod.SILENT_HOURS >= 2.5, 'below ~2h would warn on a healthy hourly trigger');
});

test('Drive copy threshold covers the longest gap between the scheduled refreshes', () => {
  const yml = read('.github/workflows/drive-summary-refresh.yml');
  const times = [...yml.matchAll(/cron: '(\d+) (\d+) \* \* \*'/g)].map(m => Number(m[2]) * 60 + Number(m[1])).sort((a, b) => a - b);
  assert.ok(times.length >= 2, 'at least two daily refreshes');
  const gaps = times.map((t, i) => (times[(i + 1) % times.length] - t + 1440) % 1440 || 1440);
  const longestHours = Math.max(...gaps) / 60;
  assert.equal(longestHours, 17);
  assert.ok(mod.STALE_HOURS.copy > longestHours, 'a normal longest gap must not read as stale');
  assert.ok(mod.STALE_HOURS.copy < 2 * longestHours, 'one fully missed day must still be caught');
});

test('collector lines stay quiet through weekends and holidays; only a stall past the long limit warns (OPS-수집멈춤알림)', () => {
  const now = Date.parse('2026-10-26T09:00:00Z'), H = 3600000, iso = ms => new Date(ms).toISOString();
  for (const key of ['telegram', 'call']) {
    const raw = {at:iso(now - (mod.STALE_HOURS[key] + 2) * H), reportedAt:iso(now - 0.5 * H), count:0};
    assert.equal(mod.judgeCollector(key, raw, now).state, 'quiet');
    const long = {at:iso(now - 200 * H), reportedAt:iso(now - 0.5 * H), count:0};
    assert.equal(mod.judgeCollector(key, long, now).state, 'stalled');
  }
  assert.ok(mod.STALL_HOURS.telegram >= 72, 'a 3-day holiday weekend must not warn');
  assert.ok(mod.STALL_HOURS.call >= 120, 'a 5-day holiday without calls must not warn');
  // Daily 07:30 collection (24h apart) stays "ok"; a weekend without calls (Fri evening to Mon evening, 72h) stays "ok".
  assert.ok(mod.STALE_HOURS.telegram > 24);
  assert.ok(mod.STALE_HOURS.call >= 72);
});

test('send lines: silence limits leave room for the real trigger schedules in the feed script', () => {
  const gs = read('docs/ops/collector-feed.gs');
  assert.match(gs, /newTrigger\('tgFeed_run'\)\.timeBased\(\)\.everyHours\(1\)/);
  assert.match(gs, /newTrigger\('callFeed_run'\)\.timeBased\(\)\.everyHours\(1\)/);
  // TG-1시간수집: telegram send runs hourly but rests 00:00-07:00 KST without reporting.
  // Longest healthy gap: a run early in the 23:00 hour to a run late in the 07:00 hour, about 9h. One missed daytime run must still be visible within a day.
  const quiet = Number(/var TG_FEED_QUIET_UNTIL = (\d+);/.exec(gs)[1]) - Number(/var TG_FEED_QUIET_FROM = (\d+);/.exec(gs)[1]);
  assert.equal(quiet, 7);
  assert.ok(mod.SEND_SILENT_HOURS.telegramSend >= quiet + 2, 'night rest plus hourly jitter must not warn');
  assert.ok(mod.SEND_SILENT_HOURS.telegramSend <= 12, 'a stopped hourly sender must warn the same day');
  // Hourly trigger: up to about 2h.
  assert.ok(mod.SEND_SILENT_HOURS.callSend >= 2.5);
  assert.ok(mod.SEND_GAP_HOURS >= 72, 'Friday evening to Monday morning has no business messages');
});

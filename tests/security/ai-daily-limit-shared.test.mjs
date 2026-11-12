import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DAILY_TOTAL_LIMIT, overDailyLimit, readTodayAiUsage, addAiRequest, seoulDay } from '../../supabase/functions/_shared/ai-daily-usage.mjs';

// REC-멈춤띠계속뜸(S60-26b, CC 추가 지시): 하루 요청 수는 ai-assist·meeting-transcribe·meeting-ai-draft·page-ai-draft가
// 같은 서울 날짜·같은 합계 한도(DAILY_TOTAL_LIMIT) 한 곳으로 센다. 작업공간 설정 daily_request_limit(30)·UTC 날짜로 따로 세지 않는다.

const read = p => readFileSync(new URL(`../../supabase/functions/${p}`, import.meta.url), 'utf8');

function fakeAdmin(old = null, { readError = null, writeError = null } = {}) {
  const calls = { filters: [], writes: [] };
  const admin = { from(table) {
    const b = {
      select: () => b,
      eq: (k, v) => { calls.filters.push([k, v]); return b; },
      maybeSingle: async () => ({ data: old, error: readError }),
      upsert: async (row, opts) => { calls.writes.push({ table, row, opts }); return { error: writeError }; },
    };
    return b;
  } };
  return { admin, calls };
}

test('한도 숫자는 한 곳: ai-assist가 공용 값을 그대로 내보낸다', async () => {
  const h = await import('../../supabase/functions/ai-assist/handler.ts');
  assert.equal(DAILY_TOTAL_LIMIT, 80);
  assert.equal(h.DAILY_TOTAL_LIMIT, DAILY_TOTAL_LIMIT);
  assert.doesNotMatch(read('ai-assist/handler.ts'), /DAILY_TOTAL_LIMIT\s*=\s*\d/);
  assert.equal(h.seoulDays(Date.UTC(2026, 10, 11, 16, 30)).day, seoulDay(Date.UTC(2026, 10, 11, 16, 30)));
});

test('한도 판정: 80 미만은 통과, 80부터 멈춤(30·41에서는 멈추지 않음)', () => {
  for (const n of [0, 30, 41, 79]) assert.equal(overDailyLimit(n), false, String(n));
  for (const n of [80, 81]) assert.equal(overDailyLimit(n), true, String(n));
  assert.equal(overDailyLimit(undefined), false);
});

test('읽기는 서울 날짜 행: 한국 01:30(UTC 전날 16:30)에 한국 오늘 행을 본다', async () => {
  const nowMs = Date.UTC(2026, 10, 11, 16, 30);
  const { admin, calls } = fakeAdmin({ requests: 41 });
  const t = await readTodayAiUsage(admin, { workspaceId: 'w', userId: 'u', nowMs });
  assert.equal(t.day, '2026-11-12');
  assert.deepEqual(calls.filters, [['workspace_id', 'w'], ['user_id', 'u'], ['day', '2026-11-12']]);
  assert.equal(t.over, false);
  const full = await readTodayAiUsage(fakeAdmin({ requests: 80 }).admin, { workspaceId: 'w', userId: 'u', nowMs });
  assert.equal(full.over, true);
  const broken = await readTodayAiUsage(fakeAdmin(null, { readError: { code: 'x' } }).admin, { workspaceId: 'w', userId: 'u', nowMs });
  assert.equal(broken.row, null);
});

test('기록은 같은 행에 요청 1·토큰을 더하고 실패해도 던지지 않는다', async () => {
  const { admin, calls } = fakeAdmin();
  const r = await addAiRequest(admin, { workspaceId: 'w', userId: 'u', day: '2026-11-12', row: { requests: 41, advanced_requests: 2, input_tokens: 10, output_tokens: 5 }, usage: { input_tokens: 3, output_tokens: 4 }, nowMs: 0 });
  assert.equal(r, 'recorded');
  assert.deepEqual(calls.writes[0].row, { workspace_id: 'w', user_id: 'u', day: '2026-11-12', requests: 42, advanced_requests: 2, input_tokens: 13, output_tokens: 9, updated_at: new Date(0).toISOString() });
  assert.deepEqual(calls.writes[0].opts, { onConflict: 'workspace_id,user_id,day' });
  assert.equal(await addAiRequest(fakeAdmin(null, { writeError: { code: 'x' } }).admin, { workspaceId: 'w', userId: 'u', day: 'd', row: null }), 'failed');
});

test('녹음 요약·회의 초안·페이지 초안은 공용 판정만 쓴다(UTC 날짜·daily_request_limit 없음)', () => {
  for (const f of ['meeting-transcribe/index.ts', 'meeting-ai-draft/index.ts', 'page-ai-draft/index.ts']) {
    const src = read(f);
    assert.match(src, /import \{ addAiRequest, readTodayAiUsage \} from '\.\.\/_shared\/ai-daily-usage\.mjs';/, f);
    assert.match(src, /readTodayAiUsage\(admin,/, f);
    assert.match(src, /addAiRequest\(admin,/, f);
    assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /daily_request_limit/, f);
    assert.doesNotMatch(src, /new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/, f);
    assert.doesNotMatch(src, /from\('app_ai_daily_usage'\)\.upsert/, f);
  }
  assert.match(read('meeting-transcribe/index.ts'), /if \(today\.over\) throw new Fail\('daily_limit'\);/);
});

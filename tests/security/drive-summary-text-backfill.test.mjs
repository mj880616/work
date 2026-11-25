import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
// S70-29 APP-일회용기능정리(2026-11-25 명진 '다 없애 1회용 기능', 조사 문서 14번 '예'): LIB-글자채우기야간을 지웠다.
// 밤 글자 읽기(text_backfill)·홈 알림 닫기(text_backfill_dismiss)는 410 GONE — 사본 다시 만들기·DB·Drive로 흐르지 않는다.
const {createHandler} = await import('../../supabase/functions/drive-summary/core.mjs');
const exists = p => existsSync(new URL('../../' + p, import.meta.url));
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('text_backfill·text_backfill_dismiss: 어떤 자격으로도 410, 바깥 요청 0', async () => {
  const calls = [];
  const fetcher = async (...args) => { calls.push(String(args[0])); throw new Error('no network in this test'); };
  const handler = createHandler({env: {SUPABASE_URL: 'https://synthetic.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', DRIVE_SUMMARY_CRON_SECRET: 'synthetic-cron-secret-000000000000'}, fetcher});
  for (const action of ['text_backfill', 'text_backfill_dismiss']) {
    for (const headers of [{'x-drive-summary-cron-secret': 'synthetic-cron-secret-000000000000'}, {Authorization: 'Bearer synthetic-user'}, {}]) {
      const res = await handler(new Request(`https://synthetic.supabase.test/functions/v1/drive-summary?action=${action}`, {method: 'POST', headers}));
      assert.equal(res.status, 410, `${action} ${Object.keys(headers)}`);
      assert.deepEqual(await res.json(), {ok: false, error: 'GONE'});
    }
  }
  assert.deepEqual(calls, [], 'no DB/Drive/Auth call');
});

test('지운 파일·주소: 밤 작업·스크립트·순수 로직·홈 알림이 없고, 상태 응답에 text_backfill 칸이 없다', () => {
  for (const f of ['supabase/functions/drive-summary/text-backfill.mjs', '.github/workflows/library-text-nightly.yml', 'scripts/ops/library-text-nightly.mjs', 'app/text-backfill-notice.js']) assert.equal(exists(f), false, f);
  const core = read('supabase/functions/drive-summary/core.mjs');
  assert.doesNotMatch(core, /text_backfill: |textBackfillStatus|runTextBackfill|createTextReader/);
  assert.doesNotMatch(read('supabase/functions/drive-summary/index.ts'), /createDocumentText|createTextReader/);
  const profile = read('app/profile-status.js');
  assert.doesNotMatch(profile, /text-backfill-notice|data-ps-text-done/);
  assert.doesNotMatch(read('app/home-quick.css'), /home-text-done|text-done-/);
  // 남는 것: 화면 글자 읽기 길, 다른 밤 작업(이전 파일 정리)은 그대로
  assert.equal(exists('app/document-text-read.js'), true);
  assert.equal(exists('.github/workflows/library-prev-prune.yml'), true);
  assert.match(core, /actionOf\(req\) === 'library_prev_prune'/);
});

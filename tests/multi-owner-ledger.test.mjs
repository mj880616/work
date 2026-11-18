import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// MULTI-다른담당자맞춤 ④: 원장·사본·수집 기능 4곳은 작업공간 이름(고정 이름)으로 켜지 않는다.
// 원장 자동 기록은 '내 작업공간 owner'면 켜지고(서버·DB가 owner를 다시 봄), Drive 사본은 서버 답(403)으로, 수집 줄은 서버 운영자 기능으로 정한다.
const files = ['app/ledger-auto.js', 'app/ledger-export.js', 'app/drive-summary.js', 'app/collection-status.js', 'app/ai-usage-line.js', 'app/text-backfill-notice.js'];

test('네 곳 모두 작업공간 이름으로 판정하지 않는다', async () => {
  for (const f of files) {
    const src = await readFile(new URL('../' + f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /workspace\?\.slug|slug\s*={2,3}|'kptu-work'/, f);
  }
});

test('원장 자동 기록은 owner 판정, 사본은 403이면 이 로그인 동안 끔, 수집 줄은 서버 운영자 기능', async () => {
  const read = f => readFile(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(await read('app/ledger-auto.js'), /c\?\.membership\?\.role === 'owner'/);
  for (const f of ['app/ledger-export.js', 'app/drive-summary.js']) assert.match(await read(f), /status\)\s*===\s*403\)\s*denied\s*=\s*scopeOf\(\)/, f);
  const status = await read('app/collection-status.js');
  assert.match(status, /import \{myFeatures\} from '\.\/my-features\.js'/);
  assert.match(status, /const COLLECT_FEATURES = \['calls', 'telegram'\]/);
  for (const f of ['app/ai-usage-line.js', 'app/text-backfill-notice.js']) assert.match(await read(f), /await isOperator\(rt\)/, f);
});

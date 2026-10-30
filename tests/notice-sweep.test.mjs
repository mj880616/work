// UI-알림창정리 (2026-10-28 명진 요청): 브라우저 기본 알림창(alert/confirm)은 공용 작은 알림·작은 확인창(app/small-notice.js)으로 옮긴다.
// 아직 남은 곳은 아래 기준표에 파일별 개수로 묶어 두고, 늘어나거나 새 파일에 생기면 실패한다(줄어들면 기준표를 낮춘다).
// 남긴 이유(PR 본문 표와 같음): 화면 이동을 바로 막아야 하는 '쓰던 내용 버릴까요' 확인(동기 흐름), 시험 대량 수정이 필요한 삭제 확인(다음 묶음),
// 자료실 지우기 흐름(PR A가 같이 정리), 옛 파일(legacy).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const APP = fileURLToPath(new URL('../app/', import.meta.url));
const SKIP = ['hwp-lab/', 'editor-lib/', 'pdf-lib/', 'markdown-lib/'];
const BASELINE = {
  'basket-manual-link.js': 3, 'basket-notes.js': 4, 'basket-record-delete.js': 1, 'basket.js': 10,
  'call-feed.js': 2, 'diary.js': 4, 'document-category-editor.js': 1, 'od-settings.js': 1, 'document-delete.js': 6,
  'google-tasks.js': 2, 'home-quick.js': 1, 'hwp-lab.js': 7, 'journal-hwpx.js': 3, 'ledger-browse.js': 2,
  'legacy/meeting-detail-patches.js': 2, 'library-upload.js': 2, 'meeting-round-detail.js': 3,
  'profile-settings.js': 1, 'project-system-v3.js': 7, 'reference-bundles.js': 1, 'share-pages.js': 5,
  'task-inline.js': 1, 'task-layout.js': 1, 'team.js': 1, 'telegram-feed.js': 1, 'trash-actions.js': 1, 'version-notice.js': 1,
  'workplace-detail.js': 7,
};
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
export function countNative(source) {
  const calls = source.match(/(?<![\w.$])(?:window\.|globalThis\.)?(?:alert|confirm)\(/g) || [];
  const own = source.match(/(?:function|async)\s+confirm\(/g) || [];
  return calls.length - own.length;
}

test('브라우저 기본 알림창은 기준표보다 늘지 않는다', () => {
  const over = [];
  for (const path of walk(APP)) {
    const rel = relative(APP, path).split('\\').join('/');
    if (!rel.endsWith('.js') || SKIP.some(prefix => rel.startsWith(prefix))) continue;
    const count = countNative(readFileSync(path, 'utf8'));
    if (count > (BASELINE[rel] ?? 0)) over.push(`${rel}: ${count} > ${BASELINE[rel] ?? 0}`);
  }
  assert.deepEqual(over, [], '새 alert/confirm 대신 app/small-notice.js의 notify/askConfirm을 쓴다');
});

test('세는 규칙: 직접 만든 confirm 함수의 정의 줄은 빼고 센다(그 함수를 부르는 곳은 기준표에 포함)', () => {
  assert.equal(countNative("if(!window.confirm('a'))return;alert('b');"), 2);
  assert.equal(countNative('async function confirm(){} void confirm();'), 1);
  assert.equal(countNative("x.confirm('a');askConfirm(el,{text:'a'})"), 0);
});

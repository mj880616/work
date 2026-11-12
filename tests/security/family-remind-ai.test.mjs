// FAMILY-기억알림: 가족 노트 줄을 돌아가며 보여 주는 칸·[과거 기록으로]가 가족 내용을 AI 재료·원장·주간보고 길로 넘기지 않는지 지키는 고정 장치.
// - 새 '과거 기록' 노트는 AI 제외(ai_export_allowed=false)로만 만든다. 줄을 옮기는 쓰기는 AI 제외 노트에만 적용된다(saveNoteDoc aiExcluded → ai_export_allowed=is.false 조건).
// - 칸·메뉴 파일은 AI·원장·주간보고·업무일지·내보내기 모듈을 부르지 않는다. 본 기록에는 글을 저장하지 않는다(열쇠만 — 모델 시험).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root = new URL('../../', import.meta.url).pathname;
const read = f => readFileSync(root + f, 'utf8');

test('칸·메뉴·규칙 파일은 AI·원장·주간보고·업무일지·내보내기 길을 부르지 않는다', () => {
  for (const f of ['app/family-remind.js', 'app/family-remind-menu.js', 'app/family-remind-model.mjs']) {
    assert.doesNotMatch(read(f), /ai-assist|basket-ai|weekly|ledger|journal-data|journal-hwpx|\/export|functions\/v1|rpc\//i, f);
  }
});

test('[과거 기록으로]는 AI 제외 노트로만 만들고, 줄을 옮기는 쓰기는 AI 제외 노트에만 한다', () => {
  const src = read('app/family-note-send.js');
  const move = src.slice(src.indexOf('export async function moveToPast'), src.indexOf('export async function undoPast'));
  assert.match(move, /createNoteDoc\(\{title: PAST_TITLE[^}]*ai_export_allowed: false[^)]*family_past: true/);
  assert.match(move, /ai_export_allowed=is\.false/, '이미 있는 과거 기록 노트도 AI 제외 노트만 고른다');
  assert.match(move, /appendToNote\(rt, past\.id, \{lines: \[line\]\}\)/, 'appendToNote 기본 familyOnly(가족 노트에만)');
  const rewrite = src.slice(src.indexOf('async function rewriteFamilyNote'), src.indexOf('export async function moveToPast'));
  assert.match(rewrite, /ai_export_allowed !== false\) throw/);
  assert.match(rewrite, /aiExcluded: true/);
  assert.match(read('app/basket-data.js'), /aiExcluded \? '&ai_export_allowed=is\.false' : ''/);
});

test('본 기록 쓰기는 가족 잊지 말기 노트에만, updated_at은 그대로(다른 metadata 칸 지키며)', () => {
  const src = read('app/basket-data.js');
  const fn = src.slice(src.indexOf('export function setNoteRemind'), src.indexOf('// NOTE-보드여러개: 이름 붙은 보드에'));
  assert.match(fn, /patchNoteMetadata/);
  assert.match(fn, /metadata\.family_list !== true\) return null/);
  assert.doesNotMatch(fn, /updated_at/);
});

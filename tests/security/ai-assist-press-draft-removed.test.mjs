// PRESS-성명초안삭제(2026-11-09 명진 결정): 성명·보도자료 초안 기능은 화면·서버 모두 없다.
// 서버 ai-assist는 kind=press_draft를 알아보지 않고(unsupported_kind로 거절), 화면에는 초안 창·입구가 없다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';

const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('ai-assist has no press_draft route and no press draft modules', () => {
  const h = read('supabase/functions/ai-assist/handler.ts');
  assert.doesNotMatch(h, /kind === "press_draft"|runPressDraft|press-draft\.ts|press_draft:\s*\d/);
  for (const f of ['supabase/functions/ai-assist/press-draft.ts', 'supabase/functions/ai-assist/press-style.ts', 'app/press-draft.js', 'app/press-draft-model.mjs', 'app/press-quotes.mjs', 'app/press-draft.css']) {
    assert.equal(existsSync(new URL('../../' + f, import.meta.url)), false, f);
  }
});

test('no screen entry opens a press draft; shared page AI draft keeps its own style file', () => {
  for (const f of ['app/meeting-round-detail.js', 'app/basket-notes.js', 'app/outside-search.js']) {
    const s = read(f);
    assert.doesNotMatch(s, /press-draft|press-quotes|data-mrd-more="press"|성명 초안 만들기'|'성명·보도자료 초안'|초안에 쓰기'/, f);
  }
  const share = read('app/share-ai-draft.js');
  assert.match(share, /share-ai-draft\.css/);
  assert.doesNotMatch(share, /press-draft/);
  assert.match(read('app/share-ai-draft.css'), /^\.share-ai-draft\{/m);
});

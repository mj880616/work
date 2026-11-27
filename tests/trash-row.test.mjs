import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trashRowHtml, trashListOpen, trashPickHeadHtml, trashPickBarHtml, TRASH_ROW_ICON} from '../app/trash-row.js';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('보통 줄: 제목·날짜 + 그림 단추 둘(글자·테두리 칸·⋯ 없음), 이름은 aria-label', () => {
  const h = trashRowHtml({id: 'a<1', name: '제목 <b>', whenText: '2026. 11. 1.', whenIso: '2026-11-01T00:00:00Z'});
  assert.match(h, /data-tr-row="a&lt;1"/);
  assert.match(h, /data-tr-restore="a&lt;1"[^>]*aria-label="되살리기: 제목 &lt;b&gt;"/);
  assert.match(h, /data-tr-purge="a&lt;1"[^>]*aria-label="영구 삭제: 제목 &lt;b&gt;"/);
  assert.doesNotMatch(h, /<details|more-dots|⋯|>되살리기<|>영구 삭제</);
  assert.equal((h.match(/<svg/g) || []).length, 2);
  assert.match(h, /width="17" height="17"/);
  assert.ok(TRASH_ROW_ICON.restore && TRASH_ROW_ICON.purge);
});

test('할 수 없는 일의 그림 단추는 그리지 않는다(영구 삭제 길이 없는 휴지통)', () => {
  const h = trashRowHtml({id: 'x', name: 'n', canPurge: false});
  assert.match(h, /data-tr-restore/);
  assert.doesNotMatch(h, /data-tr-purge/);
  assert.match(trashRowHtml({id: 'x', name: 'n', busy: true}), /data-tr-restore="x"[^>]*disabled/);
});

test('고르기 줄: 그림 단추를 숨기지 않고 아예 다른 줄을 그린다(동그라미 체크·aria-selected)', () => {
  const on = trashRowHtml({id: 'x', name: 'n', picking: true, picked: true});
  assert.match(on, /class="tr-row tr-pick is-picked"[^>]*role="option" aria-selected="true"/);
  assert.match(on, /tr-check/);
  assert.doesNotMatch(on, /data-tr-restore|data-tr-purge|<button/);
  assert.match(trashRowHtml({id: 'x', name: 'n', picking: true}), /aria-selected="false"/);
  assert.match(trashListOpen('목록', true), /role="listbox" aria-multiselectable="true"/);
  assert.match(trashListOpen('목록', false), /role="list"/);
});

test('위쪽 [전체 선택]·[취소], 아래 막대 \'N개 선택 · 되살리기 · 영구 삭제\'', () => {
  assert.match(trashPickHeadHtml({total: 3, picked: 3}), /data-tr-all[^>]*role="checkbox" aria-checked="true">전체 선택<[\s\S]*data-tr-cancel>취소</);
  assert.match(trashPickHeadHtml({total: 3, picked: 1}), /aria-checked="false"/);
  const bar = trashPickBarHtml({picked: 2});
  assert.match(bar, />2개 선택</);
  assert.ok(bar.indexOf('되살리기') < bar.indexOf('영구 삭제'));
  assert.match(bar, /data-tr-bulk-purge[^>]*>/);
  assert.doesNotMatch(bar, /영구 삭제[\s\S]*되살리기/);
  assert.match(trashPickBarHtml({picked: 0}), /data-tr-bulk-restore disabled/);
  assert.doesNotMatch(trashPickBarHtml({picked: 2, canPurge: false}), /영구 삭제/);
});

test('두 휴지통이 같은 공용 부품을 쓰고, 옛 글자 단추·⋯ 칸·display:none 땜질이 없다', () => {
  for (const f of ['app/note-trash.js', 'app/files-trash.js']) {
    const code = read(f).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.match(code, /from '\.\/trash-row\.js'/, f);
    assert.doesNotMatch(code, /nxt-more|more-dots|<details|display\s*:\s*none/, f);
  }
  const css = read('app/trash-row.css');
  assert.doesNotMatch(css, /display\s*:\s*none/);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /font-size\s*:\s*[\d.]+px|height\s*:\s*[\d.]+px/, 'px 직접값 없음(--ds-* 기준값만)');
});

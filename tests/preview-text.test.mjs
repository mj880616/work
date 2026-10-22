import test from 'node:test';
import assert from 'node:assert/strict';
import {previewText,decodeEntities,markdownSource,plainLines} from '../app/note-preview.mjs';
// BUG-미리보기기호: the one preview-line function (headings, tables, lists, bold, entities, escapes) used by every record row.

test('headings, list marks, bold, quotes and rules become plain letters', () => {
  assert.equal(previewText('### 회의 결과\n- **합의** 사항\n1. 다음 주\n> 인용\n---\n끝'), '회의 결과 합의 사항 1. 다음 주 인용 끝');
});
test('table rows lose pipes and dividers; cells are joined with " · "', () => {
  assert.equal(previewText('### 제목\n| 일시 | 위치·장소 |\n|---|:---:|\n| 10/21 | **본사** |'), '제목 일시 · 위치·장소 10/21 · 본사');
  assert.equal(previewText('### 제목 | 일시 | 장소 | --- | --- | 본사'), '제목 · 일시 · 장소 · 본사');
});
test('AI-pasted escapes and HTML entities turn into their letters', () => {
  assert.equal(previewText('2026\\.&#x20;10\\.&#x20;21\\.'), '2026. 10. 21.');
  assert.equal(previewText('A &amp; B&nbsp;C &lt;D&gt; &#35;1'), 'A & B C <D> #1');
  assert.equal(decodeEntities('&unknown; &#x110000; &#xD800;'), '&unknown; &#x110000; &#xD800;');
});
test('fenced code keeps its words; the cut adds … only when longer; empty stays empty', () => {
  assert.equal(previewText('```js\nlet a = 1\n```'), 'let a = 1');
  assert.equal(previewText('가'.repeat(130), 120), '가'.repeat(120) + '…');
  assert.equal(previewText(null), '');
  assert.deepEqual(plainLines('|---|---|'), []);
});
test('markdownSource is returned only when the line removed marks', () => {
  assert.equal(markdownSource('그냥 글\n두 줄'), '');
  assert.equal(markdownSource('### 제목\n본문'), '### 제목\n본문');
  assert.equal(markdownSource('가'.repeat(30000) + '**x**'), '');
});

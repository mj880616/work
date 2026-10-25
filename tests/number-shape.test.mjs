import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
// EDIT-번호모양보존: 손으로 쓴 "1) 2)"·"(1)"·"①"·"가."·들여쓰기·빈 줄이 보기 화면과 저장 변환에서 바뀌지 않는다.
// 같은 번호 모양(ORDER_MARKERS: decimal "1." / paren "1)" / parens "(1)" / circled "①" / hangul "가.")을 편집기·보기·내보내기가 함께 쓴다.
const pin = JSON.parse(readFileSync('scripts/markdown/md-pin.json', 'utf8'));
const {default: MarkdownIt} = await import(`../${pin.folder}/markdown-it-${pin.packages['markdown-it'].version}/markdown-it.esm.min.mjs`);
const {createMarkdown, renderMarkdown} = await import('../app/markdown-render.mjs');
const {markdownSource, hasMarkdownMarks, writtenText, recordLines, firstLineOf} = await import('../app/note-preview.mjs').then(m => ({...m, firstLineOf: text => m.plainLines(text)[0]}));
const {markdownToDoc, plainToDocKeep} = await import('../app/ed-markdown.mjs');
const {toPlain, toTelegram, toHangul} = await import('../app/ed-text.mjs');
const {orderedLabel, ORDER_MARKERS} = await import('../app/ed-schema.mjs');
const md = createMarkdown(MarkdownIt);

// 명진 10/26: 메트로9호선노동조합 임단협 결렬 경과 기록 모양(번호 단계 1. → 1) → (1) → ①).
const UNION = [
  '1. 경과',
  '  1) 10.14 본교섭',
  '    (1) 임금 인상률',
  '      ① 사측 제시안',
  '      ② 노조 요구안',
  '',
  '2. 노조 주요 요구안',
  '  1) 임금교섭',
  '  2) 보충교섭',
  '',
  '',
  '  가. 별도 안건',
].join('\n');

test('a hand-written text with only numbers and indentation is not markdown: it is shown as written', () => {
  assert.equal(hasMarkdownMarks(UNION), false);
  assert.equal(markdownSource(UNION), '');
  assert.equal(recordLines(UNION), UNION);
  assert.equal(recordLines('1) 하나\n2) 둘\n- 셋\n  (1) 넷'), '1) 하나\n2) 둘\n- 셋\n  (1) 넷');
});
test('writtenText keeps indentation, number shapes and blank lines; only line ends and the very start and end are tidied', () => {
  assert.equal(writtenText('\n\n  1) 하나  \r\n\r\n    (1) 둘\t\n\n'), '  1) 하나\n\n    (1) 둘');
  assert.equal(writtenText(null), '');
});
test('a text with real markdown marks keeps the marks-removed lines in the closed preview', () => {
  assert.equal(hasMarkdownMarks('## 제목\n1) 하나'), true);
  assert.equal(recordLines('## 제목\n- **하나**'), '제목\n하나');
});
test('markdown "1)" lists keep the ")" shape; "1." lists and start numbers are untouched', () => {
  const paren = renderMarkdown(md, '2. 노조 주요 요구안\n\n1) 임금교섭\n2) 보충교섭').html;
  assert.match(paren, /<ol start="2">\s*<li>노조 주요 요구안<\/li>\s*<\/ol>/);
  assert.match(paren, /<ol class="md-ol-paren">\s*<li>임금교섭<\/li>\s*<li>보충교섭<\/li>/);
  const dot = renderMarkdown(md, '1. 하나\n2. 둘').html;
  assert.doesNotMatch(dot, /md-ol-paren/);
  assert.match(renderMarkdown(md, '3) 셋\n4) 넷').html, /<ol start="3" class="md-ol-paren">/);
  const nested = renderMarkdown(md, '1. 경과\n   1) 본교섭\n   2) 결렬').html;
  assert.match(nested, /<ol>\s*<li>경과\s*<ol class="md-ol-paren">/);
});
test('"(1)" "①" "가." lines stay text in the markdown view', () => {
  const html = renderMarkdown(md, '**굵게**\n\n(1) 하나\n② 둘\n가. 셋').html;
  assert.doesNotMatch(html, /<ol|<ul/);
  assert.match(html, /\(1\) 하나/);
});
test('opening a markdown text in the editor saves the written number shape', () => {
  const doc = markdownToDoc(md, '1) 하나\n2) 둘\n\n1. 셋\n2. 넷').doc;
  const lists = doc.content.filter(n => n.type === 'ordered_list');
  assert.deepEqual(lists.map(l => l.attrs.marker), ['paren', 'decimal']);
  assert.equal(toPlain(markdownToDoc(md, '1) 하나\n2) 둘')).trim(), '1) 하나\n2) 둘');
});
test('opening a plain text in the editor keeps every number line as letters', () => {
  const value = plainToDocKeep(UNION);
  assert.equal(toPlain(value).replace(/\n\n/g, '\n').includes('1) 임금교섭'), true);
  assert.equal(value.doc.content.some(n => n.type === 'ordered_list' || n.type === 'bullet_list'), false);
});
test('every editor number shape reads back the same through the export text (plain, telegram, hangul)', () => {
  for (const marker of ORDER_MARKERS) {
    const doc = {v: 'ed1', doc: {type: 'doc', content: [{type: 'ordered_list', attrs: {order: 1, marker}, content: [1, 2].map(n => ({type: 'list_item', content: [{type: 'paragraph', content: [{type: 'text', text: `항목${n}`}]}]}))}]}};
    const want = `${orderedLabel(marker, 0, 1)} 항목1\n${orderedLabel(marker, 0, 2)} 항목2`;
    assert.equal(toPlain(doc).trim(), want, `plain ${marker}`);
    assert.equal(toTelegram(doc).trim(), want, `telegram ${marker}`);
    assert.equal(toHangul(doc).text.trim().replace(/\n+/g, '\n'), want, `hangul ${marker}`);
  }
});
test('the weekly report line (first line of a record) keeps the number shape', () => {
  for (const line of ['1) 임금교섭 결렬', '(1) 임금교섭 결렬', '① 임금교섭 결렬', '가. 임금교섭 결렬', '1. 임금교섭 결렬']) {
    assert.equal(firstLineOf(`${line}\n둘째 줄`), line);
  }
});
test('typed indentation survives the 한글 paste form (html folds leading spaces, so they become no-break spaces)', () => {
  const doc = plainToDocKeep('  1) 하나\n    (1) 둘');
  const html = toHangul(doc).html;
  assert.match(html, /&nbsp;&nbsp;1\) 하나<br>&nbsp;&nbsp;&nbsp;&nbsp;\(1\) 둘/);
  assert.equal(toHangul(doc).text, '  1) 하나\n    (1) 둘');
});

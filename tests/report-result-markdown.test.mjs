// MTG-결과마크다운: 사업 보고 결과 원문·특이사항 — 노트와 같은 마크다운 보기·쓰기 창. 저장 글자는 그대로(데이터 보존).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import MarkdownIt from '../app/markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
import {docToMarkdown} from '../app/ed-markdown-out.mjs';
import {markdownToDoc, plainToDocKeep} from '../app/ed-markdown.mjs';
import {cleanDoc} from '../app/ed-schema.mjs';
import {createMarkdown, renderMarkdown, guardDateLines} from '../app/markdown-render.mjs';
import {markdownSource} from '../app/note-preview.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const md = createMarkdown(MarkdownIt);
const toDoc = text => markdownToDoc(md, guardDateLines(text));
const strip = value => JSON.stringify(value, (k, v) => (k === 'marker' && v === 'decimal' ? undefined : v));

const PASTED = '### 레일협의회 집행위원회 회의 결과 종합\n\n2026\\. 10\\. 19\\.(월) 14:00\n\n### 1\\. 안건\n\n- **결정**: 가결\n- 보류 *사항*\n  - 하위\n\n1. 하나\n2. 둘\n\n| 칸 | 값 |\n|---|---|\n| 가 | 나 |\n\n> 인용\n\n---\n\n[링크](https://example.com/a) 끝';

test('pasted result with copy backslashes is read as markdown and shows headings, lists and no backslash', () => {
  assert.ok(markdownSource(PASTED));
  const {html} = renderMarkdown(md, PASTED);
  assert.match(html, /<h3>레일협의회 집행위원회 회의 결과 종합<\/h3>/);
  assert.match(html, /<h3>1\. 안건<\/h3>/);
  assert.match(html, /2026\. 10\. 19\.\(월\) 14:00/);
  assert.match(html, /<ul>/); assert.match(html, /<table>/);
  assert.doesNotMatch(html, /\\/);
});

test('plain letters opened in the window and saved come back exactly (원문 글자 그대로)', () => {
  for (const text of ['원문 첫 줄\n원문 둘째 줄', '2026. 10. 19. 회의\n1) 첫째\n  - 둘째\n\n다음 문단', '가 * 나 _ 다 [ 라 ]']) {
    assert.equal(docToMarkdown(plainToDocKeep(text)), text);
  }
});

test('a formatted text round-trips through the editor form as markdown', () => {
  const doc = toDoc(PASTED), out = docToMarkdown(doc);
  assert.match(out, /^### 레일협의회 집행위원회 회의 결과 종합$/m);
  assert.match(out, /^- \*\*결정\*\*: 가결$/m);
  assert.match(out, /^\| 칸 \| 값 \|$/m);
  assert.match(out, /^1\. 하나$/m);
  assert.equal(strip(toDoc(out)), strip(doc));
});

test('letters that look like marks inside a formatted text are escaped, date lines are left to the reader', () => {
  const doc = {v: 'ed1', doc: {type: 'doc', content: [
    {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: '제목'}]},
    {type: 'paragraph', content: [{type: 'text', text: '# 글자'}, {type: 'hard_break'}, {type: 'text', text: '- 글자 *별* 1. 끝'}]},
    {type: 'paragraph', content: [{type: 'text', text: '2026. 10. 19. 회의'}]},
    {type: 'paragraph', content: [{type: 'text', text: '3. 셋째'}]},
  ]}};
  const out = docToMarkdown(doc);
  assert.match(out, /^\\# 글자$/m);
  assert.match(out, /^\\- 글자 \\\*별\\\* 1\. 끝$/m);
  assert.match(out, /^2026\. 10\. 19\. 회의$/m);
  assert.match(out, /^3\\\. 셋째$/m);
  assert.equal(strip(toDoc(out).doc.content.slice(1)), strip(cleanDoc(doc).doc.content.slice(1)));
});

test('사업 보고 screens use the shared reader and the one write window', () => {
  const mrd = read('app/meeting-round-detail.js'), team = read('app/team.js'), loader = read('app/view-loader.js');
  assert.match(mrd, /import \{paintRecordText\} from '\.\/record-text-view\.js'/);
  // S62-02 MTG-원문칸넘침(11/15 사용자 '우측 불필요'): 사업 보고 상세의 [원문] 버튼은 없다.
  assert.doesNotMatch(mrd, /rawToggleHtml|mrdResultRaw|mrdSpecialRaw/);
  assert.match(mrd, /paintRecordText\(document\.querySelector\('#mrdResult'\)/);
  assert.match(mrd, /paintRecordText\(document\.querySelector\('#mrdSpecial'\)/);
  assert.doesNotMatch(mrd, /#mrdResult'\)\.textContent=/);
  assert.match(mrd, /mountBigWrite\(document\.querySelector\('#mrdEditTranscript'\)/);
  assert.match(team, /mountBigWrite\(\$\('#meetingTranscript'\)/);
  assert.match(loader, /meetings:\[[^\]]*'\.\/markdown-view\.css'/);
  const view = read('app/record-text-view.js'), write = read('app/record-text-write.js');
  assert.match(view, /import\('\.\/markdown-view\.js'\)/); // DOMPurify 정화를 거치는 공용 보기
  assert.match(write, /openEdWindow\(/);
  assert.match(write, /docToMarkdown\(value\)/);
});

// ED-빈줄읽기: 편집기에서 넣은 빈 줄(빈 문단)이 글자 칸에 저장·읽기에서 그 수대로 남는다.
const P = (text, marks) => ({type: 'paragraph', ...(text ? {content: [{type: 'text', text, ...(marks ? {marks} : {})}]} : {})});
const ed = (...content) => ({v: 'ed1', doc: {type: 'doc', content}});
const shape = value => cleanDoc(value).doc.content.map(n => (n.content || []).map(c => c.text || '').join(''));

test('plain letters keep one more blank line per empty paragraph and open back the same', async () => {
  const {lettersToDoc} = await import('../app/ed-markdown-out.mjs');
  assert.equal(docToMarkdown(ed(P('가'), P('나'))), '가\n\n나');
  assert.equal(docToMarkdown(ed(P('가'), P(''), P('나'))), '가\n\n\n나');
  assert.equal(docToMarkdown(ed(P(''), P('가'), P(''), P(''), P('나'), P(''))), '가\n\n\n\n나');
  for (const doc of [ed(P('가'), P(''), P('나')), ed(P('가'), P(''), P(''), P('나'))]) {
    assert.deepEqual(shape(lettersToDoc(docToMarkdown(doc))), shape(doc));
  }
  for (const text of ['가\n\n\n나', '첫 줄\n둘째 줄\n\n\n\n다음', '원문 첫 줄\n원문 둘째 줄']) assert.equal(docToMarkdown(lettersToDoc(text)), text);
  // 다른 곳(노트·일기 붙이기)은 그대로: 빈 줄 여러 개는 문단 사이 하나.
  assert.equal(plainToDocKeep('가\n\n\n나').doc.content.length, 2);
});

test('formatted letters keep empty paragraphs as &nbsp; paragraphs, read one line each, and open back empty', async () => {
  const {lettersToDoc} = await import('../app/ed-markdown-out.mjs');
  const doc = ed(P('굵게', [{type: 'strong'}]), P(''), P(''), P('끝'));
  const out = docToMarkdown(doc);
  assert.equal(out, '**굵게**\n\n&nbsp;\n\n&nbsp;\n\n끝');
  assert.ok(markdownSource(out));
  const {html} = renderMarkdown(md, out);
  assert.equal((html.match(/<p> <\/p>|<p>&nbsp;<\/p>/g) || []).length, 2);
  assert.deepEqual(shape(lettersToDoc(out, md)), shape(doc));
  assert.equal(docToMarkdown(lettersToDoc(out, md)), out);
  assert.equal(docToMarkdown(ed(P(''), P('굵게', [{type: 'strong'}]), P(''))), '**굵게**');
});

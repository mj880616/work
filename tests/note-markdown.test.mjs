import { test } from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from '../app/markdown-lib/markdown-it-15.0.2/markdown-it.esm.min.mjs';
import { createMarkdown, renderMarkdown, guardDateLines } from '../app/markdown-render.mjs';
import { looksLikeMarkdown, noteMarkdown, storedMarkdown, bodyWithoutTitleLine, startsWithDate } from '../app/note-markdown.mjs';
import { applyPlainAction, PLAIN_ACTIONS } from '../app/md-editor-ops.mjs';
import { noteCopyPayload } from '../app/note-preview.mjs';
import { createNoteDoc, saveNoteDoc, moveToNote } from '../app/basket-data.js';

// NOTE-마크다운선택: 노트마다 [마크다운] 체크(metadata.markdown), 값이 없으면 본문의 마크다운 기호로 판정.
const md = createMarkdown(MarkdownIt);
const html = text => renderMarkdown(md, text).html;

test('an old note without a stored choice: markdown marks → on, hand-written lines → off', () => {
  for (const text of ['## 쟁점\n본문', '**기본급** 인상', '| 항목 | 내용 |\n| --- | --- |\n| 가 | 나 |', '```\ncode\n```', '> [!NOTE]\n> 참고', '[안내](https://example.org)'])
    assert.equal(looksLikeMarkdown(text), true, text);
  for (const text of ['', '1. 첫째\n2. 둘째', '- 하나\n- 둘', '2026.10.21. 회의\n2026. 10. 21. 교섭', '#해시태그', '가*나*다', '별표 ** 두 개'])
    assert.equal(looksLikeMarkdown(text), false, text);
});

test('a stored choice wins over the guess; only true/false count as stored', () => {
  assert.equal(noteMarkdown({raw_text:'## 제목', metadata:{markdown:false}}), false);
  assert.equal(noteMarkdown({raw_text:'그냥 글', metadata:{markdown:true}}), true);
  assert.equal(noteMarkdown({raw_text:'## 제목', metadata:{}}), true);
  assert.equal(noteMarkdown({raw_text:'- 그냥 글', metadata:null}), false);
  assert.equal(storedMarkdown({metadata:{markdown:'true'}}), null);
  assert.equal(storedMarkdown({metadata:[]}), null);
});

test('date lines are never read as a numbered list, real lists still are', () => {
  for (const line of ['2026. 10. 21. 교섭', '10. 21.(화) 통화', '2026. 1. 5.', '- 2026. 10. 21. 회의', '> 2026. 10. 21. 회의']) {
    assert.doesNotMatch(html(line), /<ol/, line);
    assert.match(html(line), /2026\. 10\. 21\.|10\. 21\.\(화\)|2026\. 1\. 5\./, line);
  }
  assert.match(html('1. 첫째\n2. 둘째'), /<ol>\s*<li>첫째<\/li>/);
  assert.match(html('13. 21. 항목'), /<ol start="13">/); // 13월은 날짜가 아니다
  assert.match(html('2026.10.21. 회의'), /<p>2026\.10\.21\. 회의<\/p>/);
  // Code keeps its letters as typed.
  assert.equal(guardDateLines('```\n2026. 10. 21.\n```'), '```\n2026. 10. 21.\n```');
  assert.equal(guardDateLines('2026. 10. 21. 교섭'), '2026\\. 10. 21. 교섭');
});

test('with markdown off the format buttons put letters in: - · 1. · ☐ · ────', () => {
  assert.deepEqual([...PLAIN_ACTIONS], ['bullet', 'number', 'task', 'rule']);
  assert.equal(applyPlainAction('사과\n배', 0, 4, 'bullet').insert, '- 사과\n- 배');
  assert.equal(applyPlainAction('사과\n배', 0, 4, 'number').insert, '1. 사과\n2. 배');
  assert.equal(applyPlainAction('사과', 1, 1, 'task').insert, '☐ 사과');
  assert.equal(applyPlainAction('☐ 사과', 0, 4, 'task').insert, '사과');
  assert.equal(applyPlainAction('- 사과', 0, 4, 'task').insert, '☐ 사과');
  const rule = applyPlainAction('위', 1, 1, 'rule');
  assert.equal(rule.insert, '\n\n────\n');
  assert.throws(() => applyPlainAction('가', 0, 0, 'bold'));
});

test('copy: a note with markdown off is copied as written, title first', () => {
  assert.deepEqual(noteCopyPayload({title:'통화', raw_text:'1. 첫째\n- 둘째', metadata:{markdown:false}}), {text:'통화\n\n1. 첫째\n- 둘째', done:'복사했습니다'});
  assert.equal(noteCopyPayload({title:'정리', raw_text:'**굵게**', metadata:{markdown:true}}).text.includes('**'), false);
});

test('날짜 두 번: a first line that starts with a date and is the title leaves the body', () => {
  assert.equal(startsWithDate('2026.10.21. 14:30 통화'), true);
  assert.equal(startsWithDate('2026-10-21 회의'), true);
  assert.equal(startsWithDate('10. 21.(화) 통화'), true);
  assert.equal(startsWithDate('회의 2026.10.21.'), false);
  assert.equal(bodyWithoutTitleLine('2026.10.21. 14:30 통화\n\n내용 첫 줄\n둘째', '2026.10.21. 14:30 통화'), '내용 첫 줄\n둘째');
  assert.equal(bodyWithoutTitleLine('\n2026.10.21. 14:30\r\n내용', '2026.10.21. 14:30'), '내용');
  // Not a date, or not the same line: the body stays whole.
  assert.equal(bodyWithoutTitleLine('회의 준비\n내용', '회의 준비'), '회의 준비\n내용');
  assert.equal(bodyWithoutTitleLine('2026.10.21. 통화 길게\n내용', '2026.10.21. 통화'), '2026.10.21. 통화 길게\n내용');
});

const runtime = api => ({context:{read:()=>({workspace:{id:'w'}, user:{id:'u'}})}, api});
const q = path => new URL(path, 'http://x').searchParams;

test('a new note keeps the box in metadata.markdown; without it the insert is as before', async () => {
  const bodies = [];
  const rt = runtime(async (path, options) => { bodies.push(options.body); return [{id:'n', ...options.body}]; });
  await createNoteDoc({title:'새 노트', raw_text:'1. 하나', markdown:false}, rt);
  await createNoteDoc({title:'새 노트', raw_text:'## 둘', markdown:true}, rt);
  await createNoteDoc({title:'새 노트', raw_text:'셋'}, rt);
  assert.deepEqual(bodies.map(b => b.metadata), [{markdown:false}, {markdown:true}, undefined]);
});

test('saving with a changed box reads the row and keeps its other metadata under the same guards', async () => {
  const calls = [];
  const rt = runtime(async (path, options = {}) => {
    calls.push({path, options});
    if (!options.method) return [{id:'n', updated_at:'2026-10-21T01:00:00Z', metadata:{pinned_at:'2026-10-20T00:00:00Z', folder:'교섭', journal_at:'x'}}];
    return [{id:'n', ...options.body}];
  });
  const saved = await saveNoteDoc('n', {title:'제목', raw_text:'본문', markdown:false}, rt);
  assert.equal(calls.length, 2);
  const patch = q(calls[1].path);
  assert.equal(calls[1].options.method, 'PATCH');
  assert.equal(patch.get('kind'), 'eq.note'); assert.equal(patch.get('updated_at'), 'eq.2026-10-21T01:00:00Z');
  assert.equal(patch.get('metadata->>pinned_at'), 'eq.2026-10-20T00:00:00Z'); assert.equal(patch.get('metadata->>folder'), 'eq.교섭');
  assert.deepEqual(calls[1].options.body.metadata, {pinned_at:'2026-10-20T00:00:00Z', folder:'교섭', journal_at:'x', markdown:false});
  assert.equal(saved.raw_text, '본문');
  // A row changed in between is not overwritten.
  await assert.rejects(saveNoteDoc('n', {title:'제목', raw_text:'본문', markdown:true}, runtime(async (path, options = {}) => options.method ? [] : [{id:'n', updated_at:'t', metadata:{}}])), /그사이 바뀌었어요/);
  // Without markdown it is the single PATCH it always was.
  const plain = [];
  await saveNoteDoc('n', {title:'제목', raw_text:'본문'}, runtime(async (path, options) => { plain.push(options); return [{id:'n'}]; }));
  assert.equal(plain.length, 1); assert.equal(plain[0].body.metadata, undefined);
});

test('[노트로 옮기기] with a date first line saves the body without that line; other bodies are untouched', async () => {
  const run = async raw_text => {
    const calls = [];
    const rt = runtime(async (path, options = {}) => { calls.push({path, options}); return options.method ? [{id:'m', ...options.body}] : [{id:'m', updated_at:'t', metadata:{}, raw_text}]; });
    await moveToNote('m', raw_text.split('\n')[0], rt, new Date('2026-10-21T08:00:00Z'));
    assert.match(q(calls[0].path).get('select'), /raw_text/);
    return calls[1].options.body;
  };
  const moved = await run('2026.10.21. 14:30 합성지부 통화\n통화 내용');
  assert.deepEqual({kind:moved.kind, title:moved.title, raw_text:moved.raw_text}, {kind:'note', title:'2026.10.21. 14:30 합성지부 통화', raw_text:'통화 내용'});
  assert.equal(moved.metadata.markdown, undefined);
  assert.equal('raw_text' in await run('회의 준비 메모\n둘째 줄'), false);
});

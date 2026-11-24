// S69-86 BRIEF-밑줄노트: 브리핑 밑줄·답글·노트로 보관의 순수 계산. 네트워크 없음, 예시 자료만.
// 파생 저장은 글을 복사해 넣고, 브리핑·자료 id·Drive 주소를 노트·밑줄 출처에 담지 않는다(브리핑을 지워도 남게).
import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveNote, briefSource, BRIEF_MEDIA, ARCHIVE_LABEL, BRIEF_GONE} from '../app/brief-room-model.mjs';
import {HL_TYPES, cleanSource, highlightBody, sourceTag, replyNoteOf, draftOf, sourceLine} from '../app/text-highlights-model.mjs';
import {visibleMarks} from '../app/note-news-marks-model.mjs';

const DOC = {id: 'd0000000-0000-4000-8000-000000000003', title: '예시 도시철도 통합 연구', file_name: '예시.pdf', mime_type: 'application/pdf', file_id: 'FILE_cccccccccc'};
const ROW = {finished_at: '2026-11-24T00:10:00Z', page_count: 96, brief: {
  v: 3, gist: ['요지 하나.', '요지 둘.'],
  sections: [{title: '안건 1', items: [{text: '예시 줄', page: 12, ours: true}, {text: '쪽 없는 줄', page: null}]}, {title: '', items: [{text: '제목 없는 줄'}]}],
  quotes: [{text: '예시 인용', speaker: '예시 국장', heading: '안건 1', page: 12}],
}};

test('브리핑 밑줄 출처: 종류 brief, 자료 id, 이름·날짜 글자만(주소 없음)', () => {
  assert.ok(HL_TYPES.includes('brief'));
  const src = briefSource(DOC, ROW);
  assert.deepEqual(src, {type: 'brief', id: DOC.id, title: DOC.title, media: BRIEF_MEDIA, date: ROW.finished_at, url: null});
  assert.equal(cleanSource(src).type, 'brief');
  const body = highlightBody('w1', src, ' 예시 줄 ', {prefix: '앞', suffix: '뒤'});
  assert.equal(body.source_type, 'brief');
  assert.equal(body.source_url, null);
  assert.equal(sourceTag({source_type: 'brief'}), '브리핑');
  assert.equal(sourceLine({source_media: '브리핑', source_date: ROW.finished_at, source_title: DOC.title}), '브리핑 · 2026-11-24 · 예시 도시철도 통합 연구');
  assert.equal(briefSource(null, ROW), null);
  assert.equal(briefSource({id: DOC.id, file_name: '파일.pdf'}, null).title, '파일.pdf');
});

test('답글 노트: 고른 글 + 메모 + 출처, 메모 없으면 만들지 않음', () => {
  const draft = draftOf(briefSource(DOC, ROW), '예시 줄');
  assert.equal(replyNoteOf(draft, '  '), null);
  assert.equal(replyNoteOf(draft, null), null);
  assert.equal(replyNoteOf({...draft, quote: ''}, '메모'), null);
  const n = replyNoteOf(draft, '내 생각');
  assert.equal(n.title, '답글 · 예시 도시철도 통합 연구');
  assert.match(n.raw_text, /^> 예시 줄\n\n메모: 내 생각\n\n출처: 브리핑 · 2026-11-24 · 예시 도시철도 통합 연구$/);
  assert.ok(!n.raw_text.includes(DOC.id));
});

test('노트로 보관: 요지·소제목 줄(우리 관련·쪽)·원문 인용·밑줄(오래된 것 먼저, 메모)을 마크다운 한 장으로', () => {
  const marks = [{quote: '둘째 밑줄', memo: '메모 둘'}, {quote: '첫 밑줄', memo: null}, {quote: '  '}];
  const n = archiveNote({doc: DOC, row: ROW, marks});
  assert.equal(n.title, '브리핑 · 예시 도시철도 통합 연구');
  assert.equal(n.raw_text, [
    '출처: 브리핑 · 2026-11-24 · 예시 도시철도 통합 연구 (PDF · 96쪽)',
    '## 요지\n\n요지 하나.\n\n요지 둘.',
    '## 안건 1\n\n- 예시 줄 (우리 관련) · 12쪽\n- 쪽 없는 줄',
    '- 제목 없는 줄',
    '## 원문 인용\n\n> “예시 인용”\n\n— 예시 국장 · 12쪽 · 안건 1',
    '## 밑줄 2\n\n> 첫 밑줄\n\n> 둘째 밑줄\n\n메모: 메모 둘',
  ].join('\n\n'));
  assert.ok(!n.raw_text.includes(DOC.id) && !n.raw_text.includes('drive.google.com'), '자료 id·주소 없음');
  assert.ok(!archiveNote({doc: DOC, row: ROW}).raw_text.includes('## 밑줄'), '밑줄이 없으면 그 절 없음');
  assert.equal(archiveNote({doc: DOC, row: {brief: null}}), null);
  assert.equal(archiveNote({doc: null, row: ROW}), null);
  assert.ok(archiveNote({doc: {...DOC, title: '가'.repeat(200)}, row: ROW}).title.length <= 80);
  // 옛 형식(v1)도 같은 모양으로.
  const old = archiveNote({doc: DOC, row: {finished_at: ROW.finished_at, brief: {v: 1, lead: '옛 요지', todos: ['할 일 하나']}}});
  assert.match(old.raw_text, /## 요지\n\n옛 요지/);
  assert.match(old.raw_text, /## 할 일·기한·숫자\n\n- 할 일 하나/);
  assert.equal(ARCHIVE_LABEL, '노트로 보관');
  assert.match(BRIEF_GONE, /원래 브리핑이 없어요/);
});

test('노트 › 밑줄: News 기능이 없어도 브리핑 밑줄은 보인다', () => {
  const raw = [{id: '1', source_type: 'brief'}, {id: '2', source_type: 'news'}, {id: '3', source_type: 'note'}];
  assert.deepEqual(visibleMarks(raw, {newsOn: false}).map(h => h.source_type), ['brief', 'note']);
});

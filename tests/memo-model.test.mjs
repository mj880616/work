// S69-94 NOTE-메모통일: 메모 계산(종류 표·열기 표·원문 없음·모아 보기 거르기·옛 댓글 모양). 이름·글은 지어낸 것.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MEMO_TARGETS, MEMO_TYPES, MEMO_OPEN, MEMO_GROUPS, MEMO_LIMITS, memoFeature, memoDraft, titleCopy, memosOf, memoText, memoRows, memoGroupsPresent, keepMemoGroup,
  memoLink, memoSource, GONE_LINE, fromNoteComment, latestByTarget, isMemoTarget} from '../app/memo-model.mjs';
import {tableEntries, mergeEntries, entryLine, memoHit} from '../app/now-memos-model.mjs';

const N1 = '11111111-1111-4111-8111-111111111111', A1 = '22222222-2222-4222-8222-222222222222', R1 = '33333333-3333-4333-8333-333333333333';
const M = (id, type, target, body, created_at, extra = {}) => ({id, target_type: type, target_id: target, target_title: null, body, created_at, updated_at: created_at, ...extra});
const MID = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;

test('종류 표: 노트·읽을 거리(news·outside)·저장한 글·브리핑 + 자료실·사업 보고·담당조직 기록·텔레그램(S69-95), DB 검사와 같은 종류', () => {
  assert.deepEqual(MEMO_TYPES, ['note', 'news', 'outside', 'reading', 'brief', 'document', 'meeting', 'org_record', 'telegram', 'record_link']);
  assert.equal(memoSource({target_type: 'record_link'}), '기록'); // S71-71 연결 기록
  assert.deepEqual(['document', 'meeting', 'org_record', 'telegram'].map(t => memoSource({target_type: t})), ['자료실', '사업 보고', '담당조직', '텔레그램']);
  assert.equal(MEMO_TARGETS.news.label, '읽을 거리');
  assert.equal(MEMO_TARGETS.outside.group, MEMO_TARGETS.news.group, '기사·성명은 한 칩');
  assert.equal(memoSource({target_type: 'reading'}), '저장한 글');
  assert.equal(memoSource({target_type: 'x'}), '기록');
  // DB 검사(app_memos_target_type_check)와 종류 표가 같다 — 종류를 더하면 둘 다 고친다.
  const sql = readFileSync(new URL('../supabase/migrations/20261127030000_memos_record_link.sql', import.meta.url), 'utf8'); // 가장 뒤 대상 종류 migration
  const check = sql.match(/check \(target_type in \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map(v => v.slice(1, -1));
  assert.deepEqual(check, MEMO_TYPES);
  assert.equal(MEMO_LIMITS.body, 4000);
  assert.ok(MEMO_GROUPS.every(g => !g.key || Object.values(MEMO_TARGETS).some(t => t.group === g.key)));
});

test('열기 표 한 곳: 종류마다 여는 화면·요청·있는지 볼 표, 브리핑은 아직 여는 곳 없음', () => {
  assert.deepEqual({...MEMO_OPEN.note}, {view: 'basket', request: 'note', check: null});
  assert.deepEqual({...MEMO_OPEN.news}, {view: 'news', request: 'news', check: 'app_news_articles'});
  assert.deepEqual({...MEMO_OPEN.outside}, {view: 'news', request: 'news', check: 'app_outside_articles'});
  assert.deepEqual({...MEMO_OPEN.reading}, {view: 'reading', request: 'reading', check: 'app_reading_items', own: true});
  assert.equal(MEMO_OPEN.brief, null);
  // S69-95: 새 넷은 내 작업공간 것만(own) 묻고, 휴지통에 든 사업 보고·텔레그램 소식은 없는 것으로 본다(live). 담당조직 기록 표는 작업공간 칸이 없어 소유자 RLS만.
  assert.deepEqual({...MEMO_OPEN.document}, {view: 'library', request: 'document', check: 'app_documents', own: true});
  assert.deepEqual({...MEMO_OPEN.meeting}, {view: 'meetings', request: 'meeting', check: 'app_meetings', own: true, live: 'deleted_at=is.null'});
  assert.deepEqual({...MEMO_OPEN.org_record}, {view: 'team', request: 'org_record', check: 'app_suborganization_updates'});
  assert.deepEqual({...MEMO_OPEN.record_link}, {view: 'team', request: 'record_link', check: 'app_record_links', own: true, live: 'status=eq.confirmed'});
  assert.deepEqual({...MEMO_OPEN.telegram}, {view: 'telegram', request: 'telegram', check: 'app_feed_items', own: true, live: 'source=eq.telegram&hidden_at=is.null', feature: 'telegram'});
  assert.equal(memoFeature({target_type: 'telegram'}), 'telegram');
  assert.equal(memoFeature({target_type: 'document'}), '');
  for (const t of MEMO_TYPES) assert.ok(t in MEMO_OPEN, t);
  // 원문 열기 일(memo-open.js)이 표의 request 이름마다 하나씩 있다.
  const opener = readFileSync(new URL('../app/memo-open.js', import.meta.url), 'utf8');
  for (const how of Object.values(MEMO_OPEN).filter(Boolean)) assert.match(opener, new RegExp(`\\n\\s+${how.request}: (async )?o =>`), how.request);
});

test('원문 연결: 있으면 그 화면·그 메모, 없어졌으면 링크만 꺼짐(메모는 그대로), 모르면 켜 둠', () => {
  const m = M(MID(1), 'news', A1, '생각', '2026-11-25T00:00:00Z');
  assert.deepEqual(memoLink(m), {open: {view: 'news', request: 'news', type: 'news', id: A1, memo: MID(1)}, gone: false});
  assert.deepEqual(memoLink(m, () => true).open.view, 'news');
  assert.deepEqual(memoLink(m, () => false), {open: null, gone: true});
  assert.deepEqual(memoLink(M(MID(2), 'brief', A1, '가', '2026-11-25T00:00:00Z')), {open: null, gone: false}, '여는 곳 없음은 없어진 것이 아님');
  assert.deepEqual(memoLink(M(MID(3), 'note', 'nope', '가', '2026-11-25T00:00:00Z')), {open: null, gone: false});
  assert.equal(memoLink(M('old-1', 'note', N1, '가', '2026-11-25T00:00:00Z')).open.memo, null, '옛 댓글 id(uuid 아님)는 자리 찾기 없이 열기만');
  assert.equal(GONE_LINE, '원래 기록이 없어요');
  assert.equal(isMemoTarget('reading', R1), true);
  assert.equal(isMemoTarget('library', R1), false);
});

test('남기기 검사·제목 사본: 빈 글·4000자 넘음 막음, 제목은 한 줄 300자', () => {
  assert.equal(memoDraft('줄\r\n바꿈'), '줄\n바꿈');
  assert.throws(() => memoDraft('   '), /메모를 써 주세요/);
  assert.throws(() => memoDraft('가'.repeat(4001)), /4000자/);
  assert.equal(memoDraft('가'.repeat(4000)).length, 4000);
  assert.equal(titleCopy('  바다\n\t책  '), '바다 책');
  assert.equal(titleCopy(''), null);
  assert.equal(titleCopy(null), null);
  assert.equal([...titleCopy('가'.repeat(400))].length, 300);
});

test('모아 보기: 최근 쓴 순, 출처 묶음 칩·거르기, 찾기는 글·옛 인용·원문 제목, 잠긴 노트 메모는 찾기에서 뺌', () => {
  const ms = [
    M(MID(1), 'note', N1, '바다는 넓다', '2026-11-20T00:00:00Z', {quote: '넓고 깊다'}),
    M(MID(2), 'news', A1, '기사 생각', '2026-11-24T00:00:00Z', {target_title: '파업 기사'}),
    M(MID(3), 'reading', R1, '저장 글 생각', '2026-11-22T00:00:00Z', {target_title: '긴 칼럼'}),
    M(MID(4), 'outside', A1, '성명 생각', '2026-11-23T00:00:00Z'),
  ];
  assert.deepEqual(memoRows(ms).map(m => m.id), [MID(2), MID(4), MID(3), MID(1)]);
  assert.deepEqual(memoRows(ms, {group: 'feed'}).map(m => m.id), [MID(2), MID(4)]);
  assert.deepEqual(memoRows(ms, {group: 'reading'}).map(m => m.id), [MID(3)]);
  assert.deepEqual(memoRows(ms, {query: '깊 다'}).map(m => m.id), [MID(1)], '옛 인용 글도 찾음(띄어쓰기 무시)');
  assert.deepEqual(memoRows(ms, {query: '칼럼'}).map(m => m.id), [MID(3)], '원문 제목 사본');
  assert.deepEqual(memoRows(ms, {query: '노트 제목', titleOf: m => (m.target_type === 'note' ? '노트 제목' : m.target_title)}).map(m => m.id), [MID(1)]);
  assert.deepEqual(memoRows(ms, {query: '바다', hidden: m => m.target_type === 'note'}), [], '잠긴 노트 메모는 글로 찾지 않음');
  assert.deepEqual(memoGroupsPresent(ms).map(g => g.label), ['전체', '노트', '읽을 거리', '저장한 글']);
  assert.deepEqual(memoGroupsPresent([]).map(g => g.label), ['전체']);
  assert.equal(keepMemoGroup('brief', ms), '', '메모 없는 묶음은 전체로');
  assert.equal(keepMemoGroup('reading', ms), 'reading');
});

test('원문 하나의 메모: 시간순(오래된 것 위), 검색 글, 원문별 최근 메모', () => {
  const ms = [M(MID(2), 'note', N1, '둘째', '2026-11-21T00:00:00Z'), M(MID(1), 'note', N1, '첫째', '2026-11-20T00:00:00Z'), M(MID(3), 'news', N1, '남의 종류', '2026-11-22T00:00:00Z')];
  assert.deepEqual(memosOf(ms, 'note', N1).map(m => m.body), ['첫째', '둘째']);
  assert.match(memoText(ms, 'note', N1), /둘째/); assert.match(memoText(ms, 'note', N1), /첫째/);
  assert.doesNotMatch(memoText(ms, 'note', N1), /남의 종류/);
  assert.equal(latestByTarget(ms).get(`note:${N1}`).id, MID(2));
});

test('옛 노트 댓글(새 표 적용 전에만 읽음) → 메모 모양, 종류·인용은 그대로 들고 감', () => {
  const m = fromNoteComment({id: 'c1', note_id: N1, kind: 'question', quote: null, body: '언제?', created_at: '2026-10-13T01:00:00Z'});
  assert.deepEqual(m, {id: 'c1', target_type: 'note', target_id: N1, target_title: null, body: '언제?', quote: null, kind: 'question', created_at: '2026-10-13T01:00:00Z', updated_at: '2026-10-13T01:00:00Z', legacy: true});
});

test('읽을 거리 [메모] 탭: 새 메모 + 옛 노트 메모를 글마다 한 줄로(더 최근 것), 줄 아래 첫 줄', () => {
  const memos = [M(MID(1), 'news', A1, '새 메모 첫 줄\n둘째', '2026-11-25T00:00:00Z'), M(MID(2), 'news', A1, '옛것', '2026-11-20T00:00:00Z'), M(MID(3), 'note', N1, '노트 메모', '2026-11-26T00:00:00Z')];
  const rows = tableEntries(memos, {articleOf: (t, id) => (id === A1 ? {id: A1, title: '기사'} : null)});
  assert.equal(rows.length, 1, '노트 메모는 읽을 거리 줄이 아님');
  assert.equal(rows[0].memo.id, MID(1));
  assert.equal(entryLine(rows[0]), '새 메모 첫 줄');
  const old = [{key: `news:${A1}`, note: {id: 'n', raw_text: '옛 노트 메모'}, type: 'news', id: A1, row: {id: A1, title: '기사'}, at: '2026-11-24T00:00:00Z'},
    {key: `outside:${R1}`, note: {id: 'm', raw_text: '성명 메모'}, type: 'outside', id: R1, row: null, at: '2026-11-23T00:00:00Z'}];
  const merged = mergeEntries(old, rows);
  assert.deepEqual(merged.map(e => e.key), [`news:${A1}`, `outside:${R1}`]);
  assert.equal(merged[0].memo.id, MID(1), '같은 글이면 더 최근 메모가 줄을 대표');
  assert.equal(entryLine(merged[1]), '성명 메모');
  assert.equal(memoHit(merged[0], '새메모'), true);
});

// S69-94 NOTE-메모통일(사용자 11/25 03:14~03:17 "노트 생각 질문 인용이 댓글이지? 읽을 거리 저장한 글에도 똑같이 댓글 시스템으로 / 걍 다 메모로 통일 /
// 남기는 형식은 댓글인데 부르는 명칭은 메모 남기기 / 메모를 모아두는 화면에서는 메모도 보이지만 그 메모를 남긴 원문 기록으로 연결도 되어야"):
// 메모 하나 = (대상 종류, 대상 id, 글, 시각, 작업공간). 표는 public.app_memos(migration 20261125030000). DOM·네트워크 없는 계산만.
// 화면: 쓰기·고치기·지우기 칸 memo-thread.js(노트·읽을 거리 글·저장한 글이 같은 부품), 모아 보기 노트 [메모] 보기(basket-notes.js),
// 원문 열기 memo-open.js(아래 MEMO_OPEN 표대로). 서버 표 읽기·쓰기 memo-data.js, 작업공간 메모 목록 한 곳 memo-store.js.
// 대상 종류를 더할 때는 DB 검사(app_memos_target_type_check) 한 줄 + 이 표 한 줄 + 여는 곳 한 곳.
// S69-95 NOTE-메모넓히기(사용자 11/25 03:17 "메모를 모아두는 화면에서는 메모도 보이지만 그 메모를 남긴 원문 기록으로 연결도 되어야"):
//  document = 자료실 파일(app_documents.id, 자료 ⋯ [메모] → 자료 창 아래), meeting = 사업 관리 사업 보고(app_meetings.id, 보고 창 맨 아래),
//  org_record = 조직 관리 담당조직 기록(app_suborganization_updates.id, 기록 ⋯ [메모] → 기록 창 아래), telegram = 텔레그램 소식 한 건(app_feed_items.id, 소식 원문 아래).
//  메모는 늘 내 작업공간 주인만 본다(공유 기능이 생겨도 공유 읽기 길에 메모 표는 없다 — docs/design/collab-sharing.md 8절).

// 대상 종류 → 출처 꼬리표·거르기 묶음. news·outside는 둘 다 '읽을 거리'(기사·성명 화면) 한 칩.
// brief(브리핑 룸 자료)는 DB가 받기만 하고 아직 쓰는 화면이 없다(브리핑 [답글]은 지금처럼 노트 한 장 — S69-95에서 옮김).
import {word} from './brand/brand.mjs'; // S69-95: 얼굴(기록+·노조+)과 사람마다 고친 이름을 따르는 메뉴 낱말
export const MEMO_TARGETS = Object.freeze({
  note: Object.freeze({label: '노트', group: 'note'}),
  news: Object.freeze({label: '읽을 거리', group: 'feed'}),
  outside: Object.freeze({label: '읽을 거리', group: 'feed'}),
  reading: Object.freeze({label: '저장한 글', group: 'reading'}),
  brief: Object.freeze({label: '브리핑', group: 'brief'}),
  document: Object.freeze({label: '자료실', group: 'document'}),
  meeting: Object.freeze({label: word('사업 보고'), group: 'meeting'}),
  org_record: Object.freeze({label: word('담당조직'), group: 'org'}),
  telegram: Object.freeze({label: '텔레그램', group: 'telegram'}),
});
export const MEMO_TYPES = Object.freeze(Object.keys(MEMO_TARGETS));
// 모아 보기 거르기 칩(전체는 늘, 나머지는 그 묶음 메모가 있을 때만).
export const MEMO_GROUPS = Object.freeze([
  Object.freeze({key: '', label: '전체'}),
  Object.freeze({key: 'note', label: '노트'}),
  Object.freeze({key: 'feed', label: '읽을 거리'}),
  Object.freeze({key: 'reading', label: '저장한 글'}),
  Object.freeze({key: 'brief', label: '브리핑'}),
  Object.freeze({key: 'document', label: '자료실'}),
  Object.freeze({key: 'meeting', label: word('사업 보고')}),
  Object.freeze({key: 'org', label: word('담당조직')}),
  Object.freeze({key: 'telegram', label: '텔레그램'}),
]);
// 표의 검사와 같은 숫자(app_memos_body_check·target_title_check·quote_check).
export const MEMO_LIMITS = Object.freeze({body: 4000, title: 300, quote: 1000});

// ★원문 열기 표(한 곳): 대상 종류 → 그 원문을 여는 화면과 요청 모양. memo-open.js가 이 값대로 연다.
// check = 원문이 아직 있는지 볼 표(노트는 목록이 이미 있어 화면이 안다). own = 그 표에 작업공간 칸이 있어 내 작업공간 것만 묻는다.
// live = 휴지통에 든 원문을 '없음'으로 볼 조건(사업 보고 삭제 = deleted_at, 텔레그램 소식 삭제 = hidden_at). null 이면 아직 여는 곳 없음(링크 꺼짐, 메모는 그대로).
export const MEMO_OPEN = Object.freeze({
  note: Object.freeze({view: 'basket', request: 'note', check: null}),
  news: Object.freeze({view: 'news', request: 'news', check: 'app_news_articles'}),
  outside: Object.freeze({view: 'news', request: 'news', check: 'app_outside_articles'}),
  reading: Object.freeze({view: 'reading', request: 'reading', check: 'app_reading_items', own: true}),
  brief: null,
  document: Object.freeze({view: 'library', request: 'document', check: 'app_documents', own: true}),
  meeting: Object.freeze({view: 'meetings', request: 'meeting', check: 'app_meetings', own: true, live: 'deleted_at=is.null'}),
  org_record: Object.freeze({view: 'team', request: 'org_record', check: 'app_suborganization_updates'}),
  telegram: Object.freeze({view: 'telegram', request: 'telegram', check: 'app_feed_items', own: true, live: 'source=eq.telegram&hidden_at=is.null', feature: 'telegram'}),
});
// 운영자 기능에 달린 종류(텔레그램): 그 기능이 잠겨 있으면 모아 보기에서 글·제목을 가린다(밑줄 모아 보기와 같은 규칙). DOM 없는 판정은 부르는 쪽이 준다.
export const memoFeature = memo => MEMO_OPEN[memo?.target_type]?.feature || '';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isMemoTarget = (type, id) => MEMO_TYPES.includes(type) && typeof id === 'string' && UUID.test(id);
export const memoKey = (type, id) => `${type}:${id}`;
export const memoSource = memo => MEMO_TARGETS[memo?.target_type]?.label || '기록';
export const memoGroup = memo => MEMO_TARGETS[memo?.target_type]?.group || '';

// 원문 제목 사본: 한 줄로, 300자까지. 비면 null(표 검사와 같은 규칙).
export function titleCopy(title) {
  const one = String(title ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return one ? [...one].slice(0, MEMO_LIMITS.title).join('').trim() || null : null;
}

// 저장 전 검사(표가 같은 규칙으로 다시 막는다). 통과하면 보낼 글, 아니면 오류(쉬운 말).
export function memoDraft(body) {
  const text = String(body ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new Error('메모를 써 주세요.');
  if ([...text].length > MEMO_LIMITS.body) throw new Error(`메모는 ${MEMO_LIMITS.body}자까지 쓸 수 있어요.`);
  return text;
}

const at = m => Date.parse(m?.created_at || '') || 0;
// 한 원문의 메모: 쓴 차례(오래된 것 위, 시간순 줄).
export const memosOf = (memos, type, id) => (memos || []).filter(m => m.target_type === type && m.target_id === id)
  .sort((a, b) => at(a) - at(b) || String(a.id).localeCompare(String(b.id)));
// 노트 검색에 메모도 걸리게: 그 노트 메모 글(옛 인용 글 포함)을 한 줄로.
export const memoText = (memos, type, id) => (memos || []).filter(m => m.target_type === type && m.target_id === id).map(m => `${m.body || ''}\n${m.quote || ''}`).join('\n');
// 메모 있는 원문 열쇠들(type:id → 가장 최근 메모).
export function latestByTarget(memos, types = MEMO_TYPES) {
  const out = new Map();
  for (const m of memos || []) {
    if (!types.includes(m.target_type)) continue;
    const k = memoKey(m.target_type, m.target_id), was = out.get(k);
    if (!was || at(m) > at(was)) out.set(k, m);
  }
  return out;
}

// 모아 보기 칩: 전체 + 메모가 있는 묶음만(정한 차례).
export function memoGroupsPresent(memos) {
  const have = new Set((memos || []).map(memoGroup).filter(Boolean));
  return MEMO_GROUPS.filter(g => !g.key || have.has(g.key));
}
export const keepMemoGroup = (key, memos) => (memoGroupsPresent(memos).some(g => g.key === key) ? key : '');

// 모아 보기 줄: 묶음(''=전체)·찾는 말로 거르고 최근 쓴 순. titleOf(memo) = 지금 원문 제목(모르면 사본). hidden(memo) = 잠긴 노트 메모(글·제목 가림, 찾기에서 뺌).
export function memoRows(memos, {group = '', query = '', titleOf = m => m.target_title || '', hidden = () => false} = {}) {
  const q = String(query || '').replace(/\s+/g, '').toLowerCase();
  return (memos || [])
    .filter(m => !group || memoGroup(m) === group)
    .filter(m => !q || (!hidden(m) && `${m.body || ''}${m.quote || ''}${titleOf(m) || ''}${memoSource(m)}`.replace(/\s+/g, '').toLowerCase().includes(q)))
    .sort((a, b) => at(b) - at(a) || String(b.id).localeCompare(String(a.id)));
}

// 줄 하나의 원문 연결: exists(memo) = true(있음)·false(없어짐)·undefined(아직 모름 — 누르면 열어 보고 그 화면이 알린다).
// 돌려줌 {open:{view, request, type, id, memo}|null, gone:boolean}. 여는 곳이 없는 종류(brief)나 없어진 원문은 open null.
export function memoLink(memo, exists = () => undefined) {
  const how = MEMO_OPEN[memo?.target_type];
  if (!how || !isMemoTarget(memo?.target_type, memo?.target_id)) return {open: null, gone: false};
  const there = exists(memo);
  if (there === false) return {open: null, gone: true};
  return {open: {view: how.view, request: how.request, type: memo.target_type, id: memo.target_id, memo: UUID.test(String(memo.id || '')) ? memo.id : null}, gone: false};
}
// 원문이 없을 때의 한 줄(링크만 꺼짐, 메모는 그대로).
export const GONE_LINE = '원래 기록이 없어요';

// 옛 노트 댓글 줄(app_note_comments — 새 표가 아직 없을 때만 읽는다) → 메모 모양.
export const fromNoteComment = c => ({id: c.id, target_type: 'note', target_id: c.note_id, target_title: null, body: c.body, quote: c.quote || null, kind: c.kind || null,
  created_at: c.created_at, updated_at: c.created_at, legacy: true});


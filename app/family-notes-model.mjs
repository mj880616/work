// FAMILY-잊지말기 4단계(설계 docs/design/tg-personal.md 5·6절, 명진 결정 11/05 시안 A) + S51-26 FAMILY-노트로(11/06 결정 '2'):
// 홈 [하루] '잊지 말기' 칸의 규칙. 화면·서버 호출 없이 node --test로 확인한다.
// 줄은 서버(collector-feed)가 가족 1명의 대화·통화에서 뽑은 한 줄이다(원문 없음). 화면은 글자로만 그린다(HTML 해석 금지).
// 상태: new(제안) → kept(노트로 보냄·[이미 함] — 옛 [기억만]도 같은 값, 처음 한 번 노트로 옮김)·tasked(할 일로)·scheduled(일정으로)·dismissed(×).
// [×]도 줄을 지우지 않는다. 칸은 제안(new)만 보인다. 남길 것은 노트('잊지 말기' 노트, 체크 목록 한 줄)에 둔다.

export const KIND_LABEL = Object.freeze({plan: '약속·계획', ask: '부탁', like: '좋아함', dislike: '싫어함', date: '기념일', gift: '선물 거리', remind: '잊지 마'});
// 확정 정도: '확정'은 꼬리표를 붙이지 않고, 예정·확인만 작은 글자로(11/06 ⑧).
export const FIRM_LABEL = Object.freeze({firm: '', planned: '예정', unclear: '확인'});
export const ORIGIN_LABEL = Object.freeze({telegram: '텔레그램', call: '통화'});
export const DECISIONS = Object.freeze(['kept', 'tasked', 'scheduled', 'dismissed']);
const FIRMNESS = ['firm', 'planned', 'unclear'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 화면이 읽는 칸(소유자 RLS + 운영자 기능 family 정책). 원문 칸은 표에 없다. 표 이름·주소는 family-notes-data.js 한 곳.
export const NOTE_SELECT = 'id,kind,body,said_when,firmness,origin,origin_day,status,created_at';

// 서버 줄 → 화면 줄. 모양이 틀린 줄은 버린다.
export function cleanNote(r) {
  if (!r || typeof r !== 'object' || !UUID.test(String(r.id || ''))) return null;
  if (!KIND_LABEL[r.kind] || typeof r.body !== 'string' || !r.body.trim()) return null;
  return {
    id: String(r.id), kind: r.kind, body: r.body.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(),
    saidWhen: typeof r.said_when === 'string' && r.said_when.trim() ? r.said_when.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '',
    firmness: FIRMNESS.includes(r.firmness) ? r.firmness : 'unclear',
    origin: ORIGIN_LABEL[r.origin] ? r.origin : 'telegram',
    day: DAY.test(String(r.origin_day || '')) ? r.origin_day : '',
    status: ['new', ...DECISIONS].includes(r.status) ? r.status : 'new',
  };
}
export const cleanNotes = rows => (Array.isArray(rows) ? rows : []).map(cleanNote).filter(Boolean);

// 'M/D'(origin_day). 없으면 빈 글.
export const shortDay = day => (DAY.test(day || '') ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : '');
// 줄 아래 작은 줄 왼쪽: '말한 때: … · 통화 · 11/5'.
export function metaLine(n) {
  return [n.saidWhen ? `말한 때: ${n.saidWhen}` : '', ORIGIN_LABEL[n.origin], shortDay(n.day)].filter(Boolean).join(' · ');
}
export const suggestions = notes => notes.filter(n => n.status === 'new');
// 할 일·일정 창에 미리 채울 제목·메모. 날짜는 바꾸지 않고 '말한 때' 글로만 메모에 둔다(명진이 달력으로 고름).
export function draftOf(n) {
  return {title: [...n.body].slice(0, 100).join(''), memo: n.saidWhen ? `말한 때: ${n.saidWhen}` : ''};
}
// 상태 바꾸기 몸통(authenticated가 고칠 수 있는 칸만: status·decided_at·updated_at).
export function decisionBody(status, nowIso) {
  if (!DECISIONS.includes(status) && status !== 'new') return null;
  return {status, decided_at: status === 'new' ? null : nowIso, updated_at: nowIso};
}
// 주소의 family=1(폰 알림을 눌러 연 것) → 칸이 보이게 스크롤한다.
export function openedFromPush(search) {
  try { return new URLSearchParams(String(search || '')).get('family') === '1'; } catch { return false; }
}

// ── 노트로(S51-26) ──
// 노트 한 줄 = 체크 목록 한 줄 '☐ 내용 (통화 11/5)'. 했음은 노트에서 ☐ → ☑(편집기 기호 목록에 둘 다 있음).
// 말한 때가 있으면 괄호 안에 함께 둔다('(통화 11/5 · 말한 때: 토요일)'). 줄 하나는 300자 안쪽으로 자른다.
export const CHECK_OPEN = '☐', CHECK_DONE = '☑';
export function noteLine(n, done = false) {
  const where = [ORIGIN_LABEL[n.origin], shortDay(n.day)].filter(Boolean).join(' ');
  const tail = [where, n.saidWhen ? `말한 때: ${n.saidWhen}` : ''].filter(Boolean).join(' · ');
  return [...`${done ? CHECK_DONE : CHECK_OPEN} ${n.body}${tail ? ` (${tail})` : ''}`].slice(0, 300).join('');
}

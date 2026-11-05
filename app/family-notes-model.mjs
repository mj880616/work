// FAMILY-잊지말기 4단계(설계 docs/design/tg-personal.md 5·6절, 명진 결정 11/05 시안 A): 홈 [하루] '잊지 말기' 칸의 규칙. 화면·서버 호출 없이 node --test로 확인한다.
// 줄은 서버(collector-feed)가 가족 1명의 대화·통화에서 뽑은 한 줄이다(원문 없음). 화면은 글자로만 그린다(HTML 해석 금지).
// 상태: new(제안) → kept(기억만)·tasked(할 일로)·scheduled(일정으로)·dismissed(×). [×]도 줄을 지우지 않는다.

export const KIND_LABEL = Object.freeze({plan: '약속·계획', ask: '부탁', like: '좋아함', dislike: '싫어함', date: '기념일', gift: '선물 거리', remind: '잊지 마'});
export const FIRM_LABEL = Object.freeze({firm: '확정', planned: '예정', unclear: '확인'});
export const ORIGIN_LABEL = Object.freeze({telegram: '텔레그램', call: '통화'});
export const DECISIONS = Object.freeze(['kept', 'tasked', 'scheduled', 'dismissed']);
// 기억 모음 세 묶음(설계 6절). 하자고 한 것 묶음만 '했음' 표시가 있다(DB 검사 done_check와 같은 종류).
export const GROUPS = Object.freeze([
  ['taste', '좋아함 · 싫어함', ['like', 'dislike']],
  ['todo', '하자고 한 것 · 부탁', ['plan', 'ask', 'remind']],
  ['dates', '기념일 · 선물 거리', ['date', 'gift']],
]);
export const DONE_KINDS = Object.freeze(['plan', 'ask', 'remind']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 화면이 읽는 칸(소유자 RLS + 운영자 기능 family 정책). 원문 칸은 표에 없다. 표 이름·주소는 family-notes-data.js 한 곳.
export const NOTE_SELECT = 'id,kind,body,said_when,firmness,origin,origin_day,drive_url,status,done_at,created_at';

// 서버 줄 → 화면 줄. 모양이 틀린 줄은 버린다.
export function cleanNote(r) {
  if (!r || typeof r !== 'object' || !UUID.test(String(r.id || ''))) return null;
  if (!KIND_LABEL[r.kind] || typeof r.body !== 'string' || !r.body.trim()) return null;
  return {
    id: String(r.id), kind: r.kind, body: r.body.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim(),
    saidWhen: typeof r.said_when === 'string' && r.said_when.trim() ? r.said_when.trim() : '',
    firmness: FIRM_LABEL[r.firmness] ? r.firmness : 'unclear',
    origin: ORIGIN_LABEL[r.origin] ? r.origin : 'telegram',
    day: DAY.test(String(r.origin_day || '')) ? r.origin_day : '',
    driveUrl: typeof r.drive_url === 'string' && /^https:\/\/(drive|docs)\.google\.com\//.test(r.drive_url) ? r.drive_url : '',
    status: ['new', ...DECISIONS].includes(r.status) ? r.status : 'new',
    done: !!r.done_at,
  };
}
export const cleanNotes = rows => (Array.isArray(rows) ? rows : []).map(cleanNote).filter(Boolean);

// 'M/D'(origin_day). 없으면 빈 글.
export const shortDay = day => (DAY.test(day || '') ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : '');
export function metaLine(n) {
  return [n.saidWhen ? `말한 때: ${n.saidWhen}` : '', ORIGIN_LABEL[n.origin], shortDay(n.day)].filter(Boolean).join(' · ');
}
export const suggestions = notes => notes.filter(n => n.status === 'new');
// 기억 모음: 제안을 지나 남긴 줄(기억만·할 일로·일정으로). 하자고 한 것 묶음은 안 한 것 먼저, 한 것은 뒤(접힘).
export function memoryGroups(notes) {
  const kept = notes.filter(n => n.status !== 'new' && n.status !== 'dismissed');
  return GROUPS.map(([key, label, kinds]) => {
    const rows = kept.filter(n => kinds.includes(n.kind));
    return {key, label, open: rows.filter(n => !n.done), done: rows.filter(n => n.done)};
  }).filter(g => g.open.length || g.done.length);
}
// 할 일·일정 창에 미리 채울 제목·메모. 날짜는 바꾸지 않고 '말한 때' 글로만 메모에 둔다(명진이 달력으로 고름).
export function draftOf(n) {
  return {title: [...n.body].slice(0, 100).join(''), memo: n.saidWhen ? `말한 때: ${n.saidWhen}` : ''};
}
// 상태 바꾸기 몸통(authenticated가 고칠 수 있는 칸만: status·decided_at·done_at·updated_at).
export function decisionBody(status, nowIso) {
  if (!DECISIONS.includes(status) && status !== 'new') return null;
  return {status, decided_at: status === 'new' ? null : nowIso, updated_at: nowIso};
}
export function doneBody(n, done, nowIso) {
  if (!DONE_KINDS.includes(n.kind)) return null;
  return {done_at: done ? nowIso : null, updated_at: nowIso};
}
// 주소의 family=1(폰 알림을 눌러 연 것) → 칸을 펼친 채 연다.
export function openedFromPush(search) {
  try { return new URLSearchParams(String(search || '')).get('family') === '1'; } catch { return false; }
}

// TG-발언자이름 4단계 (docs/design/telegram-sender-names.md 6절): 텔레그램 원문 줄의 A·B에 이름을 입히는 규칙. DOM·네트워크 없이 순수 계산만 한다.
// 표시 순서(명진 결정): 손으로 붙인 이름(name) → "나"(is_self) → 수집기 이름(auto_name) → A 그대로. 표가 비었거나 읽기가 실패하면(index가 null) 지금처럼 A·B.
// 원문(raw_text)은 한 글자도 바꾸지 않고, (방, 날짜, 라벨)로 사람을 찾아 화면에서만 입힌다. AI 요약에는 이름이 가지 않는다.
export const NAME_MAX = 40;

// 서버 함수(app_tg_sender_set_name)와 같은 검사: 앞뒤 공백 뺀 1~40자(글자 수), 제어문자 없음.
export function cleanName(value) {
  const name = String(value ?? '').trim();
  if (!name) return {ok:false, error:'EMPTY'};
  if ([...name].length > NAME_MAX) return {ok:false, error:'TOO_LONG'};
  if (/[\u0000-\u001f\u007f-\u009f]/.test(name)) return {ok:false, error:'CONTROL'};
  return {ok:true, name};
}
export const NAME_ERROR_TEXT = {
  EMPTY:'이름을 적어 주세요.',
  TOO_LONG:`이름은 ${NAME_MAX}자까지 쓸 수 있어요.`,
  CONTROL:'이름에 줄바꿈이나 특수 문자는 쓸 수 없어요.',
};

const SEP = '\u0001';
export const linkKey = (room, day, label) => `${room}${SEP}${day}${SEP}${label}`;

// senders: [{id, name, auto_name, is_self, keyed}], links: [{room_key, day, label, sender_id}] → 찾아보기 표. 읽기 실패(null)면 null.
export function buildIndex(senders, links) {
  if (!Array.isArray(senders) || !Array.isArray(links)) return null;
  const byId = new Map(senders.map(s => [s.id, s])), byLink = new Map();
  for (const l of links) { const s = byId.get(l?.sender_id); if (s) byLink.set(linkKey(l.room_key, l.day, l.label), s); }
  return {byId, byLink};
}

// 한 사람(또는 없음)이 라벨 자리에 어떻게 보이나. kind: name(직접) | self(나) | auto(수집기) | label(A 그대로).
export function senderShown(sender, label = '') {
  const clean = v => (typeof v === 'string' && v.trim() ? v.trim() : '');
  if (clean(sender?.name)) return {text:clean(sender.name), kind:'name'};
  if (sender?.is_self === true) return {text:'나', kind:'self'};
  if (clean(sender?.auto_name)) return {text:clean(sender.auto_name), kind:'auto'};
  return {text:label, kind:'label'};
}

// telegramLines() 결과에 이름을 입힌다. canName: 이름표를 읽었을 때만 [이름 붙이기]를 보인다(저장할 수 없으면 숨김).
// same: 같은 이름이 이어서 말하면 첫 줄에만 쓰고 나머지는 흐리게 줄인다(이름 없는 A·B는 줄마다 그대로).
// tag: 이름 없는 라벨의 그 방·그 날 첫 줄에만 [이름 붙이기].
export function rawRows(lines, index, room, day, {canName = false} = {}) {
  const tagged = new Set(); let prev = null;
  return lines.map(l => {
    if (!l.who) { prev = null; return {...l, shown:{text:'', kind:'label'}, same:false, tag:false, sender:null}; }
    const sender = index?.byLink.get(linkKey(room, day, l.who)) || null, shown = senderShown(sender, l.who);
    const named = shown.kind !== 'label';
    const same = named && prev === shown.text;
    const tag = canName && !named && !tagged.has(l.who); if (tag) tagged.add(l.who);
    prev = named ? shown.text : null;
    return {...l, shown, same, tag, sender};
  });
}

const dayShort = day => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(day || '')); return m ? `${Number(m[1])}. ${Number(m[2])}.` : ''; };
export { dayShort };

// 이름 표 관리 목록. 최근 본 날 순. unnamed: 이름도 "나"도 없는 사람. latest: 이름 붙이기에 쓸 가장 최근 (방, 날짜, 라벨).
export function peopleRows(senders, links, roomLabelOf = k => k) {
  const agg = new Map();
  for (const l of Array.isArray(links) ? links : []) {
    const a = agg.get(l.sender_id) || {rooms:new Set(), last:null};
    a.rooms.add(l.room_key);
    if (!a.last || l.day > a.last.day) a.last = {room_key:l.room_key, day:l.day, label:l.label};
    agg.set(l.sender_id, a);
  }
  const out = (Array.isArray(senders) ? senders : []).map(s => {
    const a = agg.get(s.id), shown = senderShown(s, ''), unnamed = shown.kind === 'label';
    const source = s.name ? '직접' : shown.kind === 'self' ? '나' : shown.kind === 'auto' ? '자동' : '';
    return {id:s.id, shown, unnamed, source, keyed:!!s.keyed, hasName:!!(s.name && s.name.trim()), rooms:a ? a.rooms.size : 0, last:a?.last || null,
      roomLabel:a?.last ? roomLabelOf(a.last.room_key) : ''};
  });
  out.sort((x, y) => (y.last?.day || '').localeCompare(x.last?.day || '') || x.id.localeCompare(y.id));
  return out;
}
// 이미 있는 사람을 칩으로 고르게 한다(같은 사람을 날마다 새로 만들지 않게). 이름 있는 사람만, 같은 글자는 하나로.
export function chipsOf(people, excludeId = '', max = 12) {
  const seen = new Set(), out = [];
  for (const p of people) {
    if (p.unnamed || p.source === '나' || p.id === excludeId || seen.has(p.shown.text)) continue;
    seen.add(p.shown.text); out.push({id:p.id, text:p.shown.text}); if (out.length >= max) break;
  }
  return out;
}

// RPC 오류 → 짧은 이름표. GONE: 그 사이 사라짐, UNAVAILABLE: 함수가 아직 없음.
export function senderError(error) {
  const status = Number(error?.status) || 0, text = String(error?.message || error?.code || '');
  if (/TG_SENDER_NOT_FOUND/.test(text)) return 'GONE';
  if (/TG_SENDER_NAME/.test(text)) return 'NAME';
  if (/TG_SENDER_(ARGS|LABEL|ITEM)/.test(text)) return 'ARGS';
  if (status === 404 || /PGRST202|Could not find the function/i.test(text)) return 'UNAVAILABLE';
  return status >= 400 && status < 500 ? 'REFUSED' : 'UNKNOWN';
}
export const SENDER_FAIL_TEXT = {
  GONE:'그 사람이 그사이 사라졌어요. 목록을 다시 불러왔어요.',
  NAME:'이름을 저장하지 못했어요. 40자까지, 줄바꿈 없이 써 주세요.',
  ARGS:'이 소식에는 이름을 붙일 수 없어요. 아무것도 바뀌지 않았어요.',
  UNAVAILABLE:'이름 붙이기가 아직 준비되지 않았어요. 아무것도 바뀌지 않았어요.',
  REFUSED:'저장하지 못했어요. 아무것도 바뀌지 않았어요.',
  UNKNOWN:'저장했는지 확인하지 못했어요. 목록을 다시 불러왔어요.',
};
export const MERGE_NOTE = '합치면 되돌릴 수 없어요. 두 사람 모두 열쇠가 있으면 앞으로 새 사람이 생길 수 있어요.';
export const MERGE_BOTH_KEYED = '이 두 사람은 모두 열쇠가 있어요. 합치면 한쪽 열쇠가 사라져, 그 사람의 새 메시지가 오면 다시 새 사람으로 생길 수 있어요.';

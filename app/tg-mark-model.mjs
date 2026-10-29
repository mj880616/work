// TG-요청강조·안본것: 텔레그램 소식 목록의 방·날 줄 표시(나한테 온 요청 · 담당조직·일정 꼬리표 · 칸 거르기). 순수 규칙, DOM·네트워크 없음.
// 그리는 곳은 telegram-feed.js 하나. 나한테 온 요청은 새 AI 판정이 아니라 수집 서버(collector-feed)가 챙길 것 후보로 남긴 ask_me 결과
// (app_todo_candidates, source_kind='telegram', status='open')를 그대로 쓴다. 줄 열쇠는 tg-day-model.mjs rdKey와 같은 '방|날'.
import {rdKey} from './tg-day-model.mjs';

export const ASK_TAG = '나한테 요청';
export const ORG_TAG = '담당조직';
export const SCHEDULE_TAG = '일정';
// 칸 거르기: '' = 전체(폴더 칸이 거름), 'ask' = 나한테 온 요청이 있는 줄만, 'unseen' = 안 본 줄만.
export const FILTERS = Object.freeze(['', 'ask', 'unseen']);

const text = v => (typeof v === 'string' ? v.trim() : '');

// 열린 텔레그램 후보 → 줄 열쇠마다 요청 목록, 소식 id마다 요청 글. 방을 모르는 후보(소식 읽기 실패)는 줄에 붙이지 않는다.
export function askIndex(rows) {
  const byLine = new Map(), byItem = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.source_kind !== 'telegram' || r.status !== 'open' || !text(r.summary)) continue;
    const room = text(r.tg?.room_key), day = text(r.source_day);
    if (!room || !day) continue;
    const key = rdKey(room, day), ask = {id:String(r.id), item:String(r.source_id).toLowerCase(), summary:text(r.summary)};
    (byLine.get(key) || byLine.set(key, []).get(key)).push(ask);
    if (!byItem.has(ask.item)) byItem.set(ask.item, ask.summary);
  }
  return {byLine, byItem};
}
// 줄 아래 꼬리표: '나한테 요청 · 면담 가능 시간 회신', 둘 이상이면 ' 외 n'.
export function askTagText(asks) {
  const list = Array.isArray(asks) ? asks : [];
  if (!list.length) return '';
  return `${ASK_TAG} · ${list[0].summary}${list.length > 1 ? ` 외 ${list.length - 1}` : ''}`;
}

// 일정 관련: 날짜·시각·요일·'일정'·'마감' 같은 낱말이 소식 제목·요약에 있으면. AI 없이 글자 모양만 본다.
const SCHEDULE = /(\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*[./]\s*\d{1,2}\s*[.(]|\d{1,2}일\s*\(|(오전|오후)\s*\d{1,2}\s*시|\d{1,2}\s*시\s*(\d{1,2}\s*분|까지|부터|에|반)|\d{1,2}:\d{2}|[월화수목금토일]요일|내일|모레|다음\s*주|일정|마감|기한)/;
export const isScheduleText = v => SCHEDULE.test(String(v ?? ''));
// 소식 줄(room_key, day, organization_id, title, summary) → 줄 열쇠마다 {org, schedule}. mine: 내 담당조직 id 모음.
export function markIndex(items, mine) {
  const out = new Map(), my = mine instanceof Set ? mine : new Set();
  for (const r of Array.isArray(items) ? items : []) {
    const room = text(r?.room_key), day = text(r?.day);
    if (!room || !day) continue;
    const key = rdKey(room, day), m = out.get(key) || {org:false, schedule:false};
    if (r.organization_id && my.has(String(r.organization_id))) m.org = true;
    if (isScheduleText(r.title) || isScheduleText(r.summary)) m.schedule = true;
    out.set(key, m);
  }
  return out;
}
// 회색 작은 꼬리표: '담당조직 · 일정', 하나만 있으면 그 낱말 하나. 없으면 ''.
export function markTagText(mark) {
  return [mark?.org ? ORG_TAG : '', mark?.schedule ? SCHEDULE_TAG : ''].filter(Boolean).join(' · ');
}

// 칸 거르기와 숫자. lines는 이미 폴더·보관으로 거른 목록이 아니라 지금 목록 전체(보관 제외)다.
export function askCount(lines, byLine) {
  let n = 0;
  for (const l of Array.isArray(lines) ? lines : []) n += byLine?.get(rdKey(l.room_key, l.day))?.length || 0;
  return n;
}
// keep: 지금 열려 있는 줄(열자마자 '봤음'이 되어도 [안 본 것] 목록에서 바로 빠지지 않게).
export function filterLines(lines, filter, {byLine, seen, keep = ''} = {}) {
  const list = Array.isArray(lines) ? lines : [];
  if (filter === 'ask') return list.filter(l => (byLine?.get(rdKey(l.room_key, l.day))?.length || 0) > 0);
  if (filter === 'unseen') return seen instanceof Map ? list.filter(l => rdKey(l.room_key, l.day) === keep || isUnseen(l, seen)) : list;
  return list;
}

// TG-안본것: '봤음' 시각(app_feed_room_days.seen_at)과 그 줄의 고친 시각(updated_at: 수집 서버가 새 묶음 요약을 더할 때 바뀜) → 줄 열쇠마다.
// 모양이 틀린 줄은 버린다.
export function seenIndex(rows) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const room = text(r?.room_key), day = text(r?.day), at = Date.parse(r?.seen_at), up = Date.parse(r?.updated_at);
    if (room && day && Number.isFinite(at)) out.set(rdKey(room, day), {at, up:Number.isFinite(up) ? up : 0});
  }
  return out;
}
// 연 줄을 화면에서 바로 '봤음'으로(서버 저장이 끝나기 전). 돌려준 Map은 새 것.
export function withSeen(seen, room, day, at = Date.now()) {
  const out = new Map(seen instanceof Map ? seen : []), key = rdKey(room, day), cur = out.get(key);
  out.set(key, {at, up:cur?.up || 0});
  return out;
}
// 안 본 것: 열어 본 적이 없거나, 연 뒤에 새 소식이 왔다(새 묶음 요약이 더해졌거나 그 방·날 마지막 소식 시각이 봤음 시각보다 늦음).
export function isUnseen(line, seen) {
  if (!(seen instanceof Map) || !line) return false;
  const s = seen.get(rdKey(line.room_key, line.day));
  if (!s) return true;
  const last = Date.parse(line.last_at);
  return s.up > s.at || (Number.isFinite(last) && last > s.at);
}
export function unseenCount(lines, seen) {
  return seen instanceof Map ? (Array.isArray(lines) ? lines : []).filter(l => isUnseen(l, seen)).length : 0;
}

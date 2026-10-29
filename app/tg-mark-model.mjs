// TG-요청강조·안본것: 텔레그램 소식 목록의 방·날 줄 표시(나한테 온 요청 · 담당조직·일정 꼬리표 · 칸 거르기). 순수 규칙, DOM·네트워크 없음.
// 그리는 곳은 telegram-feed.js 하나. 나한테 온 요청은 새 AI 판정이 아니라 수집 서버(collector-feed)가 챙길 것 후보로 남긴 ask_me 결과
// (app_todo_candidates, source_kind='telegram', status='open')를 그대로 쓴다. 줄 열쇠는 tg-day-model.mjs rdKey와 같은 '방|날'.
import {rdKey} from './tg-day-model.mjs';

export const ASK_TAG = '나한테 요청';
export const ORG_TAG = '담당조직';
export const SCHEDULE_TAG = '일정';
// 칸 거르기: '' = 전체(폴더 칸이 거름), 'ask' = 나한테 온 요청이 있는 줄만.
export const FILTERS = Object.freeze(['', 'ask']);

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
export function filterLines(lines, filter, {byLine} = {}) {
  const list = Array.isArray(lines) ? lines : [];
  if (filter === 'ask') return list.filter(l => (byLine?.get(rdKey(l.room_key, l.day))?.length || 0) > 0);
  return list;
}

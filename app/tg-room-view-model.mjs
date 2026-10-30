// TG-방별보기 (요청함 10/30 11:28, 명진 결정 "OKAY"): 텔레그램 소식 [날짜별 | 방별] 가운데 방별의 순수 규칙.
// DOM·네트워크 없음. 재료는 날짜별과 같은 방·날 줄(app_feed_room_day_lines, tg-day-model.mjs lineOf)뿐이고 새 읽기는 없다.
// 방 이름·내용은 시험에 가짜 값만 쓴다.
import {sortLines} from './tg-day-model.mjs';

// 보기 이름(서버 화면 기억 view_prefs.tg_view, DB 검사와 같은 값). 없으면 날짜별.
export const TG_VIEWS = Object.freeze(['day', 'room']);
export const DEFAULT_TG_VIEW = 'day';
export const tgViewOf = v => (TG_VIEWS.includes(v) ? v : DEFAULT_TG_VIEW);
// 방 상세(방별)에 한 번에 더 그리는 날 수. 아래로 내리면 이만큼씩 이어 그린다.
export const ROOM_DAY_PAGE = 3;

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
// 방 줄의 날짜: "10.30 (금)".
export function roomDayText(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return '';
  const w = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return `${Number(m[2])}.${m[3]} (${WEEK[w]})`;
}

// 방별 목록: 방마다 {room_key, room_label, last(가장 최근 날 줄), days(소식 있는 날 수, 불러온 기간 안), lines(그 방 줄, 최근 날 먼저)}.
// lines는 이미 거른 줄(liveLines·filterLines)이다. 순서 = 가장 최근 소식 먼저(날짜, 같은 날이면 늦게 온 방 먼저).
export function roomGroups(lines) {
  const map = new Map();
  for (const l of sortLines(lines)) {
    const g = map.get(l.room_key);
    if (g) { if (!g.lines.some(x => x.day === l.day)) g.lines.push(l); continue; }
    map.set(l.room_key, {room_key:l.room_key, room_label:l.room_label, last:l, lines:[l]});
  }
  return [...map.values()].map(g => ({...g, days:g.lines.length}));
}
// 방 상세(방별)에 보일 날: 그 방의 지우지 않은 날, 최근 날 먼저(날짜만).
export function roomDays(lines, room) {
  return [...new Set((lines || []).filter(l => l.room_key === room && !l.day_hidden_at).map(l => l.day))].sort().reverse();
}
// 지금 그릴 날 수: shown(그려 둔 수)과 날 목록. more = 아직 그리지 않은 날이 있거나 더 옛 기간을 읽을 수 있음.
export function roomPage(days, shown, {end = true} = {}) {
  const n = Math.max(0, Math.min(days.length, Number(shown) || 0));
  return {days:days.slice(0, n), more:n < days.length || !end};
}

// HOME-하루채우기 ① 오늘 사진 한 줄(2026-11-09 명진 시안 ④ 승인): 그날 사진을 고르는 규칙과 한 줄에 들어가는 칸 수. AI 없음, 화면 메모리만.
// 순서 규칙(위가 먼저):
//   1) 별표한 사진 맨 앞
//   2) 그날 일정 시간(시작~끝) 안에 찍은 사진
//   3) 그 밖의 사진(일기에 직접 넣은 사진 → 찍은 시각 순)
//   4) 화면 캡처는 맨 뒤
// 연속 촬영(앞 사진과 BURST_MS 안 간격)은 한 장만 남긴다(별표 → 캡처 아닌 것 → 먼저 찍은 것 순으로 남김).
// 흐린 사진은 지금 목록에 판별할 값이 없어(원드라이브·폰 목록에 선명도 값 없음) 고르지 않는다. 캡처는 폰 목록의 screenshot 표시와
// 파일 이름('Screenshot'·'스크린샷'·'캡처')으로만 본다.
export const BURST_MS = 3000;
export const CELL_PX = 56;   // ui-standard.css .act-photo-thumb 한 칸(공용 사진 칸)
export const GAP_PX = 4;

const SHOT_NAME = /(screen[\s_-]?shot|스크린샷|캡처|화면\s*캡쳐)/i;
export const isShot = item => item?.screenshot === true || SHOT_NAME.test(String(item?.name || item?.file?.file_name || ''));
export const takenMs = item => { const ms = Date.parse(item?.taken_at || ''); return Number.isFinite(ms) ? ms : null; };
const isVideo = item => item?.video === true || /^video\//.test(String(item?.file?.mime_type || ''));

// windows: [{from, to}] (ms). 시각이 없는 사진(일기에 직접 넣은 사진)은 일정 안으로 보지 않는다.
export const inWindow = (ms, windows) => ms !== null && (windows || []).some(w => Number.isFinite(w?.from) && Number.isFinite(w?.to) && ms >= w.from && ms < w.to);

// 연속 촬영 묶음에서 남길 한 장.
function keepOf(group, starred) {
  return group.find(starred) || group.find(item => !isShot(item)) || group[0];
}
// 시각 있는 사진을 찍은 순으로 늘어놓고, 앞 사진과 BURST_MS 안이면 같은 묶음으로 본다.
export function dropBursts(items, {starred = () => false, burstMs = BURST_MS} = {}) {
  const timed = items.filter(item => takenMs(item) !== null).sort((a, b) => takenMs(a) - takenMs(b));
  const keep = new Set();
  let group = [];
  for (const item of timed) {
    if (group.length && takenMs(item) - takenMs(group[group.length - 1]) > burstMs) { keep.add(keepOf(group, starred)); group = []; }
    group.push(item);
  }
  if (group.length) keep.add(keepOf(group, starred));
  return items.filter(item => takenMs(item) === null || keep.has(item));
}

// 그날 사진 → 보일 순서. items는 dayItems·phoneDayItems가 만든 칸({kind, source, key, taken_at, name, screenshot?, video?}).
export function rankDayPhotos(items, {starred = () => false, windows = [], burstMs = BURST_MS} = {}) {
  const list = dropBursts((items || []).filter(item => item && !isVideo(item)), {starred, burstMs});
  const tier = item => (starred(item) ? 0 : isShot(item) ? 3 : inWindow(takenMs(item), windows) ? 1 : 2);
  // 같은 층에서는 시각 없는 것(일기에 넣은 사진)을 먼저, 그다음 찍은 시각 순. 원래 순서를 끝 기준으로 둔다(같은 결과).
  const order = new Map(list.map((item, i) => [item, i]));
  const at = item => takenMs(item) ?? -Infinity;
  return list.slice().sort((a, b) => tier(a) - tier(b) || at(a) - at(b) || order.get(a) - order.get(b));
}

// 한 줄 폭(px) → 보일 사진 칸 수와 '+n'. 다 들어가면 more 0. 넘치면 마지막 칸을 '+n'으로 쓴다.
export function stripFit(width, total, {cell = CELL_PX, gap = GAP_PX} = {}) {
  const n = Math.max(0, Math.floor(Number(total) || 0));
  const cols = Math.max(1, Math.floor((Math.max(0, Number(width) || 0) + gap) / (cell + gap)));
  if (n <= cols) return {cols, shown:n, more:0};
  const shown = Math.max(0, cols - 1);
  return {cols, shown, more:n - shown};
}

// 그날 일정 → 시간 칸(종일 일정은 뺀다). event는 google-calendar 읽기 모양({start, end, allDay}).
export function eventWindows(events) {
  const out = [];
  for (const event of events || []) {
    if (!event || event.allDay || /^\d{4}-\d{2}-\d{2}$/.test(String(event.start || ''))) continue;
    const from = Date.parse(event.start || ''), to = Date.parse(event.end || '');
    if (Number.isFinite(from)) out.push({from, to:Number.isFinite(to) && to > from ? to : from + 60 * 60 * 1000});
  }
  return out;
}

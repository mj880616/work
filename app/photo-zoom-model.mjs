// PHOTO-연월보기(S49-48, 명진 결정 11/04 22:00 "시안대로"): [사진] 탭 보기 단계 = 일별 격자 → 월 보기 → 연 보기.
// 이 파일은 계산만 한다(화면·서버 없음). 단계 목록의 뜻:
// - 일별 격자의 칸 수 단계(photo-grid-size.js·photos-model.mjs stepPhotoCols)가 끝(가장 작은 사진)이면 [－]·오므리기는 월 보기로, 월 → 연으로 넘어간다. [＋]·벌리기는 그 반대.
// - 단계는 서버(view_prefs.photo_zoom, 기기 종류별)에 기억한다. 달력 탭에는 연·월 단계가 없다(날짜 칸만).
export const ZOOM_LEVELS = Object.freeze(['day', 'month', 'year']); // 큰 → 작은
export const MONTH_STRIP = Object.freeze({narrow: 6, wide: 10}); // 월 보기 한 줄 작은 사진 수(폰·PC)
export const YEAR_STRIP = Object.freeze({narrow: 2, wide: 4});   // 연 보기 대표 사진 수

export const validZoom = v => ZOOM_LEVELS.includes(v);
export const zoomOf = v => (validZoom(v) ? v : 'day');
export const stripCount = (level, wide) => (level === 'year' ? YEAR_STRIP : MONTH_STRIP)[wide ? 'wide' : 'narrow'];

// 한 단계 옮긴다. dir>0 크게(+), dir<0 작게(－). dayStep(dir)은 일별 칸 수를 한 단계 바꾸고 바뀌었으면 true.
// 돌려주는 값: {level, moved} — moved가 false면 끝이라 아무것도 하지 않은 것.
export function stepZoom(level, dir, dayStep) {
  const lv = zoomOf(level), d = Math.sign(dir);
  if (!d) return {level: lv, moved: false};
  if (lv === 'day') {
    if (dayStep?.(d)) return {level: 'day', moved: true, cols: true};
    return d < 0 ? {level: 'month', moved: true} : {level: 'day', moved: false};
  }
  if (lv === 'month') return {level: d < 0 ? 'year' : 'day', moved: true};
  return d > 0 ? {level: 'month', moved: true} : {level: 'year', moved: false};
}
// [－][＋]를 누를 수 있는가: [－]는 연 보기에서, [＋]는 일별 격자가 가장 큰 사진일 때 끝.
export function canStep(level, dir, dayCanStep) {
  const lv = zoomOf(level), d = Math.sign(dir);
  if (lv === 'year') return d > 0;
  if (lv === 'month') return !!d;
  return d < 0 || !!dayCanStep;
}

// months = [{key:'2026-10', n}] → 해별 묶음 [{year, n, months:[{key, month(0~11), n}]}] (해·달 모두 최근 먼저). 장수 0인 달은 뺀다.
export function groupMonths(months) {
  const by = new Map();
  for (const m of months || []) {
    const n = Number(m?.n);
    const hit = /^(\d{4})-(\d{2})$/.exec(String(m?.key || ''));
    if (!hit || !(n > 0)) continue;
    const year = Number(hit[1]), month = Number(hit[2]) - 1;
    if (month < 0 || month > 11) continue;
    const g = by.get(year) || {year, n: 0, months: []};
    g.n += n; g.months.push({key: m.key, month, n}); by.set(year, g);
  }
  for (const g of by.values()) g.months.sort((a, b) => (a.key < b.key ? 1 : -1));
  return [...by.values()].sort((a, b) => b.year - a.year);
}

// 대표 사진 고르기: 날마다 대표 하나씩(cells = calendarFromDays의 cells, count>0·rep 있는 것만) 중에서 별표 먼저, 그다음 이른 날. 새 요청 없이 받은 것만 쓴다.
export function pickReps(cells, limit, isStarred = () => false) {
  const list = (cells || []).filter(c => c?.count > 0 && c.rep);
  const star = list.filter(c => isStarred(c.rep)), rest = list.filter(c => !isStarred(c.rep));
  return [...star, ...rest].slice(0, Math.max(0, limit)).map(c => c.rep);
}
// 연 보기 한 줄이 대표를 받아 올 달: 그 해에서 사진이 있는 달을 고르게 뽑는다(최대 count달, 이른 달부터 같은 간격).
export function yearSampleMonths(months, count) {
  const asc = [...(months || [])].sort((a, b) => (a.key < b.key ? -1 : 1));
  if (asc.length <= count) return asc;
  return Array.from({length: count}, (_, i) => asc[Math.round(i * (asc.length - 1) / (count - 1 || 1))]);
}

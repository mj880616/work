// WEEKLY-일정다듬기(2026-10-23 사용자 요청 12:43 ④⑤): 주간보고 한글 파일 5. 주요 일정 칸 — 화면 없는 부분(시험이 같은 코드를 부른다).
//   formWhat — 일정 칸 글 "시간 / 내용 / 장소"(세 부분 늘 채움, 장소가 없으면 '미정', 종일 일정은 시간 '종일').
//   applyTitles — 화면에서 확인·고친 제목·장소(키 → {title, place})를 칸 글에 넣는다. 고친 것이 없으면 달력 제목 그대로.
//   scheduleMismatches — 본문(요약·산하조직·투쟁 사업장 줄)과 일정표가 같은 날 다르게 적힌 곳을 찾는다(고치지 않음, 화면 표시만).
// AI(ai-assist kind=schedule_titles)가 다듬은 제목은 화면의 확인 목록에 들어갈 뿐이고, 여기서는 사람이 확인한 값만 쓴다.
import {orgKey} from '../org-name-match.mjs';

export const NO_PLACE = '미정';
export const ALL_DAY = '종일';
const one = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// 일정 하나 → 칸 글. time = 'HH:MM' | '종일'. 제목이 비면 '(제목 없음)'.
export const formWhat = ({time, title, place}) => [one(time) || ALL_DAY, one(title) || '(제목 없음)', one(place) || NO_PLACE].join(' / ');

// calendar(journal-weekly.js upcomingSchedule)의 일정 하나에 화면 확인 값(overrides: Map(key → {title, place}))을 넣은 칸 글.
// 시간·제목 칸이 없는 옛 모양 일정({what}만)은 그대로 둔다.
export function itemWhat(item, overrides) {
  if (!item || item.time === undefined) return String(item?.what ?? '');
  const o = overrides?.get?.(item.key);
  // WEEKLY-주요일정칸: 칸별 고침의 시간(o.time)도 칸 글에 넣는다(날짜·참석은 scheduleForm이 줄·참석자 칸에).
  return formWhat({time: o && one(o.time) ? o.time : item.time, title: o && one(o.title) ? o.title : item.title, place: o && o.place !== undefined ? o.place : item.place});
}

// 확인 목록에 보일 일정(휴가 빼고, 표 순서 그대로). [{key, day, label, time, title, place, multi, memo?}] — memo = 주간보고 기억(weekly-schedule-memory.js)
export function scheduleItems(calendar) {
  const out = [], seen = new Set();
  if (!calendar || calendar.loading || calendar.failed?.length) return out;
  for (const row of calendar.rows ?? []) for (const item of row.items ?? []) {
    if (item.time === undefined || !item.key || seen.has(item.key)) continue;
    seen.add(item.key);
    out.push({key: item.key, day: row.day, label: row.label, time: item.time, title: item.title, place: item.place, multi: !!item.multi, ...(item.memo ? {memo: item.memo} : {})});
  }
  return out;
}

// ---- 본문과 일정표 맞추기(⑤) ----
// 본문 줄에서 날짜(M.D, M/D, M월 D일 — 일정표 14일 안의 날만)와 그 날짜 뒤의 시각(HH:MM, N시, N시 M분, 오전·오후)을 읽는다.
// 날짜가 여럿인 줄은 날짜마다 다음 날짜 앞까지가 그날 몫이다. '~' 뒤의 시각(끝 시각)은 보지 않는다.
const DATE = /(?<![\d.:])(\d{1,2})\s*(?:[./]\s*(\d{1,2})(?![\d:%])\.?|월\s*(\d{1,2})\s*일)(?:\s*\(\s*[월화수목금토일]\s*\))?/g;
const TIME = /(?<![\d.:])(오전|오후)?\s*(\d{1,2})\s*(?::\s*(\d{2})(?!\d)|시(?:\s*(\d{1,2})\s*분)?)/g;
const pad = n => String(n).padStart(2, '0');
function dayIn(month, day, days) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const tail = `-${pad(month)}-${pad(day)}`;
  return days.find(d => d.endsWith(tail)) ?? null;
}
function timesIn(text) {
  const out = [];
  for (const m of text.matchAll(TIME)) {
    const before = text.slice(0, m.index).replace(/\s+$/, '');
    if (/[~\-–～]$/.test(before)) continue;
    let h = Number(m[2]);
    const min = Number(m[3] ?? m[4] ?? 0);
    if (m[1] === '오후' && h < 12) h += 12;
    if (h > 24 || min > 59) continue;
    out.push(`${pad(h)}:${pad(min)}`);
  }
  return [...new Set(out)];
}
export function lineDates(text, days) {
  const src = String(text ?? ''), hits = [];
  for (const m of src.matchAll(DATE)) {
    const day = dayIn(Number(m[1]), Number(m[2] ?? m[3]), days);
    if (day) hits.push({day, at: m.index, end: m.index + m[0].length});
  }
  return hits.map((h, i) => ({day: h.day, times: timesIn(src.slice(h.end, hits[i + 1]?.at ?? src.length))}));
}
// 글 안에 이름이 든 조직(정식 이름·별칭, 띄어쓰기·노동조합=노조 무시, 3자 이상만). orgs = [{name, aliases}].
export function orgsIn(text, orgs) {
  const key = orgKey(text), out = new Set();
  for (const o of orgs ?? []) for (const n of [o?.name, ...(Array.isArray(o?.aliases) ? o.aliases : [])]) {
    const k = orgKey(n);
    if ([...k].length >= 3 && key.includes(k)) out.add(o.name);
  }
  return out;
}
// sections = [{where, lines:[글]}]; calendar = upcomingSchedule 결과; overrides = 화면 확인 값; orgs = [{name, aliases}].
// 돌려주는 것: [{day, where, line, body:[시각], events:[칸 글], kind:'time'|'missing', sure}]
//   time = 그날 일정은 있는데 본문 시각과 같은 시각의 일정이 없음(종일 일정만 있는 날 포함), missing = 본문에 시각까지 적힌 날에 일정이 없음.
//   sure = 본문 줄과 그날 일정에 같은 조직 이름이 있음(없으면 '확인'으로만 보임). 시각이 없는 본문 줄은 보지 않는다(일정표에 없는 일도 많음).
export function scheduleMismatches({sections, calendar, overrides, orgs = []}) {
  const out = [];
  if (!calendar || calendar.loading || calendar.failed?.length || !calendar.days?.length) return out;
  const byDay = new Map();
  for (const row of calendar.rows ?? []) for (const item of row.items ?? []) {
    if (item.multi) continue;
    const list = byDay.get(row.day) ?? byDay.set(row.day, []).get(row.day);
    list.push(item);
  }
  for (const {where, lines} of sections ?? []) for (const raw of lines ?? []) {
    const line = one(raw);
    if (!line) continue;
    const lineOrgs = orgsIn(line, orgs);
    for (const {day, times} of lineDates(line, calendar.days)) {
      if (!times.length) continue;
      const events = byDay.get(day) ?? [];
      const what = events.map(e => itemWhat(e, overrides));
      if (!events.length) { out.push({day, where, line, body: times, events: [], kind: 'missing', sure: false}); continue; }
      const at = new Set(events.map(e => overrides?.get?.(e.key)?.time || (e.time ?? String(e.what ?? '').split(' / ')[0])).filter(t => /^\d{2}:\d{2}$/.test(t)));
      if (times.every(t => at.has(t))) continue;
      const sure = events.some(e => [...orgsIn(itemWhat(e, overrides), orgs)].some(n => lineOrgs.has(n)));
      out.push({day, where, line, body: times, events: what, kind: 'time', sure});
    }
  }
  return out;
}

// ---- AI 제목 다듬기 요청·답(ai-assist kind=schedule_titles) ----
// 보내는 것: 그 주(월요일)와 확인 목록의 일정 줄(참조·날짜·시각·제목·장소)만. 업무 기록은 서버가 내 로그인으로 읽는다.
export const AI_MAX_EVENTS = 30;
export const AI_TITLE_CHARS = 80;
export const AI_PLACE_CHARS = 60;
const cut = (s, n) => [...one(s)].slice(0, n).join('');
export function titleRequest(start, items) {
  const list = items.slice(0, AI_MAX_EVENTS);
  return {
    body: {kind: 'schedule_titles', week_start: start, events: list.map((e, i) => ({ref: `e${i + 1}`, day: e.day, time: e.time, title: cut(e.title, AI_TITLE_CHARS) || '(제목 없음)', place: cut(e.place, AI_PLACE_CHARS)}))},
    refs: new Map(list.map((e, i) => [`e${i + 1}`, e.key])),
    more: items.length - list.length,
  };
}
const CLEAN = s => String(s ?? '').replace(/<\/?[A-Za-z][^<>]*>/g, '').replace(/[<>\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
// 답(믿지 않는 입력) → Map(key → {title, place}). 모르는 참조·빈 제목·너무 긴 글은 버린다.
export function titleAnswer(data, refs) {
  const out = new Map();
  if (!Array.isArray(data?.items)) return out;
  for (const item of data.items) {
    const key = refs.get(item?.ref);
    const title = CLEAN(item?.title), place = CLEAN(item?.place);
    if (!key || out.has(key) || !title || [...title].length > AI_TITLE_CHARS || [...place].length > AI_PLACE_CHARS) continue;
    out.set(key, {title, place});
  }
  return out;
}

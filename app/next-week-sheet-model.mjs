// JOURNAL-다음주준비 (설계 docs/design/next-week-sheet.md, 명진 결정: 금요일 15시 · [주간 정리] 맨 위 칸 · 업무 캘린더만 · [지금 만들기] 둠):
// 업무일지 [주간 정리] 맨 위 [다음 주] 칸 — 화면 쪽 순수 규칙. 읽기·저장은 next-week-sheet-data.js, 그리기는 journal-weekly.js renderNextWeekSheet.
// ① 다음 주 재료 ①~⑥ 줄 만들기(서버 ai-assist kind=next_week_sheet가 받는 모양 그대로) ② 저장된 장을 화면 모양으로 ③ 줄 → 원래 기록.
// - ① 일정은 [주간 정리] '5. 주요 일정'과 같은 규칙(journal-weekly.js upcomingSchedule: '공공운수노조' 업무 캘린더만, 일기·비공개 제외,
//   휴가 줄 제외)을 거친 줄만 쓴다. 개인 캘린더 일정은 장에도 AI에도 가지 않는다(결정 2).
// - ③ 원장 약속은 일반·내부(S0·S1)만. 교섭·전략(S2) 기록은 AI 재료로 보내지 않는다(원장 고치기 AI와 같은 선).
// - 원본(Google 할 일·캘린더·원장·챙길 것·회의)은 읽기만 한다. 이 장은 그 순간의 보기용 사본이다.
import {meetingKindKey} from './journal-meeting-kinds.js';

export const SHEET_HOUR = 15;
export const GROUP_CAP = 30;
export const ITEM_CAP = 150;
export const TITLE_MAX = 120;
export const ORG_MAX = 60;
export const NEXT_GROUPS = Object.freeze([
  ['events', '① 다음 주 일정'], ['tasks', '② 기한 있는 할 일'], ['commitments', '③ 다가오는 원장 약속'],
  ['overdue', '④ 넘어가는 할 일'], ['todos', '⑤ 남은 챙길 것'], ['meetings', '⑥ 지난 회의 후속'],
]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_ID = /^[A-Za-z0-9_.:@-]{1,200}$/;
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu;
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const clip = (text, max) => [...String(text ?? '').replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()].slice(0, max).join('').trim();
const firstLine = text => String(text ?? '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const dow = day => new Date(`${day}T00:00:00Z`).getUTCDay();
export const dayName = day => WEEKDAY[dow(day)];
export const slashDay = day => DAY.test(day || '') ? `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}(${dayName(day)})` : '';

// 한국 날짜·요일(월=1 … 일=7)·시, 그 주 월요일과 다음 주 월요일.
export function seoulNow(now = new Date()) {
  const d = new Date(now.getTime() + 9 * 3600 * 1000);
  const day = d.toISOString().slice(0, 10), isoDow = d.getUTCDay() || 7;
  const thisMonday = addDays(day, 1 - isoDow);
  return {day, isoDow, hour:d.getUTCHours(), thisMonday, nextMonday:addDays(thisMonday, 7)};
}
// 자동으로 만들 때: 금요일 15시 뒤, 또는 그 주 토·일(서버 ai-assist next-week-sheet.ts autoTime과 같은 규칙).
export const isAutoTime = (now = new Date()) => { const c = seoulNow(now); return (c.isoDow === 5 && c.hour >= SHEET_HOUR) || c.isoDow >= 6; };
// 이번 방문에 자동으로 한 번 부를까: 보이는 주가 이번 주이고, 표가 있고(DB 적용 뒤), 다음 주 장이 아직 없고, 시각이 되었고, 아직 안 물어봄.
export function shouldAutoMake({shownStart, now = new Date(), read, asked}) {
  const c = seoulNow(now);
  return shownStart === c.thisMonday && read?.status === 'ok' && !read.items?.missing && !read.items?.sheet && isAutoTime(now) && !asked;
}

const item = (group, title, day, source_kind, source_id, org = null) => {
  const t = clip(title, TITLE_MAX), o = org ? clip(org, ORG_MAX) : '';
  const id = String(source_id ?? '');
  if (!t || !SOURCE_ID.test(id)) return null;
  return {group, title:t, day:DAY.test(day || '') ? day : null, source_kind, source_id:id, org:o || null};
};
const taskDue = task => { const key = String(task?.due || '').slice(0, 10); return DAY.test(key) ? key : ''; };

// 다음 주(week = 다음 주 월요일) 재료 ①~⑥ 줄.
// schedule: journal-weekly.js upcomingSchedule(events, 이번 주 월요일)의 결과(업무 캘린더만). tasks: Google 할 일(끝나지 않은 것, 모든 기한).
// ledger: 원장 약속 행. todos: 열린 챙길 것 행. meetings: 정기회의 지난 회차 행(series_name 있음, 최근 순).
export function buildItems({week, schedule = null, tasks = null, ledger = null, todos = null, meetings = null}) {
  const last = addDays(week, 6), groups = Object.fromEntries(NEXT_GROUPS.map(([key]) => [key, []]));
  const push = (key, value) => { if (value && groups[key].length < GROUP_CAP) groups[key].push(value); };
  const nextEvents = [];
  for (const row of schedule?.rows || []) {
    if (row.day < week || row.day > last) continue;
    for (const ev of row.items || []) {
      const title = [ev.time && ev.time !== '종일' ? ev.time : '', ev.title, ev.place ? `· ${ev.place}` : ''].filter(Boolean).join(' ');
      push('events', item('events', title, row.day, 'event', ev.open?.id || `ev-${row.day}-${groups.events.length}`));
      nextEvents.push({day:row.day, title:ev.title});
    }
  }
  const pending = (tasks || []).filter(t => t?.status !== 'completed' && t?.id && taskDue(t))
    .sort((a, b) => taskDue(a).localeCompare(taskDue(b)) || String(a.title || '').localeCompare(String(b.title || ''), 'ko'));
  for (const t of pending) {
    const due = taskDue(t);
    if (due >= week && due <= last) push('tasks', item('tasks', t.title, due, 'task', t.id));
    else if (due < week) push('overdue', item('overdue', t.title, due, 'task', t.id));
  }
  for (const r of [...(ledger || [])].sort((a, b) => String(a.follow_up_on || '').localeCompare(String(b.follow_up_on || '')))) {
    if (r?.kind !== 'commitment' || r.commitment_status !== 'waiting' || !['current', 'needs_check'].includes(r.validity)) continue;
    if (!['S0', 'S1'].includes(r.sensitivity) || !(r.follow_up_on >= week && r.follow_up_on <= last)) continue;
    push('commitments', item('commitments', r.title, r.follow_up_on, 'ledger', r.id, r.counterparty));
  }
  // ⑤ 할 일로 보낸 챙길 것(task_id 있음)은 ②·④와 겹치므로 뺀다. 회의에서 나온 것은 ⑥에서 그 회의와 함께 보인다.
  const meetingTodos = new Map();
  for (const c of todos || []) {
    if (c?.status !== 'open' || c.task_id) continue;
    if (c.source_kind === 'meeting' && c.source_id) { const list = meetingTodos.get(String(c.source_id)) || []; list.push(c); meetingTodos.set(String(c.source_id), list); continue; }
    push('todos', item('todos', c.summary, c.due, 'todo', c.id));
  }
  // ⑥ 다음 주 일정 제목 ↔ 지난 회의 series_name(공백 없이·소문자, journal-meeting-kinds.js meetingKindKey). 맞는 회의의 가장 최근 회차 1건만.
  // 이름이 다르면 잇지 않는다(추정으로 잇지 않음).
  const seen = new Set();
  for (const ev of nextEvents) {
    const key = meetingKindKey(ev.title);
    if (!key || seen.has(key)) continue;
    const m = (meetings || []).find(row => row?.id && row.series_name && meetingKindKey(row.series_name) === key);
    if (!m) continue;
    seen.add(key);
    const round = Number.isFinite(Number(m.round_no)) && m.round_no !== null && m.round_no !== '' ? ` ${Number(m.round_no)}차` : '';
    const plan = firstLine(m.next_plan);
    push('meetings', item('meetings', `${m.series_name}(지난${round}) 후속: ${plan || '다음 할 일 없음'}`, ev.day, 'meeting', m.id));
    for (const c of meetingTodos.get(String(m.id)) || []) push('meetings', item('meetings', `${m.series_name} 후속: ${c.summary}`, c.due || ev.day, 'todo', c.id));
  }
  const out = [];
  for (const [key] of NEXT_GROUPS) for (const value of groups[key]) if (out.length < ITEM_CAP) out.push(value);
  return out;
}

// 묶음 한 줄 요약(접혀 있어도 보임).
export function groupSummary(key, items) {
  const n = items.length;
  if (key === 'events') {
    const counts = new Map();
    for (const it of items) if (it.day) counts.set(dayName(it.day), (counts.get(dayName(it.day)) || 0) + 1);
    const days = ['월', '화', '수', '목', '금', '토', '일'].filter(d => counts.has(d)).map(d => `${d} ${counts.get(d)}`);
    return `${n}건${days.length ? ` — ${days.join(' · ')}` : ''}`;
  }
  if (key === 'tasks') { const first = items.map(it => it.day).filter(Boolean).sort()[0]; return `${n}건${first ? ` — 가장 이른 것 ${slashDay(first)}` : ''}`; }
  if (key === 'commitments') return `${n}건 — ${slashDay(items[0].day)} ${items[0].title}`;
  if (key === 'overdue') return `${n}건 — 이번 주 기한 지남`;
  if (key === 'meetings') return `${n}건 — ${items[0].title}`;
  return `${n}건`;
}

const madeText = at => {
  const t = Date.parse(at || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600 * 1000), day = d.toISOString().slice(0, 10);
  return `${slashDay(day)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} 만듦`;
};
// 저장된 장(서버 행) → 화면 모양. 줄은 한 번 더 검사한다(믿지 않는 입력).
export function sheetView(row, week) {
  const groups = Array.isArray(row?.groups) ? row.groups : [];
  const items = groups.map((g, index) => ({...g, index}))
    .filter(g => NEXT_GROUPS.some(([key]) => key === g.group) && typeof g.title === 'string' && g.title.trim());
  const list = NEXT_GROUPS.map(([key, label]) => {
    const mine = items.filter(it => it.group === key);
    return mine.length ? {key, label, items:mine, summary:groupSummary(key, mine)} : null;
  }).filter(Boolean);
  const valid = new Set(items.map(it => it.index));
  const top = (Array.isArray(row?.top_lines) ? row.top_lines : []).slice(0, 3)
    .filter(t => typeof t?.text === 'string' && t.text.trim())
    .map(t => ({text:clip(t.text, 80), refs:(Array.isArray(t.refs) ? t.refs : []).filter(n => valid.has(n))}));
  const aiNote = row?.ai_status === 'limit' ? '핵심 세 가지는 이번 달 AI 한도로 만들지 못함.'
    : row?.ai_status === 'failed' ? '핵심 세 가지는 AI가 답하지 않아 만들지 못함.' : '';
  return {week, range:`${slashDay(week)}~${slashDay(addDays(week, 6))}`, made:madeText(row?.updated_at || row?.created_at), top, groups:list, aiNote, empty:!list.length};
}

// 줄 → 원래 기록(journal.js openOriginal의 대상 모양). 일정 → 달력 그날, 할 일 → 할 일 화면, 약속 → 원장 그 기록,
// 챙길 것 → 정리함, 회의 후속 → 그 회의 기록.
export function openTarget(it) {
  if (!it) return null;
  if (it.source_kind === 'event') return it.day ? {type:'calendar-day', day:it.day} : null;
  if (it.source_kind === 'task') return {type:'task', id:it.source_id};
  if (it.source_kind === 'ledger') return {type:'ledger', id:it.source_id};
  if (it.source_kind === 'todo') return {type:'todos'};
  if (it.source_kind === 'meeting') return {type:'meeting', id:it.source_id};
  return null;
}

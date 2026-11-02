// JOURNAL-오늘한일업무개인 (요청함 11/01 22:56·11/02 13:29 명진): 홈에서 넣은 '오늘 한 일' 줄을 달력 날짜 상세(일정 달력 날짜 창)와
// 일기 화면(그날 보기·쓰기)에서도 읽기만 해서 보인다 — 일기를 안 쓴 날도. 같은 자료(노트 표 kind=work, journal-data.js readWorkDay)를
// 읽을 뿐 두 벌 저장하지 않는다. 고치기·지우기는 홈에서만. 업무·개인을 가르지 않고 그대로 보인다(가르기는 업무 재료로 쓸 때만, work-scope.js).
import {readWorkDay, workLines, todayKey} from './journal-data.js';

export const doneTitle = day => day === todayKey() ? '오늘 한 일' : '그날 한 일';
// 그날 줄(없으면 빈 목록). 읽지 못하면 null.
export async function readDayDone(day, rt = window.KPTURuntime) {
  try { return workLines(await readWorkDay(day, rt)); } catch { return null; }
}
// 줄 목록 칸. 줄이 없거나 읽지 못하면 null(칸을 그리지 않음 — 빈 안내를 더하지 않는다).
export function dayDoneSection(day, lines, {heading = 'h4', id = ''} = {}) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const section = document.createElement('section');
  section.className = 'work-day-done'; section.dataset.workDayDone = day;
  if (id) section.id = id;
  const title = document.createElement(heading); title.className = 'work-day-done-title'; title.textContent = doneTitle(day);
  const list = document.createElement('ul'); list.className = 'work-day-done-list';
  for (const text of lines) { const li = document.createElement('li'); li.textContent = text; list.append(li); }
  section.append(title, list);
  return section;
}

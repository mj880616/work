// TASK-바로처리통일: the due-date pieces every task line shares (업무일지, 홈 오늘 할 일, 담당조직·프로젝트 상세, 달력 날짜 목록).
// Pure (no DOM), so journal-data.js and its node tests use the same functions as the screens.
import {seoulDateKey, addSeoulDays, formatSeoulTime} from './meeting-time.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// Google keeps a due date as midnight UTC of that date, so its day is the date part as written.
export const dueDay = task => { const key = String(task?.due || '').slice(0, 10); return DAY.test(key) ? key : ''; };
export const tomorrowKey = (today = seoulDateKey(new Date())) => seoulDateKey(addSeoulDays(today, 1));
export const shortDay = day => `${formatSeoulTime(day, {month:'long', day:'numeric'})}(${formatSeoulTime(day, {weekday:'short'})})`;
// [내일로]·[기한 바꾸기]: the due date becomes the given day through the same google-tasks action=update the task editor sends
// (google-tasks.js saveEditor). That action writes title, notes and due together, so the task's own title and notes go with it.
export async function moveTaskToDay(task, day, rt = globalThis.window?.KPTURuntime) {
  if (!task?.id) throw new Error('할 일을 확인할 수 없어요.');
  if (!DAY.test(String(day || ''))) throw new Error('날짜를 확인할 수 없어요.');
  const data = await rt.api('/functions/v1/google-tasks?action=update', {method:'POST', body:{action:'update', task_id:task.id, task_list_id:task.taskListId || null,
    title:String(task.title || ''), notes:String(task.notes || ''), due:day}});
  if (data?.ok !== true || data.task?.id !== task.id || dueDay(data.task) !== day) throw new Error('기한을 바꾸지 못했어요. 다시 시도해 주세요.');
  return data.task;
}
// TASK-내일칸(2026-10-29): 할 일 기한 묶음 하나. 할 일을 기한으로 묶어 보여 주는 곳(할 일 화면 폰 목록·PC 두 칸, 홈 [오늘 할 일])은
// 모두 이 함수로 고른다. 순서: 기한 지남 → 오늘 → 내일 → 일주일 안(모레~7일) → 나중 → 기한 없음. 날짜는 한국 날짜('YYYY-MM-DD')로 비교한다.
export const DUE_GROUPS = Object.freeze([['overdue', '기한 지남'], ['today', '오늘'], ['tomorrow', '내일'], ['week', '일주일 안'], ['later', '나중'], ['undated', '기한 없음']]);
export function dueGroup(day, today = seoulDateKey(new Date())) {
  const key = String(day || '').slice(0, 10);
  if (!DAY.test(key)) return 'undated';
  if (key < today) return 'overdue';
  if (key === today) return 'today';
  if (key === tomorrowKey(today)) return 'tomorrow';
  return key <= seoulDateKey(addSeoulDays(today, 7)) ? 'week' : 'later';
}
// HOME-업무일지홈 C(2026-10-30 명진 결정): 할 일이 줄로 나오는 곳(홈 할 일 칸, 정리함 챙길 것 줄, 담당조직 할 일 줄 등)의 기한 글자 하나.
// '오늘' / 지난 기한 '지남 10.28' / 그 밖 '11.2 (월)'. 기한이 없으면 ''(화면은 아무것도 쓰지 않는다). 모양(작은 진회색)은 ui-standard.css .task-due-text.
export function dueLabel(day, today = seoulDateKey(new Date())) {
  const key = String(day || '').slice(0, 10);
  if (!DAY.test(key)) return '';
  if (key === today) return '오늘';
  const [, m, d] = key.split('-').map(Number);
  return key < today ? `지남 ${m}.${d}` : `${m}.${d} (${formatSeoulTime(key, {weekday:'short'})})`;
}

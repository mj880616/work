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

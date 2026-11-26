// S69-97 노트 안 할 일 → 구글 할 일(설계 docs/design/note-evernote.md 2절): 노트 화면이 편집기(ed-gtasks.js)·읽기 화면(note-body.js)에 주는 provider.
// 내 로그인으로 google-tasks 함수만 부른다(서버가 내 구글 연결로만 읽고 쓴다 — 남의 연결 없음). 새 표·정책 없음.
//   create: 기본 목록에 새 할 일 + 그 노트의 '이 노트에서 만든 할 일' 기록(metadata.tasks, basket-note-tasks.js — 할 일 창의 '노트에서' 줄).
//   toggle: 끝냄·되살림. pick: 연결된 할 일 몇 개의 지금 상태(지운 것은 gone).
// 다른 할 일 화면에 알리기: 만들거나 끝내면 kptu:google-tasks-changed(source 'note') — 할 일 목록이 다시 읽는다.
import {noteTaskEntry, recordNoteTask} from './basket-note-tasks.js';

const endpoint = action => `/functions/v1/google-tasks?action=${encodeURIComponent(action)}`;
const told = () => window.dispatchEvent(new CustomEvent('kptu:google-tasks-changed', {detail: {source: 'note'}}));

export function noteTaskProvider(noteId, {rt = window.KPTURuntime} = {}) {
  return {
    async create(title, done = false) {
      const r = await rt.api(endpoint('create'), {method: 'POST', body: {action: 'create', title, notes: ''}});
      const task = r?.task;
      if (!task?.id) throw new Error('할 일을 만들지 못했어요.');
      if (done) { try { await rt.api(endpoint('toggle'), {method: 'POST', body: {action: 'toggle', task_list_id: task.taskListId, task_id: task.id, completed: true}}); } catch { /* 다음 열 때 구글 상태로 맞춘다 */ } }
      if (noteId) { try { await recordNoteTask(noteId, noteTaskEntry(task), {rt}); } catch { /* 기록이 없어도 연결은 노트 글에 있다 */ } }
      told();
      return {id: task.id};
    },
    async toggle(id, completed) {
      await rt.api(endpoint('toggle'), {method: 'POST', body: {action: 'toggle', task_list_id: '@default', task_id: id, completed: !!completed}});
      told();
    },
    pick(ids) { return rt.api(endpoint('pick'), {method: 'POST', body: {action: 'pick', task_ids: ids}}); },
  };
}

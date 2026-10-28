// MTG-후속할일후보: 사업 보고 상세 창 '후속 할 일' 칸의 [후속 할 일 만들기].
// 누르면 서버(ai-assist kind=todo_radar, mode=meeting)가 이 사업 보고 하나를 읽고 내 일일 것 같은 후보를 정리함 '챙길 것'과 같은 표에 더한다.
// 후보 줄은 정리함 [챙길 것]과 같은 부품(inbox-todos.js)이다: [할 일로]는 기존 Google 할 일 만들기 경로, [무시]는 같은 처리.
// 후보는 올리기만 하고 할 일 만들기는 사용자가 누른다. 화면은 회의 ID만 보내고 글은 보내지 않는다. 브라우저 저장소를 쓰지 않는다.
import {mountInboxTodos} from './inbox-todos.js';
import {waitInlineHtml} from './wait-state.js'; // UI-기다림표시통일 2차: 누른 뒤 기다리는 동안 상태 줄은 글자 없는 회색 칸(wait-state.js)
import {findMeetingTodos, readMeetingCandidates} from './todo-radar-data.js';

const CHANGED = 'kptu:todo-radar-changed';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));

// button: [후속 할 일 만들기], host: 후보 줄 자리, line: 안내 한 줄.
// meetingId(): 지금 열린 사업 보고 ID(없으면 ''), onTasksChanged(): [할 일로]로 Google 할 일이 생기면 창의 후속 할 일 목록을 다시 읽는다.
export function mountMeetingTodos({button, host, line, rt = window.KPTURuntime, meetingId, onTasksChanged = () => {}}) {
  let busy = false;
  const list = mountInboxTodos(host, {
    rt, esc, quietEmpty: true, hideSource: true, withPromises: false,
    read: () => readMeetingCandidates(meetingId(), rt),
  });
  const say = (text, kind = '') => { line.textContent = text; line.dataset.state = kind; };

  button.addEventListener('click', async () => {
    const id = meetingId();
    if (busy || !id) return;
    busy = true; button.disabled = true; button.setAttribute('aria-busy', 'true'); line.innerHTML = waitInlineHtml(); line.dataset.state = '';
    let result;
    try { result = await findMeetingTodos(id); } catch { result = {ok: false, message: '후보를 찾지 못했어요. 다시 눌러 주세요.'}; }
    busy = false; button.disabled = false; button.removeAttribute('aria-busy');
    if (meetingId() !== id) return;
    if (!result.ok) { say(result.message || '후보를 찾지 못했어요. 다시 눌러 주세요.', 'error'); return; }
    say(result.added ? `후보 ${result.added}개를 올렸어요. 정리함 [챙길 것]에도 있어요.` : '새로 올릴 후보는 없어요.');
    window.dispatchEvent(new CustomEvent(CHANGED, {detail: {reload: true}}));
  });
  window.addEventListener('kptu:google-tasks-changed', () => { if (meetingId()) onTasksChanged(); });

  return {
    // 사업 보고를 열 때 부른다: 이 회의의 후보 줄을 읽는다.
    open() { say(''); list.show(true); },
    // 창을 닫을 때: 줄을 비우고 숨긴다.
    close() { say(''); list.show(false); host.replaceChildren(); },
  };
}

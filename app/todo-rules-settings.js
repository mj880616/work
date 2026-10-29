import {waitInlineHtml, failHtml} from './wait-state.js';
// TODO-내일만 4·5번: 내 프로필의 '챙길 것 기준' 칸. profile-settings.js가 칸 자리를 만들고 이 모듈이 그 안을 그린다.
// - 전체 부탁도 올릴 방: 단체방 '다들 ~해 주세요' 같은 부탁은 기본으로 챙길 것에 올리지 않고, 여기 고른 방만 올린다.
//   방은 방 열쇠(room_key)로 서버(app_todo_ask_rooms)에 저장하고, 이름은 텔레그램 방 목록(app_feed_rooms)의 이름을 보여 준다.
//   더하기·빼기는 바로 서버에 저장한다(프로필 [저장]과 따로). 기기에는 아무것도 남기지 않는다.
// - [쌓인 후보 다시 거르기]: 지금 대기 중인 챙길 것 후보를 새 기준으로 한 번 다시 거른다(ai-assist kind=todo_recheck).
//   지우지 않고 '무시'로만 바꾼다. 무시한 후보는 정리함 [챙길 것]의 '무시함'에서 되돌릴 수 있다.
// 표가 아직 없거나(DB 적용 전) 텔레그램 방이 없으면 방 줄은 숨기고 다시 거르기만 보인다.
import {readAskRooms, addAskRoom, removeAskRoom, recheckTodos, ROOM_KEY} from './todo-radar-data.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const CHANGED = 'kptu:todo-radar-changed';

// 방 목록(이름·종류). 단체방·채널만 고를 수 있다(개인 대화는 늘 올라가므로 고를 필요가 없음).
async function readRooms(rt) {
  const ws = rt.context.read()?.workspace?.id;
  if (!ws) return {ok: false};
  try {
    const rows = await rt.api(`/rest/v1/app_feed_rooms?workspace_id=eq.${encodeURIComponent(ws)}&select=room_key,room_label,chat_kind&order=room_label.asc&limit=1000`, {singleFlight: false});
    return {ok: true, rooms: (Array.isArray(rows) ? rows : []).filter(r => typeof r?.room_key === 'string' && ROOM_KEY.test(r.room_key))
      .map(r => ({key: r.room_key, name: typeof r.room_label === 'string' && r.room_label.trim() ? r.room_label.trim() : '이름 없는 방', kind: r.chat_kind || ''}))};
  } catch { return {ok: false}; }
}

export function mountTodoRulesSettings(host, {rt}) {
  let state = {phase: 'loading', keys: [], rooms: [], roomsOk: false, busy: false, note: '', pick: ''};
  let run = 0;

  function render() {
    if (!host.isConnected) return;
    const {phase, keys, rooms, roomsOk, busy, note, pick} = state;
    const head = `<div class="ps-panel-head"><h3>챙길 것 기준</h3><span class="ps-state" data-ps-todo-state role="status" aria-live="polite">${esc(note)}</span></div>`;
    const recheck = `<div class="ps-calref-row"><span class="ps-calref-label">쌓인 후보</span><button type="button" class="ps-todo-btn" data-ps-todo-recheck${busy ? ' disabled aria-busy="true"' : ''}>새 기준으로 다시 거르기</button></div>`;
    if (phase === 'loading') { host.innerHTML = `${head}<div class="ps-calref">${waitInlineHtml()}</div>`; return; }
    if (phase === 'failed') { host.innerHTML = `${head}<div class="ps-calref">${failHtml()}${recheck}</div>`; return; }
    const groups = rooms.filter(r => r.kind !== 'user');
    const name = key => rooms.find(r => r.key === key)?.name || '목록에 없는 방';
    const chosen = keys.length ? keys.map(k => `<li class="ps-todo-room"><span class="ps-todo-room-name">${esc(name(k))}</span><button type="button" class="ps-todo-btn" data-ps-todo-remove="${esc(k)}" aria-label="${esc(name(k))} 빼기"${busy ? ' disabled' : ''}>빼기</button></li>`).join('') : '';
    const options = groups.filter(r => !keys.includes(r.key));
    const add = options.length ? `<div class="ps-calref-row"><select class="ps-calref-select" data-ps-todo-pick aria-label="더할 단체방"${busy ? ' disabled' : ''}><option value="">방 고르기</option>${options.map(r => `<option value="${esc(r.key)}"${r.key === pick ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select><button type="button" class="ps-todo-btn" data-ps-todo-add${busy || !pick ? ' disabled' : ''}>더하기</button></div>` : '';
    const roomsPart = phase === 'ready' && roomsOk && (groups.length || keys.length)
      ? `<div class="ps-calref-row ps-todo-rooms-head"><span class="ps-calref-line">단체방 전체 부탁('다들 ~해 주세요')도 올릴 방</span></div>${chosen ? `<ul class="ps-todo-rooms">${chosen}</ul>` : '<p class="ps-calref-line">고른 방 없음 · 전체 부탁은 올리지 않아요</p>'}${add}` : '';
    host.innerHTML = `${head}<div class="ps-calref">${roomsPart}${recheck}</div>`;
  }
  const say = note => { state = {...state, note}; const el = host.querySelector('[data-ps-todo-state]'); if (el) el.textContent = note; };

  async function load() {
    const mine = ++run;
    state = {...state, phase: 'loading', note: ''}; render();
    const [asked, rooms] = await Promise.all([readAskRooms(rt), readRooms(rt)]);
    if (mine !== run) return;
    if (asked.missing) { state = {...state, phase: 'no-table', keys: [], rooms: rooms.ok ? rooms.rooms : [], roomsOk: false}; render(); return; }
    if (!asked.ok) { state = {...state, phase: 'failed'}; render(); return; }
    state = {...state, phase: 'ready', keys: asked.keys, rooms: rooms.ok ? rooms.rooms : [], roomsOk: rooms.ok, pick: ''}; render();
  }

  async function change(fn, okNote, failNote) {
    state = {...state, busy: true}; render();
    let ok = false;
    try { ok = await fn(); } catch { ok = false; }
    state = {...state, busy: false};
    if (ok) { await load(); say(okNote); } else { render(); say(failNote); }
  }

  host.addEventListener('change', event => {
    const select = event.target.closest('[data-ps-todo-pick]'); if (!select) return;
    state = {...state, pick: select.value}; render();
    host.querySelector('[data-ps-todo-add]')?.focus({preventScroll: true});
  });
  host.addEventListener('click', async event => {
    const b = event.target.closest('button'); if (!b || b.disabled || state.busy) return;
    if ('psTodoAdd' in b.dataset) {
      const key = state.pick; if (!key) return;
      await change(() => addAskRoom(key, rt), '더했어요.', '더하지 못했어요. 다시 눌러 주세요.');
      return;
    }
    if (b.dataset.psTodoRemove) {
      const key = b.dataset.psTodoRemove;
      await change(() => removeAskRoom(key, rt), '뺐어요.', '빼지 못했어요. 다시 눌러 주세요.');
      return;
    }
    if ('psTodoRecheck' in b.dataset) {
      state = {...state, busy: true}; render(); say('다시 거르는 중…');
      const r = await recheckTodos({rt});
      state = {...state, busy: false}; render();
      if (!r.ok) { say(r.message); return; }
      say(`후보 ${r.checked}건 중 ${r.dismissed}건을 무시로 옮겼어요.${r.more ? ' 남은 후보가 더 있어요. 한 번 더 눌러 주세요.' : ''}`);
      if (r.dismissed) window.dispatchEvent(new CustomEvent(CHANGED, {detail: {reload: true}}));
    }
  });

  render();
  return {load};
}

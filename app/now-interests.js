import {waitHtml, failHtml, emptyHtml} from './wait-state.js';
import {cleanTopic, confirmedTopics, candidateRows} from './now-model.mjs';
// OUTSIDE-글상세·관심환류 ④(설계 docs/design/outside-statements.md 12.6절): '관심 주제' 칸(Now ⋯ → 관심 주제, 또는 목록 위 '관심 주제 후보 n [보기]').
// 후보(AI가 서버에서 만듦, state='candidate', origin='ai')마다 [ㅇ 확정] [고치기] [빼기], 확정한 주제마다 [고치기] [빼기], 끝에 [+ 더하기].
// 주간보고 규칙과 같은 후보 → 확정(수용·수정·삭제·추가). 뺀 것은 지우지 않고 'dropped'로 남겨 서버가 같은 후보를 다시 만들지 않게 한다.
// 저장은 모두 서버 app_now_interests(작업공간 소유자 RLS, 화면 권한: 넣기 workspace_id·topic·state·decided_at / 고치기 topic·state·decided_at·updated_at).
// 이 칸(box)의 유일한 그리기 주인. 확정 주제 목록은 상세 '나와의 연관'과 목록 작은 표시가 읽는다(topics()).

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const q = v => encodeURIComponent(v);
const rt = () => window.KPTURuntime;
const workspaceOf = () => rt()?.context?.read?.()?.workspace?.id || '';
const COLS = 'id,topic,state,origin,reason,decided_at,created_at';
const saveFailNote = e => (e?.status === 409 ? '이미 있음' : e?.status ? `저장하지 못함 · HTTP ${e.status}` : '저장하지 못함 · 잠시 뒤 다시');

export function createNowInterests({box, onChanged} = {}) {
  let rows = [], loaded = false, failed = false, busy = new Set(), note = '', editing = '', draft = '';

  async function load() {
    const w = workspaceOf();
    if (!w) return;
    try {
      const got = await rt().api(`/rest/v1/app_now_interests?workspace_id=eq.${q(w)}&select=${COLS}&order=created_at.asc&limit=200`, {singleFlight: false});
      rows = Array.isArray(got) ? got.filter(r => r && typeof r.topic === 'string') : [];
      loaded = true; failed = false;
    } catch { if (!loaded) failed = true; }
    paint();
    onChanged?.();
  }
  async function patch(id, body) {
    const got = await rt().api(`/rest/v1/app_now_interests?workspace_id=eq.${q(workspaceOf())}&id=eq.${q(id)}&select=${COLS}`, {method: 'PATCH', body: {...body, updated_at: new Date().toISOString()}, prefer: 'return=representation', singleFlight: false});
    const row = Array.isArray(got) ? got[0] : null;
    if (!row) throw new Error('save');
    rows = rows.map(r => (r.id === id ? row : r));
  }
  async function act(id, fn) {
    if (busy.has(id)) return;
    busy.add(id); note = ''; paint();
    try { await fn(); } catch (e) { note = saveFailNote(e); }
    busy.delete(id); paint(); onChanged?.();
  }
  const accept = id => act(id, () => patch(id, {state: 'confirmed', decided_at: new Date().toISOString()}));
  const drop = id => act(id, () => patch(id, {state: 'dropped', decided_at: new Date().toISOString()}));
  function rename(id, raw) {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    const c = cleanTopic(raw, rows.filter(r => r.id !== id && r.state !== 'dropped').map(r => r.topic));
    if (!c.ok) { note = c.reason; paint(); return; }
    editing = '';
    if (c.topic === row.topic) { paint(); return; }
    // 후보를 고치면 그 이름으로 확정한다(수정 = 수용).
    act(id, () => patch(id, {topic: c.topic, state: 'confirmed', decided_at: new Date().toISOString()}));
  }
  async function add(raw) {
    const w = workspaceOf();
    const c = cleanTopic(raw, rows.filter(r => r.state !== 'dropped').map(r => r.topic));
    if (!w) return;
    if (!c.ok) { draft = String(raw ?? ''); note = c.reason; paint(); box?.querySelector('[data-ni-add-input]')?.focus(); return; }
    const old = rows.find(r => r.state === 'dropped' && r.topic === c.topic);
    if (old) { draft = ''; await accept(old.id); return; }
    busy.add('add'); note = ''; draft = ''; paint();
    try {
      const got = await rt().api(`/rest/v1/app_now_interests?select=${COLS}`, {method: 'POST', body: {workspace_id: w, topic: c.topic, state: 'confirmed', decided_at: new Date().toISOString()}, prefer: 'return=representation', singleFlight: false});
      const row = Array.isArray(got) ? got[0] : null;
      if (!row) throw new Error('save');
      rows = [...rows, row];
    } catch (e) { draft = c.topic; note = saveFailNote(e); }
    busy.delete('add'); paint(); onChanged?.();
    box?.querySelector('[data-ni-add-input]')?.focus({preventScroll: true});
  }

  function rowHtml(r, kind) {
    const dis = busy.has(r.id) ? ' disabled' : '';
    if (editing === r.id) return `<form class="ni-row" data-ni-edit-form="${esc(r.id)}"><input type="text" data-ni-edit-input maxlength="30" value="${esc(r.topic)}" aria-label="주제 고치기"><button type="submit" class="secondary">저장</button><button type="button" class="secondary" data-ni-edit-cancel>취소</button></form>`;
    const yes = kind === 'candidate' ? `<button type="button" class="ni-btn" data-ni-confirm="${esc(r.id)}"${dis}>ㅇ 확정</button>` : '';
    return `<div class="ni-row" data-ni-row="${esc(r.id)}" data-state="${esc(r.state)}"><span class="ni-topic">${esc(r.topic)}</span>${r.reason && kind === 'candidate' ? `<span class="ni-reason">${esc(r.reason)}</span>` : ''}<span class="ni-acts">${yes}<button type="button" class="ni-btn" data-ni-edit="${esc(r.id)}"${dis}>고치기</button><button type="button" class="ni-btn" data-ni-drop="${esc(r.id)}"${dis}>빼기</button></span></div>`;
  }
  function paint() {
    if (!box) return;
    if (!loaded) { box.innerHTML = failed ? failHtml({retry: 'data-ni-retry'}) : waitHtml({rows: 4}); return; }
    const cand = candidateRows(rows), conf = rows.filter(r => r.state === 'confirmed');
    const head = '';
    const candHtml = cand.length ? `<section class="ni-sec" aria-label="관심 주제 후보"><h3 class="ni-h">후보 ${cand.length}</h3>${cand.map(r => rowHtml(r, 'candidate')).join('')}</section>` : '';
    const confHtml = `<section class="ni-sec" aria-label="확정한 관심 주제"><h3 class="ni-h">확정</h3>${conf.length ? conf.map(r => rowHtml(r, 'confirmed')).join('') : emptyHtml('확정한 주제 없음')}</section>`;
    const addHtml = `<form class="ni-add" data-ni-add-form><input type="text" data-ni-add-input maxlength="30" placeholder="주제 더하기" aria-label="관심 주제 더하기" value="${esc(draft)}"><button type="submit" class="secondary"${busy.has('add') ? ' disabled' : ''}>+ 더하기</button></form>`;
    box.innerHTML = head + (note ? `<p class="ni-note" role="status">${esc(note)}</p>` : '') + candHtml + confHtml + addHtml;
  }
  box?.addEventListener('click', event => {
    const b = event.target.closest('button');
    if (!b || !box.contains(b)) return;
    if (b.matches('[data-ni-retry]')) { failed = false; paint(); load(); return; }
    if (b.matches('[data-ni-confirm]')) { accept(b.dataset.niConfirm); return; }
    if (b.matches('[data-ni-drop]')) { drop(b.dataset.niDrop); return; }
    if (b.matches('[data-ni-edit]')) { editing = b.dataset.niEdit; note = ''; paint(); box.querySelector('[data-ni-edit-input]')?.focus(); return; }
    if (b.matches('[data-ni-edit-cancel]')) { editing = ''; paint(); }
  });
  box?.addEventListener('submit', event => {
    event.preventDefault();
    const f = event.target;
    if (f.matches('[data-ni-add-form]')) add(f.querySelector('[data-ni-add-input]')?.value);
    else if (f.matches('[data-ni-edit-form]')) rename(f.dataset.niEditForm, f.querySelector('[data-ni-edit-input]')?.value);
  });
  box?.addEventListener('input', event => { if (event.target.matches('[data-ni-add-input]')) draft = event.target.value; });
  return {
    load, paint,
    topics: () => confirmedTopics(rows),
    candidates: () => candidateRows(rows).length,
    loaded: () => loaded,
    reset: () => { rows = []; loaded = false; failed = false; busy = new Set(); note = ''; editing = ''; draft = ''; },
  };
}

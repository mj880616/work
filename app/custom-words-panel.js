// APP-기록+이름바꾸기(S67-44, docs/design/girok-custom-words.md): 내 프로필 '이름 바꾸기' 칸의 화면 주인 하나.
// - 칸마다 기본 이름(얼굴 기본값) 옆에 내 이름 입력, [기본으로]로 그 칸만 비움. [저장]은 칸 아래 하나.
// - 저장: 내 프로필 행 custom_words 한 칸을 PATCH(owner RLS로 내 행만, custom-words-store.js — 메뉴 수정 창과 같은 길). 바꾼 칸이 없으면 null(= 모두 기본). 기기에는 남기지 않는다.
// - 칸이 아직 없는 서버(DB 적용 전)는 읽기가 400 → '저장 준비 중' 안내만 보이고 저장은 막힌다(다른 칸·화면은 그대로).
// - 바뀐 이름은 다음에 열 때부터 모든 화면에 보인다(시작할 때 한 번 읽어 첫 그리기에 쓰는 구조, app/brand/custom-words.mjs). 저장 뒤 [지금 다시 열기].
// S67-62: 기본 이름은 이 사람의 바탕 낱말 묶음을 얹은 얼굴(BASE_FACE)로 보인다.
import {BASE_FACE as FACE} from './brand/brand.mjs';
import {SLOTS, NAME_MAX, defaultName, buildSaveValue} from './brand/custom-words-model.mjs';
import {readCustomWords, writeCustomWords} from './custom-words-store.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const GROUPS = [
  {title: '메뉴·이름', slots: SLOTS.filter(s => !s.kind)},
  {title: '활동 분류', slots: SLOTS.filter(s => s.kind)}
];

/** host 안을 이 함수만 그린다. */
export function mountCustomWords(host, {rt = window.KPTURuntime, reload = () => location.reload()} = {}) {
  let saved = null, state = 'loading', busy = false, message = '', error = '', justSaved = false, userId = '';
  const inputs = {};

  // 저장된 값 중 기본 이름과 다른 칸만 '바꿈'으로 센다(S67-62: 바탕 낱말 묶음이 있으면 저장 값이 기본 이름과 같을 수 있다).
  const savedChanged = () => (saved ? buildSaveValue(FACE, saved).value : null) || {};
  const count = () => Object.keys(savedChanged()).length;
  const dirty = () => {
    if (!saved) return false;
    const next = buildSaveValue(FACE, inputs);
    if (next.error) return true;
    return JSON.stringify(next.value || {}) !== JSON.stringify(savedChanged());
  };
  function rowHtml(slot) {
    const def = defaultName(FACE, slot), value = inputs[slot.id] ?? '';
    const id = `cwIn_${slot.id}`;
    return `<div class="cw-row"><span class="cw-hint">${esc(slot.hint)}</span><label class="cw-def" for="${id}">${esc(def)}</label>`
      + `<input id="${id}" type="text" data-cw-slot="${esc(slot.id)}" value="${esc(value)}" placeholder="${esc(def)}" maxlength="${NAME_MAX}" autocomplete="off" aria-label="${esc(def)} 새 이름"${state !== 'ok' || busy ? ' disabled' : ''}>`
      + `<button type="button" class="secondary cw-reset" data-cw-reset="${esc(slot.id)}"${value ? '' : ' hidden'}${busy ? ' disabled' : ''}>기본으로</button></div>`;
  }
  function render() {
    const open = host.querySelector('details.cw-fold')?.open || false;
    const n = count();
    const status = state === 'pending' ? '저장 준비 중이에요. 조금 뒤에 다시 열어 주세요.'
      : state === 'error' ? '불러오지 못했어요.'
      : error || (justSaved ? '저장했어요. 다시 열면 모든 화면에 보여요.' : dirty() ? '바뀐 이름이 있어요. 저장 전이에요.' : message);
    host.innerHTML = `<details class="cw-fold"${open ? ' open' : ''}><summary><h3>이름 바꾸기</h3><span class="cw-count">${state === 'ok' && n ? `${n}개 바꿈` : ''}</span></summary>`
      + `<p class="cw-note">메뉴·분류 이름을 내 말로 바꿔요. 빈칸은 기본 이름.</p>`
      + GROUPS.map(g => `<div class="cw-group" role="group" aria-label="${esc(g.title)}"><span class="cw-group-h">${esc(g.title)}</span>${g.slots.map(rowHtml).join('')}</div>`).join('')
      + `<div class="cw-foot"><span class="cw-state${error ? ' cw-error' : ''}" role="status" aria-live="polite">${esc(status)}</span>`
      + (justSaved ? '<button type="button" class="secondary" data-cw-reload>지금 다시 열기</button>' : '')
      + `<button type="button" class="secondary cw-save" data-cw-save${state !== 'ok' || busy || !dirty() ? ' disabled' : ''}>저장</button></div></details>`;
  }
  // 입력 중에는 칸을 다시 그리지 않는다(글자·커서 유지). 상태 줄·[기본으로]·[저장]만 맞춘다.
  function refreshFoot() {
    const st = host.querySelector('.cw-state');
    if (st) { st.textContent = error || (dirty() ? '바뀐 이름이 있어요. 저장 전이에요.' : justSaved ? '저장했어요. 다시 열면 모든 화면에 보여요.' : ''); st.classList.toggle('cw-error', !!error); }
    const save = host.querySelector('[data-cw-save]');
    if (save) save.disabled = state !== 'ok' || busy || !dirty();
    for (const btn of host.querySelectorAll('[data-cw-reset]')) btn.hidden = !inputs[btn.dataset.cwReset];
  }
  host.addEventListener('input', e => {
    const slot = e.target.dataset?.cwSlot;
    if (!slot) return;
    inputs[slot] = e.target.value; error = ''; justSaved = false; refreshFoot();
  });
  host.addEventListener('click', async e => {
    const reset = e.target.closest?.('[data-cw-reset]');
    if (reset) {
      inputs[reset.dataset.cwReset] = ''; error = ''; justSaved = false;
      const input = host.querySelector(`[data-cw-slot="${reset.dataset.cwReset}"]`);
      if (input) { input.value = ''; input.focus({preventScroll: true}); }
      refreshFoot(); return;
    }
    if (e.target.closest?.('[data-cw-reload]')) { reload(); return; }
    if (!e.target.closest?.('[data-cw-save]') || busy || state !== 'ok') return;
    const next = buildSaveValue(FACE, inputs);
    if (next.error) {
      error = next.error === 'size' ? '이름이 너무 길어요.' : `이름은 ${NAME_MAX}자까지, < > & " ' \` \\ 없이 써 주세요.`;
      refreshFoot();
      if (next.error !== 'size') host.querySelector(`[data-cw-slot="${next.error}"]`)?.focus({preventScroll: true});
      return;
    }
    busy = true; error = ''; render();
    try {
      saved = await writeCustomWords(rt, userId, next.value);
      fill(); justSaved = true;
    } catch { error = '저장하지 못했어요. 잠시 뒤 다시 해 주세요.'; }
    busy = false; render();
  });
  function fill() { for (const slot of SLOTS) inputs[slot.id] = saved?.[slot.id] || ''; }

  async function load() {
    state = 'loading'; render();
    try {
      ({userId, saved} = await readCustomWords(rt)); fill(); state = 'ok';
    } catch (err) { state = err?.status === 400 ? 'pending' : 'error'; }
    render();
  }
  render();
  return {load};
}

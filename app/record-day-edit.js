// ORG-기록날짜고치기(요청함 11/10, 시안 docs/design/mockups/org-record-day-edit.html, PR 2294): 조직 기록 날짜 수정 칸 하나.
// - 칸 = [하루|기간|없음] + 달력 + [취소][저장]. 규칙(저장 값·검사)은 record-window-model.mjs(dayDraft·checkDayEdit) 한 곳.
// - 그리기는 dayFormHtml 하나: 조직보고 표(record-window-view.js, prefix 'rw' — 표 상태 주인이 다시 그림)와
//   조직 상세 기록 목록(workplace-detail.js, openDayEditor — 이 칸만 스스로 다시 그림)이 같은 모양을 쓴다.
// - 서버 쓰기는 기존 owner RLS 길(app_suborganization_updates PATCH)로 occurred_at(서울 시각 그대로 날짜만)·end_day·day_none만. 글은 안 바꾼다.
// - day_none 칸은 DB 적용(20261110180000) 뒤에 생긴다. 그 전 서버는 이 칸 읽기를 400(42703)으로 거절 → 칸 없이 다시 읽고 '없음'만 감춘다.
// 브라우저 저장소를 쓰지 않는다.
import * as M from './record-window-model.mjs';
import {seoulDateKey} from './meeting-time.js';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const MODE_LABEL = Object.freeze({day: '하루', range: '기간', none: '없음'});
export const NONE_HINT = '날짜 없이 보고에 넣어요. 쓴 주에 보여요.';
// 조직 기록의 나중에 생기는 칸: day_none(20261110180000, 날짜 없음), one_line(20261110190000, AI 한 줄).
// DB 적용 전 서버는 없는 칸 읽기를 400(42703)으로 거절한다 → 그 칸만 빼고 다시 읽는다(오류 글에 칸 이름이 없으면 둘 다 뺌).
export const OPTIONAL_COLS = Object.freeze(['day_none', 'one_line']);
const colMissing = error => /(^|\D)400(\D|$)|42703|PGRST204/.test(`${error?.status || ''} ${error?.code || ''} ${error?.message || ''}`);
// state = {day_none, one_line}: true(있음)·false(없음)·undefined(모름). load(cols) = 그 칸으로 읽기. 돌려주는 값 = 읽은 행.
export async function readOptional(load, base, state) {
  for (;;) {
    const extra = OPTIONAL_COLS.filter(c => state[c] !== false);
    try {
      const rows = await load(extra.length ? `${base},${extra.join(',')}` : base);
      for (const c of extra) state[c] = true;
      return rows;
    } catch (e) {
      if (!extra.length || !colMissing(e)) throw e;
      const named = extra.filter(c => String(e?.message ?? '').includes(c));
      for (const c of named.length ? named : extra) state[c] = false;
    }
  }
}
// 쓰기 응답에 받을 칸: 기본 칸 + 있는 것으로 확인된 칸.
export const colsOf = (base, state) => [base, ...OPTIONAL_COLS.filter(c => state[c] === true)].join(',');

// 칸 HTML. d = {mode, day, end_day}, p = data 속성 앞말('rw' → data-rw-mode·data-rw-field·data-rw-cancel·data-rw-save).
// pick=true(ORG-기록입력날짜: 새 기록의 날짜 고르기) — 바꾸는 즉시 그 값이 되고, 버튼은 오른쪽 [닫기] 하나(data-○-day-close).
export function dayFormHtml(d, {prefix = 'rw', id = '', noneOn = true, busy = false, invalid = '', pick = false} = {}) {
  const dis = busy ? ' disabled' : '', inv = f => (invalid === f ? ' aria-invalid="true"' : '');
  const modes = M.DAY_MODES.filter(m => m !== 'none' || noneOn);
  const seg = `<span class="ds-seg rw-seg" role="group" aria-label="날짜 종류">${modes.map(m => `<button type="button" class="ds-seg-btn rw-seg-btn" data-${prefix}-mode="${m}" aria-pressed="${d.mode === m}"${dis}>${MODE_LABEL[m]}</button>`).join('')}</span>`;
  const days = d.mode === 'none'
    ? `<span class="rw-day-hint">${NONE_HINT}</span>`
    : `<span class="wl-f-days"><input type="date" data-${prefix}-field="day" aria-label="${d.mode === 'range' ? '시작일' : '날짜'}" value="${esc(d.day || '')}"${inv('day')}${dis}>`
      + (d.mode === 'range' ? `<span aria-hidden="true">~</span><input type="date" data-${prefix}-field="end_day" aria-label="끝나는 날" value="${esc(d.end_day || '')}"${d.day ? ` min="${esc(d.day)}"` : ''}${inv('end_day')}${dis}>` : '') + '</span>';
  return `<div class="wl-form rw-day-form" data-${prefix}-form="${esc(id)}" data-${prefix}-day-form>${seg}<span class="rw-day-row">${days}</span>`
    + (pick ? `<span class="row-act wl-btns btn-row"><button type="button" class="row-act wl-btn" data-${prefix}-day-close${dis}>닫기</button></span></div>`
      : `<span class="row-act wl-btns btn-row"><button type="button" class="row-act wl-btn" data-${prefix}-cancel${dis}>취소</button><button type="button" class="row-act wl-btn is-main" data-${prefix}-save${dis}>저장</button></span></div>`);
}

// ---- ORG-기록입력날짜(요청함 11/14): 기록 입력 칸의 작은 [오늘 ▾] 칩 — 누르면 위 칸(pick)이 그 아래에 열린다 ----
// 조직 상세 기록 입력(workplace-detail.js, mountDayPick)과 조직보고 표 [+ 쓰기] 칸(record-window-view.js, 표 상태 주인이 다시 그림)이 같은 칩·칸을 쓴다.
// 고른 날짜는 저장할 때 record-window-model.mjs checkNewDay → newRecordFields(occurred_at·end_day·day_none)로 서버에 간다. 브라우저 저장소는 쓰지 않는다.
export const newDayDraft = today => ({mode: 'day', day: today, end_day: ''});
export function dayChipText(d, today) {
  if (d?.mode === 'none') return '날짜 없음';
  if (d?.mode === 'range' && d.end_day && d.end_day > d.day) return M.lineDay({day: d.day, end_day: d.end_day}) || '날짜';
  if (d?.day && d.day === today) return '오늘';
  return M.lineDay({day: d?.day}) || '날짜';
}
export function dayChipHtml(d, {prefix = 'rw', open = false, today = '', busy = false} = {}) {
  const text = dayChipText(d, today);
  return `<button type="button" class="ds-chip rde-chip" data-${prefix}-day-chip aria-expanded="${open}" aria-label="기록 날짜: ${esc(text)}"${busy ? ' disabled' : ''}>${esc(text)} <span aria-hidden="true">▾</span></button>`;
}
// chip·panel = 칩과 칸을 그릴 자리(화면이 둔 빈 요소 둘). noneOn() = 서버에 day_none 칸이 있는지. onChange(d) = 바뀔 때마다.
// 돌려주는 것: value()(지금 값), reset()(오늘·닫힘), showInvalid(field)(칸을 열고 그 칸에 표시·초점), paint().
export function mountDayPick({chip, panel, prefix = 'rdp', noneOn = () => true, isBusy = () => false, onChange = () => {}}) {
  const today = () => seoulDateKey(Date.now());
  let d = newDayDraft(today()), open = false, invalid = '';
  const paintChip = () => { chip.innerHTML = dayChipHtml(d, {prefix, open, today: today(), busy: isBusy()}); };
  const paint = (focus = '') => {
    if (d.mode === 'none' && !noneOn()) d = {...d, mode: 'day'};
    paintChip();
    panel.innerHTML = open ? dayFormHtml(d, {prefix, id: 'new', noneOn: noneOn(), busy: isBusy(), invalid, pick: true}) : '';
    panel.hidden = !open;
    if (focus === 'chip') chip.querySelector('button')?.focus({preventScroll: true});
    else if (focus) panel.querySelector(focus)?.focus({preventScroll: true});
  };
  const set = (next, focus = '') => { d = next; onChange(d); paint(focus); };
  const close = () => { open = false; invalid = ''; paint('chip'); };
  chip.addEventListener('click', e => { const b = e.target.closest?.('button'); if (!b || b.disabled) return; open = !open; invalid = ''; paint(open ? '[aria-pressed="true"]' : 'chip'); });
  panel.addEventListener('input', e => { const f = e.target.dataset?.[`${prefix}Field`]; if (!f) return; d = {...d, [f]: e.target.value}; if (invalid === f) { invalid = ''; e.target.removeAttribute('aria-invalid'); } onChange(d); paintChip(); });
  panel.addEventListener('change', e => { const f = e.target.dataset?.[`${prefix}Field`]; if (!f) return; d = {...d, [f]: e.target.value}; if (f === 'day') panel.querySelector(`[data-${prefix}-field="end_day"]`)?.setAttribute('min', e.target.value); onChange(d); paintChip(); });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } });
  panel.addEventListener('click', e => {
    const b = e.target.closest?.('button'); if (!b || b.disabled) return;
    const mode = b.dataset[`${prefix}Mode`];
    if (mode) { invalid = ''; set(withMode(d, mode), `[data-${prefix}-mode="${mode}"]`); return; }
    if (`${prefix}DayClose` in b.dataset) close();
  });
  paint();
  return {
    value: () => ({...d}),
    reset: () => { d = newDayDraft(today()); open = false; invalid = ''; paint(); },
    showInvalid: field => { open = true; invalid = field === 'mode' ? 'day' : field; paint(`[data-${prefix}-field="${invalid}"]`); },
    paint: () => paint(),
  };
}
// 종류를 바꿀 때 draft: 기간으로 바꾸면 끝 날 칸을 시작일로 채워 둔다(달력에서 바로 고르게).
export const withMode = (d, mode) => ({...d, mode, end_day: mode === 'range' && !d.end_day ? d.day || '' : d.end_day});

// 서버에 저장: 그 조직의 그 기록 한 행만(owner RLS 길). 돌려주는 값 = 고친 행(없으면 오류).
export async function patchRecordDay(rt, {id, org, value, cols}) {
  const enc = encodeURIComponent;
  const rows = await rt.api(`/rest/v1/app_suborganization_updates?id=eq.${enc(id)}&organization_id=eq.${enc(org)}&select=${cols}`, {method: 'PATCH', prefer: 'return=representation', singleFlight: false, body: value});
  if (!Array.isArray(rows) || !rows[0]) throw new Error('day');
  return rows[0];
}

// 조직 상세처럼 목록이 스스로 다시 그리지 않는 곳: row 안 after 뒤에 칸을 열고, 칸만 다시 그린다.
// item = 조직 기록 행(id, organization_id, occurred_at, end_day, day_none, created_at). save(value) → Promise(고친 행).
// done(row|null, focusBack) = 저장(행) 또는 취소(null) 뒤 화면 쪽 정리. 이미 열려 있으면 그 칸에 초점만.
export function openDayEditor({row, after, item, noneOn = true, save, done = () => {}, say = () => {}}) {
  const old = row.querySelector('[data-rde-day-form]');
  if (old) { old.querySelector('[aria-pressed="true"]')?.focus(); return; }
  const line = M.recordItem({...item, raw_text: item.raw_text || '-'}) || {day: seoulDateKey(item.occurred_at), end_day: item.end_day || null, none: item.day_none === true, at: item.occurred_at, created_at: item.created_at};
  let d = M.dayDraft(line), busy = false, invalid = '';
  const box = document.createElement('div');
  box.className = 'rde-box';
  (after || row.lastElementChild || row).insertAdjacentElement(after ? 'afterend' : 'beforeend', box);
  const paint = (focus = '') => {
    box.innerHTML = dayFormHtml(d, {prefix: 'rde', id: item.id, noneOn, busy, invalid});
    if (focus) box.querySelector(focus)?.focus({preventScroll: true});
  };
  const close = (saved = null) => { box.remove(); done(saved); };
  box.addEventListener('input', e => { const f = e.target.dataset?.rdeField; if (f) { d = {...d, [f]: e.target.value}; if (invalid === f) { invalid = ''; e.target.removeAttribute('aria-invalid'); } } });
  box.addEventListener('change', e => { const f = e.target.dataset?.rdeField; if (!f) return; d = {...d, [f]: e.target.value}; if (f === 'day') box.querySelector('[data-rde-field="end_day"]')?.setAttribute('min', e.target.value); });
  box.addEventListener('keydown', e => { if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); close(null); } });
  box.addEventListener('click', async e => {
    const b = e.target.closest?.('button'); if (!b || b.disabled) return;
    const x = b.dataset;
    if (x.rdeMode) { d = withMode(d, x.rdeMode); invalid = ''; paint(`[data-rde-mode="${x.rdeMode}"]`); return; }
    if ('rdeCancel' in x) { close(null); return; }
    if (!('rdeSave' in x) || busy) return;
    const v = M.checkDayEdit(line, d, {noneOn, today: seoulDateKey(Date.now())});
    if (!v.ok) { invalid = v.field === 'mode' ? 'day' : v.field; say(v.field === 'end_day' ? '끝나는 날은 시작일과 같거나 뒤여야 해요.' : '날짜를 다시 선택해 주세요.', true); paint(`[data-rde-field="${invalid}"]`); return; }
    if (!v.value) { close(null); return; }
    busy = true; paint(); say('저장하는 중…');
    try { const saved = await save(v.value); say('날짜를 바꿨어요.'); close(saved); }
    catch (err) { busy = false; paint('[data-rde-save]'); say('저장하지 못했어요. 다시 눌러 주세요.', true); console.warn('record day save failed', err?.message || err); }
  });
  paint('[aria-pressed="true"]');
}

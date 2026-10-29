// FEAT-1029묶음 ④ 성명·보도자료 초안 창(docs/design/feature-bundle-1029.md 4.1·4.3절, 시안 docs/design/mockups/press-draft.html).
// 여는 곳: 노트 목록 ⋯ [성명·보도자료 초안], 사업 보고 상세 ⋯ [성명 초안 만들기](그 보고가 근거로 미리 골라짐).
// ① 근거 고르기: 최근 사업 보고(owner RLS 읽기, 제목·칸·날짜)에서 최대 5건, 종류 [성명|보도자료], 한 줄 방향(선택).
// ② [초안 만들기] → 서버 ai-assist kind=press_draft(고른 ID만 보냄, 근거 글은 서버가 다시 읽음) → 미리보기만(저장 안 됨).
// ③ [노트로 저장] → 노트 한 건(app_notes kind=note, ai_export_allowed=false: AI 재료에서 뺌, 결정 4-④). '성명 초안' 폴더가 있으면 그 폴더에
//    (자동으로 만들지 않음), 근거 사업 보고와는 기존 연결(app_record_links note_id + meeting_id)로 잇는다. 그 뒤 노트 편집기로 연다.
// 닫으면 아무것도 남지 않는다. 공개·발송·사실 확인은 명진이 직접. 기기 저장 없음(이 창 메모리만).
// PC(1024px~)는 근거(왼쪽)·미리보기(오른쪽) 한 창, 폰은 고르기 → 미리보기 한 칸씩(뒤로 한 번 = 고르기, 한 번 더 = 닫기).
import {waitHtml} from './wait-state.js';
import {pickFoldHtml, readPickState, bindPickFold} from './pick-fold.mjs'; // UI-고른것접기: 근거 고르기 = 고른 것 + 접힌 '최근 사업 보고'(맨 위 찾기·초성)
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js';
import {PRESS_TYPES, PRESS_MAX_PICK, PRESS_DIRECTION_MAX, PRESS_FOLDER_NAME, typeLabel, shortDay, pressRequest, parsePressAnswer, pressNote, meetingPickLine} from './press-draft-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width:1024px)').matches;
const PICK_ROWS = 40;
const TIMEOUT_MS = 90000;
export const PRESS_TEXT = Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready:'성명·보도자료 초안은 아직 준비 중이에요.',
  invalid_request:'성명·보도자료 초안은 아직 준비 중이에요.',
  not_found:'고른 사업 보고를 찾지 못했어요. 목록을 다시 확인해 주세요.',
  press_no_source:'고른 기록에 초안에 쓸 글이 없어요.',
  daily_limit:'오늘 AI를 쓸 수 있는 횟수를 다 썼어요.',
  monthly_limit:'이번 달 AI 한도에 닿았어요.',
});
let dialog = null, state = null;

function ensureStyles() {
  const have = [...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute('href') || '').split('?')[0].endsWith('press-draft.css'));
  if (have) return;
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './press-draft.css'; link.dataset.kptuViewStyle = '1'; document.head.append(link);
}
function ensureDialog() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'pressDraftDialog'; dialog.className = 'press-draft'; dialog.setAttribute('aria-labelledby', 'pressDraftTitle');
  document.body.append(dialog);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('change', onChange);
  dialog.addEventListener('input', e => { if (state && e.target.matches('[data-pd-direction]')) state.direction = e.target.value; });
  dialog.addEventListener('cancel', e => { e.preventDefault(); back(); });
  return dialog;
}
const rt = () => window.KPTURuntime;
const ws = () => rt()?.context?.read?.()?.workspace?.id || '';

// 근거 목록: 최근 사업 보고(시각 순 40건) + 미리 고른 보고(목록 밖이면 맨 위에). owner RLS 읽기만.
async function loadMeetings(preselect) {
  const {reportKindOf, reportKindLabel} = await import('./report-kinds.mjs');
  const kind = m => reportKindLabel(reportKindOf(m));
  const enc = encodeURIComponent, w = enc(ws());
  const fields = 'id,title,series_name,round_no,meeting_at,activity_kind';
  const rows = await rt().api(`/rest/v1/app_meetings?workspace_id=eq.${w}&select=${fields}&order=meeting_at.desc.nullslast,id.asc&limit=${PICK_ROWS}`, {singleFlight:false});
  let list = Array.isArray(rows) ? rows : [];
  if (preselect && !list.some(m => String(m.id).toLowerCase() === preselect)) {
    try { const one = await rt().api(`/rest/v1/app_meetings?workspace_id=eq.${w}&id=eq.${enc(preselect)}&select=${fields}&limit=1`, {singleFlight:false}); if (Array.isArray(one) && one[0]) list = [one[0], ...list]; } catch { /* the list still shows */ }
  }
  return list.map(m => meetingPickLine(m, kind)).filter(m => m.id);
}

export async function openPressDraft({trigger = null, preselect = ''} = {}) {
  ensureStyles(); ensureDialog();
  const pre = String(preselect || '').toLowerCase();
  state = {trigger, type:'statement', direction:'', picked:pre ? [pre] : [], pick:{open:true, othersOpen:!pre, query:''}, meetings:null, failed:false, busy:false, draft:null, message:'', saving:false, saved:null, step:'pick', run:0, layer:null, stepLayer:null};
  paint();
  if (!dialog.open) dialog.showModal();
  state.layer = window.KPTURouter?.layer?.open?.('press-draft', {close:() => { if (state) { state.layer = null; close({fromBack:true}); } return true; }}) || null;
  const mine = state;
  try { mine.meetings = await loadMeetings(pre); } catch { mine.failed = true; mine.meetings = []; }
  if (state === mine) paint();
}

function close({fromBack = false} = {}) {
  if (!state) return;
  const s = state; state = null;
  // Two open layers (phone preview): close the top one, then the dialog's own layer once that step back has landed.
  if (!fromBack) {
    if (s.stepLayer && s.layer) { window.addEventListener('popstate', () => s.layer.close(), {once:true}); s.stepLayer.close(); }
    else s.layer?.close();
  }
  if (dialog?.open) dialog.close();
  s.trigger?.focus?.({preventScroll:true});
}
// 뒤로(Esc·폰 뒤로): 폰 미리보기면 고르기로, 아니면 닫기.
function back() {
  if (!state) return;
  if (state.step === 'preview' && !wide()) { state.stepLayer?.close(); state.stepLayer = null; state.step = 'pick'; paint(); return; }
  close();
}
function showPreview() {
  state.step = 'preview';
  if (!wide() && !state.stepLayer) state.stepLayer = window.KPTURouter?.layer?.open?.('press-draft-preview', {close:() => { if (state) { state.stepLayer = null; state.step = 'pick'; paint(); } return true; }}) || null;
}

function onChange(e) {
  if (!state) return;
  const box = e.target.closest('[data-pd-pick]'); if (!box) return;
  const id = box.dataset.pdPick;
  if (box.checked) { if (state.picked.length >= PRESS_MAX_PICK) { box.checked = false; state.message = `근거는 ${PRESS_MAX_PICK}건까지 고를 수 있어요.`; paint(); return; } if (!state.picked.includes(id)) state.picked.push(id); }
  else state.picked = state.picked.filter(x => x !== id);
  state.message = ''; paint();
}
async function onClick(e) {
  if (!state) return;
  if (e.target === dialog) return;
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const d = b.dataset;
  if ('pdClose' in d) return close();
  if ('pdBack' in d) return back();
  if (d.pdType) { state.type = d.pdType; return paint(); }
  if ('pdRetry' in d) { state.failed = false; state.meetings = null; paint(); try { state.meetings = await loadMeetings(state.picked[0] || ''); } catch { state.failed = true; state.meetings = []; } return paint(); }
  if ('pdMake' in d) return make();
  if ('pdSave' in d) return save();
  if ('pdOpenNote' in d) return openSaved();
}

async function make() {
  if (!state.picked.length || state.busy) return;
  const mine = state, run = ++mine.run;
  mine.busy = true; mine.draft = null; mine.saved = null; mine.message = ''; showPreview(); paint();
  const r = await callAiAssist(pressRequest(mine.type, mine.picked, mine.direction), {timeoutMs:TIMEOUT_MS}, PRESS_TEXT);
  if (state !== mine || run !== mine.run) return;
  mine.busy = false;
  const draft = r.ok ? parsePressAnswer(r.data) : null;
  if (draft) mine.draft = draft;
  else mine.message = r.ok ? PRESS_TEXT.ai_invalid_response : (PRESS_TEXT[r.code] || PRESS_TEXT.internal_error);
  paint();
  dialog.querySelector(draft ? '[data-pd-doc-title]' : '[data-pd-status]')?.focus?.({preventScroll:true});
}

async function save() {
  const mine = state; if (!mine?.draft || mine.saving || mine.saved) return;
  mine.saving = true; mine.message = ''; paint();
  const note = pressNote(mine.draft);
  let saved = null;
  try {
    const {createNoteDoc} = await import('./basket-data.js');
    saved = await createNoteDoc({title:note.title, raw_text:note.raw_text, ai_export_allowed:false});
  } catch (error) {
    if (state !== mine) return;
    mine.saving = false; mine.message = error?.message || '노트로 저장하지 못했어요. 다시 눌러 주세요.'; paint(); return;
  }
  // 저장 뒤 덧붙이기(폴더·근거 연결)는 실패해도 노트는 남는다. 실패하면 한 줄로만 알린다.
  let extra = '';
  try {
    const [{readNoteFolders}, {setNoteFolderRef}] = await Promise.all([import('./note-folders-data.js'), import('./basket-data.js')]);
    const folders = await readNoteFolders(rt());
    const folder = folders.ready ? folders.folders.find(f => !f.parent_id && f.name === PRESS_FOLDER_NAME) || folders.folders.find(f => f.name === PRESS_FOLDER_NAME) : null;
    if (folder) { await setNoteFolderRef({id:saved.id}, folder, rt()); extra = ` '${PRESS_FOLDER_NAME}' 폴더에 넣었어요.`; }
  } catch { extra = ' 폴더에는 넣지 못했어요.'; }
  let linked = 0;
  for (const s of mine.draft.sources) {
    try { await rt().api('/rest/v1/app_record_links', {method:'POST', body:{workspace_id:ws(), note_id:saved.id, meeting_id:s.meeting_id, status:'confirmed'}}); linked++; } catch { /* the note stays */ }
  }
  if (linked < mine.draft.sources.length) extra += ' 근거 사업 보고 연결 일부를 못 했어요.';
  window.dispatchEvent(new Event('kptu:basket-links-changed'));
  if (state !== mine) return;
  mine.saving = false; mine.saved = saved; mine.message = `노트로 저장했어요.${extra}`;
  paint();
  dialog.querySelector('[data-pd-open-note]')?.focus?.({preventScroll:true});
}
async function openSaved() {
  const id = state?.saved?.id; if (!id) return;
  const {requestNoteDocOpen} = await import('./basket-note-tasks.js');
  close();
  requestNoteDocOpen(id, rt());
  window.KPTURouter?.go?.('basket', {source:'delegated'});
}

// 근거 한 줄(체크 칸 + 제목 + 종류·날짜). 고른 것은 위에 늘 보이고, 나머지는 공용 부품 pick-fold의 접힌 '최근 사업 보고' 안(시각 순 그대로).
function pickRow(m) {
  const s = state;
  return `<label class="pd-pick"><input type="checkbox" data-pd-pick="${esc(m.id)}"${s.picked.includes(m.id) ? ' checked' : ''}${s.busy ? ' disabled' : ''}><span class="pd-pick-text"><span class="pd-pick-name">${esc(m.name)}</span><span class="pd-muted">${esc(['사업 보고', m.meta].filter(Boolean).join(' · '))}</span></span></label>`;
}
function pickHtml() {
  const s = state;
  const chips = PRESS_TYPES.map(t => `<button type="button" class="pd-chip" data-pd-type="${t.value}" aria-pressed="${s.type === t.value}">${t.label}</button>`).join('');
  const list = s.meetings === null ? waitHtml({rows:4, h:36})
    : s.failed ? `<p class="pd-muted">사업 보고를 불러오지 못했어요. <button type="button" class="pd-link" data-pd-retry>다시</button></p>`
    : !s.meetings.length ? '<p class="pd-muted">사업 보고 없음</p>'
    : pickFoldHtml({key:'pd', picked:s.meetings.filter(m => s.picked.includes(m.id)).map(pickRow).join(''),
      others:[{label:'', items:s.meetings.filter(m => !s.picked.includes(m.id)).map(m => ({name:[m.name, m.meta].filter(Boolean).join(' '), html:pickRow(m)}))}],
      state:s.pick, othersLabel:'최근 사업 보고', noneText:'고른 근거 없음'});
  return `<section class="pd-pane pd-pick-pane" aria-label="근거 고르기">
<div class="pd-types" role="group" aria-label="종류">${chips}</div>
<label class="pd-direction"><span class="a11y-only">한 줄 방향(선택)</span><input type="text" data-pd-direction maxlength="${PRESS_DIRECTION_MAX}" placeholder="한 줄 방향(선택)" value="${esc(s.direction)}"></label>
<p class="pd-muted pd-count">근거 고르기 (최대 ${PRESS_MAX_PICK}건) · <span data-pd-count>${s.picked.length}</span>건 고름</p>
${list}
<div class="pd-bar"><button type="button" class="primary" data-pd-make${!s.picked.length || s.busy ? ' disabled' : ''}${s.busy ? ' aria-busy="true"' : ''}>${s.draft ? '다시 만들기' : '초안 만들기'}</button></div>
</section>`;
}
function previewHtml() {
  const s = state, d = s.draft;
  const tag = refs => refs.map(r => `<span class="pd-ref">[근거 ${r}]</span>`).join(' ');
  const save = d ? `<button type="button" class="primary" data-pd-save${s.saving || s.saved ? ' disabled' : ''}${s.saving ? ' aria-busy="true"' : ''}>${s.saved ? '저장함' : '노트로 저장'}</button>` : '';
  const head = `<div class="pd-preview-head">${wide() ? '' : '<button type="button" class="pd-icon" data-pd-back aria-label="근거 고르기로">‹</button>'}<span class="pd-preview-name">미리보기</span><span class="pd-muted">${d ? `AI 초안 · 근거 ${d.sources.length}건 · 사실 확인 전` : ''}</span>${save}</div>`;
  let body;
  if (s.busy) body = waitHtml({rows:6});
  else if (!d) body = s.message ? '' : '<p class="pd-muted">근거를 고르고 [초안 만들기]를 누르면 여기에 미리보기가 나와요.</p>';
  else body = `<article class="pd-doc"><p class="pd-muted">${esc(typeLabel(d.type))}</p><h3 class="pd-doc-title" data-pd-doc-title tabindex="-1">${esc(d.title)}</h3>${d.subtitle ? `<p class="pd-doc-sub">${esc(d.subtitle)}</p>` : ''}
${d.paragraphs.map(p => `<p>${esc(p.text)} ${tag(p.refs)}</p>`).join('')}
${d.demands.length ? `<ul class="pd-demands">${d.demands.map(x => `<li>${esc(x.text)} ${tag(x.refs)}</li>`).join('')}</ul>` : ''}</article>
${d.checks.length ? `<div class="pd-checks"><b>확인할 것 ${d.checks.length}</b><ol>${d.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ol></div>` : ''}
<div class="pd-sources"><p class="pd-muted">근거${d.partial ? ' · 길어서 앞부분만 봄' : ''}</p><ol>${d.sources.map(x => `<li>${esc(x.title)}${x.day ? ` · ${esc(shortDay(x.day))}` : ''}</li>`).join('')}</ol></div>
${s.saved ? '<div class="pd-bar"><button type="button" data-pd-open-note>노트 열기</button></div>' : ''}`;
  return `<section class="pd-pane pd-preview-pane" aria-label="미리보기">${head}${body}</section>`;
}
function paint() {
  if (!dialog || !state) return;
  const s = state, two = wide();
  const fold = s.painted ? readPickState(dialog).pd : null; if (fold) s.pick = fold; s.painted = true; // 다시 그려도 '최근 사업 보고' 펼침·찾기 글은 이어 간다(고르기 칸이 없던 때는 그대로)
  const focusKey = dialog.contains(document.activeElement) ? [...(document.activeElement?.attributes || [])].find(a => a.name.startsWith('data-pd-')) : null;
  const panes = two ? pickHtml() + previewHtml() : s.step === 'preview' ? previewHtml() : pickHtml();
  dialog.classList.toggle('pd-two', two);
  dialog.innerHTML = `<header class="pd-head"><h2 id="pressDraftTitle">성명·보도자료 초안</h2><button type="button" class="pd-icon" data-pd-close aria-label="닫기">×</button></header>
<div class="pd-body">${panes}</div>
<p class="pd-status" data-pd-status role="status" aria-live="polite" tabindex="-1">${esc(s.message)}</p>`;
  bindPickFold(dialog);
  if (focusKey) dialog.querySelector(`[${focusKey.name}${focusKey.value ? `="${CSS.escape(focusKey.value)}"` : ''}]`)?.focus?.({preventScroll:true});
}

window.KPTUPressDraft = {open:openPressDraft};

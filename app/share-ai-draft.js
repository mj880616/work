// 공유 페이지 AI 초안 창(원장 빠짐32 · 요청 10/20 01:43 '현장 공유 페이지' ②: "AI는 자료를 받아 블록에 초안만 채움, 사용자가 블록별로 수정").
// 여는 곳: 공유 페이지 편집 화면 맨 위 ⋯ [AI 초안](share-pages.js). 글 한 칸 화면(새 페이지 모두)에서만.
// ① 재료 고르기: 최근 사업 보고와 노트·업데이트(owner RLS 읽기, 제목·종류·날짜만)에서 최대 6건, 한 줄 초점(선택).
//    노트는 AI에 보낼 수 있는 것만 보인다(보관·AI 내보내기 끔·[AI에 보내지 않기]·비밀 모양 노트 제외). 일기·업무일지 줄은 목록에 없다.
// ② [초안 만들기] → 서버 ai-assist kind=share_draft(고른 종류·ID만 보냄, 글은 서버가 다시 읽음) → 칸별 미리보기(저장 안 됨).
// ③ 넣을 칸을 고르고 [넣기] → 편집 중인 본문 끝에 제목 + 줄로 들어간다(근거 번호·확인할 것은 안 들어감). 그 뒤에도 페이지는 [저장]을 눌러야 바뀐다.
// 닫으면 아무것도 남지 않는다. 기기 저장 없음(이 창 메모리만). 창 모양은 성명·보도자료 초안 창(press-draft.css)을 그대로 쓴다.
import {waitHtml, emptyHtml} from './wait-state.js';
import {pickFoldHtml, readPickState, bindPickFold} from './pick-fold.mjs';
import {callAiAssist, AI_SUMMARY_TEXT} from './basket-ai-summary.js';
import {noteAiOff} from './note-secret.mjs';
import {SHARE_AI_MAX_PICK, SHARE_AI_FOCUS_MAX, SHARE_AI_SECTIONS, shareDraftRequest, parseShareDraftAnswer, filledKeys, draftNodes,
  meetingLine, noteLine, shortDay, splitKey} from './share-ai-draft-model.mjs';

const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const wide = () => typeof matchMedia === 'function' && matchMedia('(min-width:761px)').matches;
const PICK_ROWS = 40;
const TIMEOUT_MS = 90000;
export const SHARE_AI_TEXT = Object.freeze({
  ...AI_SUMMARY_TEXT,
  not_ready:'공유 페이지 AI 초안은 아직 준비 중이에요.',
  invalid_request:'공유 페이지 AI 초안은 아직 준비 중이에요.',
  not_found:'고른 기록을 찾지 못했어요. 목록을 다시 확인해 주세요.',
  share_no_source:'고른 기록에 초안에 쓸 글이 없어요.',
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
  dialog.id = 'shareAiDraftDialog'; dialog.className = 'press-draft share-ai-draft'; dialog.setAttribute('aria-labelledby', 'shareAiDraftTitle');
  document.body.append(dialog);
  dialog.addEventListener('click', onClick);
  dialog.addEventListener('change', onChange);
  dialog.addEventListener('input', e => { if (state && e.target.matches('[data-sa-focus]')) state.focus = e.target.value; });
  dialog.addEventListener('cancel', e => { e.preventDefault(); back(); });
  return dialog;
}
const rt = () => window.KPTURuntime;
const ws = () => rt()?.context?.read?.()?.workspace?.id || '';

// 재료 목록: 최근 사업 보고 40건 + AI에 보낼 수 있는 최근 노트·업데이트 40건. owner RLS 읽기만, 제목·종류·날짜만 그린다.
async function loadRecords() {
  const {reportKindOf, reportKindLabel} = await import('./report-kinds.mjs');
  const kind = m => reportKindLabel(reportKindOf(m));
  const w = encodeURIComponent(ws());
  const noteRead = kind => rt().api(`/rest/v1/app_notes?workspace_id=eq.${w}&kind=eq.${kind}&archived_at=is.null&ai_export_allowed=is.true&select=id,kind,title,raw_text,metadata,occurred_at,updated_at&order=updated_at.desc,id.asc&limit=${PICK_ROWS}`, {singleFlight:false});
  const [meetings, plain, updates] = await Promise.all([
    rt().api(`/rest/v1/app_meetings?workspace_id=eq.${w}&select=id,title,series_name,round_no,meeting_at,activity_kind&order=meeting_at.desc.nullslast,id.asc&limit=${PICK_ROWS}`, {singleFlight:false}),
    noteRead('note'), noteRead('basket'),
  ]);
  const at = n => Date.parse(n?.updated_at || '') || 0;
  const notes = [...(Array.isArray(plain) ? plain : []), ...(Array.isArray(updates) ? updates : [])].sort((a, b) => at(b) - at(a)).slice(0, PICK_ROWS);
  return {
    meetings:(Array.isArray(meetings) ? meetings : []).map(m => meetingLine(m, kind)).filter(r => splitKey(r.key)),
    // 노트(kind=note)의 [AI에 보내지 않기]·비밀 모양은 서버와 같은 규칙(note-secret.mjs)으로 목록에서 뺀다. 서버도 다시 본다.
    notes:notes.filter(n => !(n.kind === 'note' && noteAiOff(n))).map(noteLine).filter(r => splitKey(r.key)),
  };
}

// onInsert(nodes): 넣을 편집기 블록(ed1)을 받아 본문 끝에 넣고 true/false를 돌려준다(share-pages.js).
export async function openShareAiDraft({trigger = null, onInsert} = {}) {
  ensureStyles(); ensureDialog();
  state = {trigger, onInsert, focus:'', picked:[], pick:{open:true, othersOpen:true, query:''}, records:null, failed:false, busy:false, draft:null, keys:[], message:'', step:'pick', run:0, layer:null, stepLayer:null};
  paint();
  if (!dialog.open) dialog.showModal();
  state.layer = window.KPTURouter?.layer?.open?.('share-ai-draft', {close:() => { if (state) { state.layer = null; close({fromBack:true}); } return true; }}) || null;
  const mine = state;
  try { mine.records = await loadRecords(); } catch { mine.failed = true; mine.records = {meetings:[], notes:[]}; }
  if (state === mine) paint();
}

function close({fromBack = false, refocus = true} = {}) {
  if (!state) return;
  const s = state; state = null;
  if (!fromBack) {
    if (s.stepLayer && s.layer) { window.addEventListener('popstate', () => s.layer.close(), {once:true}); s.stepLayer.close(); }
    else s.layer?.close();
  }
  if (dialog?.open) dialog.close();
  if (refocus) s.trigger?.focus?.({preventScroll:true});
}
// 뒤로(Esc·폰 뒤로): 폰 미리보기면 고르기로, 아니면 닫기.
function back() {
  if (!state) return;
  if (state.step === 'preview' && !wide()) { state.stepLayer?.close(); state.stepLayer = null; state.step = 'pick'; paint(); return; }
  close();
}
function showPreview() {
  state.step = 'preview';
  if (!wide() && !state.stepLayer) state.stepLayer = window.KPTURouter?.layer?.open?.('share-ai-draft-preview', {close:() => { if (state) { state.stepLayer = null; state.step = 'pick'; paint(); } return true; }}) || null;
}

function onChange(e) {
  if (!state) return;
  const box = e.target.closest('[data-sa-pick],[data-sa-section]'); if (!box) return;
  if (box.dataset.saSection) {
    const k = box.dataset.saSection;
    state.keys = box.checked ? [...new Set([...state.keys, k])] : state.keys.filter(x => x !== k);
    return paint();
  }
  const key = box.dataset.saPick;
  if (box.checked) { if (state.picked.length >= SHARE_AI_MAX_PICK) { box.checked = false; state.message = `재료는 ${SHARE_AI_MAX_PICK}건까지 고를 수 있어요.`; paint(); return; } if (!state.picked.includes(key)) state.picked.push(key); }
  else state.picked = state.picked.filter(x => x !== key);
  state.message = ''; paint();
}
async function onClick(e) {
  if (!state) return;
  if (e.target === dialog) return;
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  const d = b.dataset;
  if ('saClose' in d) return close();
  if ('saBack' in d) return back();
  if ('saRetry' in d) { state.failed = false; state.records = null; paint(); try { state.records = await loadRecords(); } catch { state.failed = true; state.records = {meetings:[], notes:[]}; } return paint(); }
  if ('saMake' in d) return make();
  if ('saInsert' in d) return insert();
}

async function make() {
  if (!state.picked.length || state.busy) return;
  const mine = state, run = ++mine.run;
  mine.busy = true; mine.draft = null; mine.keys = []; mine.message = ''; showPreview(); paint();
  const r = await callAiAssist(shareDraftRequest(mine.picked, mine.focus), {timeoutMs:TIMEOUT_MS}, SHARE_AI_TEXT);
  if (state !== mine || run !== mine.run) return;
  mine.busy = false;
  const draft = r.ok ? parseShareDraftAnswer(r.data) : null;
  if (draft) { mine.draft = draft; mine.keys = filledKeys(draft); }
  else mine.message = r.ok ? SHARE_AI_TEXT.ai_invalid_response : (SHARE_AI_TEXT[r.code] || SHARE_AI_TEXT.internal_error);
  paint();
  dialog.querySelector(draft ? '[data-sa-preview-name]' : '[data-sa-status]')?.focus?.({preventScroll:true});
}

function insert() {
  const mine = state; if (!mine?.draft) return;
  const nodes = draftNodes(mine.draft, mine.keys);
  if (!nodes.length) { mine.message = '넣을 칸을 골라 주세요.'; return paint(); }
  let ok = false;
  try { ok = mine.onInsert?.(nodes) === true; } catch { ok = false; }
  if (!ok) { mine.message = '본문에 넣지 못했어요. 편집 화면을 다시 열어 주세요.'; return paint(); }
  close({refocus:false}); // 커서는 본문(넣은 곳)에 둔다
}

// 재료 한 줄(체크 칸 + 이름 + 종류·날짜). 고른 것은 위에 늘 보이고, 나머지는 공용 부품 pick-fold의 '최근 기록' 안(사업 보고 · 노트·업데이트 묶음).
function pickRow(r) {
  const s = state;
  return `<label class="pd-pick"><input type="checkbox" data-sa-pick="${esc(r.key)}"${s.picked.includes(r.key) ? ' checked' : ''}${s.busy ? ' disabled' : ''}><span class="pd-pick-text"><span class="pd-pick-name">${esc(r.name)}</span><span class="pd-muted">${esc(r.meta)}</span></span></label>`;
}
function pickHtml() {
  const s = state, all = s.records ? [...s.records.meetings, ...s.records.notes] : [];
  const item = r => ({name:`${r.name} ${r.meta}`, html:pickRow(r)});
  const list = s.records === null ? waitHtml({rows:4, h:36})
    : s.failed ? `<p class="pd-muted">기록을 불러오지 못했어요. <button type="button" class="pd-link" data-sa-retry>다시</button></p>`
    : !all.length ? emptyHtml('고를 기록 없음')
    : pickFoldHtml({key:'sa', picked:s.picked.map(k => all.find(r => r.key === k)).filter(Boolean).map(pickRow).join(''),
      others:[{label:'사업 보고', items:s.records.meetings.filter(r => !s.picked.includes(r.key)).map(item)},
        {label:'노트·업데이트', items:s.records.notes.filter(r => !s.picked.includes(r.key)).map(item)}],
      state:s.pick, othersLabel:'최근 기록', noneText:'고른 재료 없음'});
  return `<section class="pd-pane pd-pick-pane" aria-label="재료 고르기">
<label class="pd-direction"><span class="a11y-only">한 줄 초점(선택)</span><input type="text" data-sa-focus maxlength="${SHARE_AI_FOCUS_MAX}" placeholder="한 줄 초점(선택)" value="${esc(s.focus)}"></label>
<p class="pd-muted pd-count">재료 고르기 (최대 ${SHARE_AI_MAX_PICK}건) · ${s.picked.length}건 고름</p>
${list}
<div class="pd-bar"><button type="button" class="primary" data-sa-make${!s.picked.length || s.busy ? ' disabled' : ''}${s.busy ? ' aria-busy="true"' : ''}>${s.draft ? '다시 만들기' : '초안 만들기'}</button></div>
</section>`;
}
function previewHtml() {
  const s = state, d = s.draft;
  const tag = refs => refs.map(r => `<span class="pd-ref">[근거 ${r}]</span>`).join(' ');
  const put = d ? `<button type="button" class="primary" data-sa-insert${s.keys.length ? '' : ' disabled'}>넣기</button>` : '';
  const head = `<div class="pd-preview-head">${wide() ? '' : '<button type="button" class="pd-icon" data-sa-back aria-label="재료 고르기로">‹</button>'}<span class="pd-preview-name" data-sa-preview-name tabindex="-1">미리보기</span><span class="pd-muted">${d ? `AI 초안 · 근거 ${d.sources.length}건 · 넣기 전` : ''}</span>${put}</div>`;
  let body;
  if (s.busy) body = waitHtml({rows:6});
  else if (!d) body = s.message ? '' : '';
  else body = `<article class="pd-doc">${SHARE_AI_SECTIONS.filter(sec => d.sections[sec.key].length).map(sec => `<label class="pd-pick"><input type="checkbox" data-sa-section="${sec.key}"${s.keys.includes(sec.key) ? ' checked' : ''}><span class="pd-pick-text"><b>${esc(sec.label)}</b></span></label>
<ul class="pd-demands">${d.sections[sec.key].map(l => `<li>${esc(l.text)} ${tag(l.refs)}</li>`).join('')}</ul>`).join('')}</article>
${d.checks.length ? `<div class="pd-checks"><b>넣기 전에 확인할 것 ${d.checks.length}</b><ol>${d.checks.map(c => `<li>${esc(c)}</li>`).join('')}</ol></div>` : ''}
<div class="pd-sources"><p class="pd-muted">근거${d.partial ? ' · 길어서 앞부분만 봄' : ''}${d.skipped ? ` · AI에 보내지 않는 노트 ${d.skipped}건은 뺌` : ''}</p><ol>${d.sources.map(x => `<li>${esc(x.label)} · ${esc(x.title || x.label)}${x.day ? ` · ${esc(shortDay(x.day))}` : ''}</li>`).join('')}</ol></div>
`;
  return `<section class="pd-pane pd-preview-pane" aria-label="미리보기">${head}${body}</section>`;
}
function paint() {
  if (!dialog || !state) return;
  const s = state, two = wide();
  const fold = s.painted ? readPickState(dialog).sa : null; if (fold) s.pick = fold; s.painted = true;
  const focusKey = dialog.contains(document.activeElement) ? [...(document.activeElement?.attributes || [])].find(a => a.name.startsWith('data-sa-')) : null;
  const panes = two ? pickHtml() + previewHtml() : s.step === 'preview' ? previewHtml() : pickHtml();
  dialog.classList.toggle('pd-two', two);
  dialog.innerHTML = `<header class="pd-head"><h2 id="shareAiDraftTitle">공유 페이지 AI 초안</h2><button type="button" class="pd-icon" data-sa-close aria-label="닫기">×</button></header>
<div class="pd-body">${panes}</div>
<p class="pd-status" data-sa-status role="status" aria-live="polite" tabindex="-1">${esc(s.message)}</p>`;
  bindPickFold(dialog);
  if (focusKey) dialog.querySelector(`[${focusKey.name}${focusKey.value ? `="${CSS.escape(focusKey.value)}"` : ''}]`)?.focus?.({preventScroll:true});
}

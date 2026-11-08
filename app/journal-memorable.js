// S49-13 JOURNAL-기억할통화텔레그램: 업무일지 [하루] 주간보고 재료의 네 번째 묶음 '기억할 통화·텔레그램'(설계 docs/design/journal-memorable.md).
// - 이 모듈이 그 묶음의 유일한 상태 소유자·renderer다(journal.js는 자리만 준다). 저장은 모두 서버 표(app_journal_memorable, owner RLS).
// - 화면을 열 때(그날을 보여줄 때) 한 번: 저장된 줄을 읽어 먼저 그리고, ai-assist(kind=journal_memorable)에 날짜만 보낸다.
//   서버가 '마지막 실행 1시간 뒤 + 새 기록 있음'일 때만 AI를 부르고 결과를 표에 넣는다. 화면은 다시 읽어 그린다. 1시간 안에 다시 열면 AI를 부르지 않는다.
// - 운영자 기능(통화·텔레그램)은 서버가 판정한다(app_my_features, 표 restrictive 정책, ai-assist). 여기서 app_my_features를 읽는 것은 묶음을 그릴지 정하는 편의일 뿐이다.
// - 줄 = 공용 '제안 줄'(출처 꼬리표 · 글 · 줄 끝 ⋯ 하나, S52-29). ⋯ = [넣기][고쳐서 넣기][빼기 · 이유]. 빼기한 줄은 보이지 않는다. 표가 없으면(DB 적용 전) 묶음을 그리지 않는다.
import {callAiAssist} from './basket-ai-summary.js';
import {rowMore} from './row-more.js';

export const MEMORABLE_REASONS = Object.freeze(['중복', '사적', '주간보고감 아님', '기타']);
export const MEMORABLE_REFRESH_MS = 60 * 60 * 1000;
const LINE_MAX = 160;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const chars = text => [...String(text ?? '')].length;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const scopeOf = rt => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
const workspaceOf = rt => rt.context.read()?.workspace?.id || '';

// 서버가 보낸 줄 → 화면 줄. 모양이 틀린 줄은 버린다. 빼기한 줄은 보이지 않는다.
export function memorableRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.id === 'string' && typeof r.line === 'string' && r.line && ['suggested', 'kept'].includes(r.status))
    .map(r => ({id:r.id, source:r.source === 'telegram' ? 'telegram' : 'call', feedItemId:r.feed_item_id, org:typeof r.org_name === 'string' ? r.org_name : '',
      line:r.status === 'kept' && typeof r.final_line === 'string' && r.final_line ? r.final_line : r.line, status:r.status}));
}
// "10:00 기준" — 마지막으로 고른 시각(한국 시각).
export function asOfLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t + 9 * 3600 * 1000), pad = n => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} 기준`;
}
// 고쳐 넣은 글 검사(서버 표 규칙과 같다): 한 줄 1~160자.
export function checkFinalLine(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value && chars(value) <= LINE_MAX ? value : null;
}

export function createMemorable({onChange = () => {}, now = () => Date.now()} = {}) {
  let owner = '', features = null; // features: null(아직 모름) 또는 Set
  const days = new Map(); // day → {status:'loading'|'ok'|'hidden', rows, asof, askedAt, editing:id|null, busy:id|null, error:''}

  async function readFeatures(rt) {
    if (features) return features;
    try { const v = await rt.api('/rest/v1/rpc/app_my_features', {method:'POST', body:{}, singleFlight:false}); features = new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []); }
    catch { features = new Set(); }
    return features;
  }
  async function readDay(day, rt) {
    const ws = encodeURIComponent(workspaceOf(rt));
    const [rows, runs] = await Promise.all([
      rt.api(`/rest/v1/app_journal_memorable?workspace_id=eq.${ws}&day=eq.${day}&select=id,source,feed_item_id,org_name,line,status,final_line&order=picked_at.asc,id.asc&limit=60`),
      rt.api(`/rest/v1/app_journal_memorable_runs?workspace_id=eq.${ws}&day=eq.${day}&select=last_run_at&limit=1`),
    ]);
    return {rows:memorableRows(rows), asof:Array.isArray(runs) && typeof runs[0]?.last_run_at === 'string' ? runs[0].last_run_at : ''};
  }
  async function ensure(day, rt) {
    if (!DAY.test(day || '')) return;
    const scope = scopeOf(rt);
    if (scope !== owner) { owner = scope; features = null; days.clear(); }
    const state = days.get(day);
    if (state && (state.status === 'loading' || (state.askedAt && now() - state.askedAt < MEMORABLE_REFRESH_MS))) return;
    const fresh = state || {status:'loading', rows:[], asof:'', askedAt:0, editing:null, busy:null, error:''};
    fresh.askedAt = now(); days.set(day, fresh);
    const mine = owner;
    const alive = () => mine === owner && days.get(day) === fresh;
    try {
      const allowed = await readFeatures(rt);
      if (!alive()) return;
      if (!allowed.has('calls') && !allowed.has('telegram')) { fresh.status = 'hidden'; onChange(); return; }
      const first = await readDay(day, rt);
      if (!alive()) return;
      Object.assign(fresh, first, {status:'ok'}); onChange();
      const asked = await callAiAssist({kind:'journal_memorable', day}, {rt});
      if (!alive()) return;
      if (asked?.ok && !asked.data?.skipped) { Object.assign(fresh, await readDay(day, rt)); if (alive()) onChange(); }
    } catch (error) {
      if (!alive()) return;
      // 표가 없으면(DB 적용 전) 묶음을 그리지 않는다.
      if (error?.status === 404 || error?.status === 403) { fresh.status = 'hidden'; onChange(); return; }
      if (fresh.status === 'loading') fresh.status = 'hidden';
      onChange();
    }
  }
  async function decide(day, id, patch, rt) {
    const state = days.get(day);
    if (!state || state.busy) return;
    state.busy = id; state.error = ''; onChange();
    try {
      await rt.api(`/rest/v1/app_journal_memorable?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${encodeURIComponent(workspaceOf(rt))}`, {method:'PATCH', body:{...patch, decided_at:new Date(now()).toISOString()}});
      Object.assign(state, await readDay(day, rt));
      state.editing = null;
    } catch { state.error = '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.'; }
    state.busy = null; onChange();
  }

  // 묶음 하나(없으면 null). 줄이 없으면 그리지 않는다(다른 묶음과 같은 규칙).
  function render(day, rt, {open = () => {}} = {}) {
    const state = days.get(day);
    // 읽는 중에는 그리지 않는다(운영자가 아닌 작업공간에 잠깐 비치는 일이 없게).
    if (!state || state.status !== 'ok') return null;
    if (!state.rows.length) return null;
    const box = document.createElement('section');
    box.className = 'journal-group'; box.dataset.journalGroup = 'memorable';
    const asof = asOfLabel(state.asof);
    box.innerHTML = `<h5 class="journal-heading">기억할 통화·텔레그램${asof ? ` <small class="journal-muted" data-journal-memorable-asof>${esc(asof)}</small>` : ''}</h5>`;
    const ul = document.createElement('ul'); ul.className = 'journal-items';
    for (const row of state.rows) {
      const li = document.createElement('li'); li.className = 'journal-item'; li.dataset.journalMemorable = row.id; li.dataset.memorableStatus = row.status;
      const busy = state.busy === row.id;
      if (state.editing === row.id) {
        li.innerHTML = `<form class="journal-memorable-edit" data-memorable-edit="${esc(row.id)}" data-enter-save><textarea rows="1" maxlength="${LINE_MAX}" aria-label="고쳐서 넣을 한 줄" data-memorable-input data-autogrow data-enter-field="single">${esc(row.line)}</textarea><button type="submit" class="mini"${busy ? ' disabled' : ''}>넣기</button><button type="button" class="mini" data-memorable-cancel>취소</button></form>`;
        ul.append(li); continue;
      }
      // S52-29 공용 '제안 줄'(주간 정리와 같은 모양): 줄 앞 흐린 출처 꼬리표 · 글(줄 전체 폭, 누르면 원본) · 줄 끝 ⋯ 하나.
      //   ⋯ = [넣기][고쳐서 넣기]/[빼기: 이유] — 이름·동작·저장(서버 표 PATCH)은 전과 같다. 큰 테두리 버튼은 두지 않는다.
      li.classList.add('journal-memorable-row');
      const source = row.source === 'telegram' ? '텔레그램' : '통화';
      const tag = document.createElement('span'); tag.className = 'weekly-flow-tag'; tag.dataset.memorableSource = row.source; tag.textContent = source;
      const body = document.createElement('div'); body.className = 'journal-item-body';
      const text = document.createElement('button'); text.type = 'button'; text.className = 'journal-item-open'; text.dataset.memorableOpen = row.id;
      text.setAttribute('aria-label', `${row.line} (원본 ${source} 열기)`);
      text.innerHTML = `${row.org ? `<strong class="journal-memorable-org">${esc(row.org)}</strong> ` : ''}${esc(row.line)}${row.status === 'kept' ? ' <small class="journal-muted" data-memorable-kept>넣음</small>' : ''}`;
      body.append(text);
      const items = [
        ...(row.status === 'kept' ? [] : [{text:'넣기', data:{memorableKeep:row.id}, disabled:busy, aria:`넣기: ${row.line}`}]),
        {text:row.status === 'kept' ? '고치기' : '고쳐서 넣기', data:{memorableFix:row.id}, disabled:busy, aria:`${row.status === 'kept' ? '고치기' : '고쳐서 넣기'}: ${row.line}`},
        ...MEMORABLE_REASONS.map(reason => ({text:`빼기 · ${reason}`, data:{memorableDrop:row.id, reason}, disabled:busy, danger:true, aria:`빼기(${reason}): ${row.line}`})),
      ];
      li.append(tag, body, rowMore(document, {label:`${row.line} 넣기·빼기`, data:{memorableMore:row.id}, items})); ul.append(li);
    }
    box.append(ul);
    if (state.error) box.insertAdjacentHTML('beforeend', `<p class="wait-fail journal-failed" role="alert">${esc(state.error)}</p>`);
    box.addEventListener('click', event => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const find = name => target.closest(`[data-memorable-${name}]`);
      const keep = find('keep'), fix = find('fix'), drop = find('drop'), opener = find('open');
      if (keep) { const row = state.rows.find(r => r.id === keep.dataset.memorableKeep); if (row) void decide(day, row.id, {status:'kept', final_line:null, drop_reason:null}, rt); }
      else if (fix) { state.editing = fix.dataset.memorableFix; state.error = ''; onChange(); }
      else if (drop && MEMORABLE_REASONS.includes(drop.dataset.reason)) void decide(day, drop.dataset.memorableDrop, {status:'dropped', drop_reason:drop.dataset.reason}, rt);
      else if (find('cancel')) { state.editing = null; onChange(); }
      else if (opener) { const row = state.rows.find(r => r.id === opener.dataset.memorableOpen); if (row) open(row); }
    });
    box.addEventListener('submit', event => {
      const form = event.target instanceof Element ? event.target.closest('[data-memorable-edit]') : null;
      if (!form) return;
      event.preventDefault();
      const value = checkFinalLine(form.querySelector('[data-memorable-input]')?.value);
      if (!value) { state.error = `한 줄로 ${LINE_MAX}자 안에서 써 주세요.`; onChange(); return; }
      void decide(day, form.dataset.memorableEdit, {status:'kept', final_line:value, drop_reason:null}, rt);
    });
    return box;
  }
  return {ensure, render, state: day => days.get(day)};
}

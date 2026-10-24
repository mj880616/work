// AI-서버연동 S7-c: [원장] 화면의 원장 목록·검색 칸(#ledgerBrowseRoot). 이 모듈이 그 칸의 유일한 renderer다.
// 검색은 S7-a 검색 RPC(app_ledger_search, SECURITY INVOKER라 owner RLS 그대로)만 쓴다. 기본은 업무만(L1), 관심 정보는 따로 고른다.
// 화면(S7-c 정리): 검색칸 하나만 늘 보이고 나머지 조건은 [조건 ▾] 안(처음엔 접힘, 펼침 상태는 저장하지 않음). 걸린 조건은 칩, ✕로 하나씩 해제.
// 걸러보기: 종류·기간·조직·주제·범위·대체/폐기 포함. 행을 누르면 상세(칸·근거·출처·연결)를 로그인 토큰으로 읽는다(읽기만).
// 원장 표 또는 검색 RPC가 없으면(404) 칸 전체를 조용히 숨긴다. 다른 칸이 원장을 바꾸면 kptu:ledger-changed로 다시 읽는다.
// LEDGER-자동기록 3단계(설계 docs/design/ledger-auto-record.md 3.3·8.1·9.2절): 자동으로 들어온 기록에 "자동" 꼬리표(변경 기록 표
// app_ledger_record_changes, owner RLS 읽기), 확인필요 표시, 근거 web2:<종류>:<id> → ‹원문›(각 화면의 기존 여는 함수, 원문이 없으면
// "원문이 지워졌어요"), 상세 ⋯ [틀린 기록으로 표시](app_apply_ledger_fix retire, 이유 선택, 직후 [되돌리기] = app_undo_ledger_fix)와
// 자동 기록이면 [이번 자동 기록 취소](app_auto_ledger_undo). 쓰기는 이 DB 함수 셋뿐이고 모두 SECURITY INVOKER(owner RLS 그대로).
// 변경 기록 표나 함수가 없으면(배포 전) 꼬리표·메뉴만 없고 목록은 그대로 보인다.
// LEDGER-화면정리(명진 요청 2026-10-24 07:17, 결정 ⑥): 이 모듈이 [원장] 화면 틀(#ledgerView)도 만든다(옛 가져오기 모듈에서 옮김).
//   가져오기·가져온 묶음 칸과 원장 후보 칸은 화면에서 지웠다(표·데이터·함수는 그대로). 위에서부터: 검색(조직·주제·사람) /
//   상대가 안 지킨 약속(며칠째·확인일 지남) / 지금 추적 중인 일 / 조직별·주제별 칩 / 최근 자동으로 기록됨. 검색·조건이 걸리면 결과 목록.
//   칩을 누르면 그 이야기를 시간순 한 줄씩(세로 선 타임라인), 줄을 누르면 근거·출처(‹원문›) 상세가 펼쳐진다.
//   목록 줄에는 고정 ID·'현재유효' 같은 말을 쓰지 않는다(상세 안에만). 종류는 작은 꼬리표, 자동·직접 꼬리표.
//   [+ 기록하기]와 상세 ⋯ [고치기]는 원장 고치기 칸(app/ledger-fix.js, #ledgerFixRoot)을 연다.
// 첫 화면 칸 읽기는 owner RLS REST뿐(새 RPC 없음): 안 지킨 약속·추적 중 사건·칩 집계·최근 자동 기록.
import {
  KIND_DISPLAY, KIND_HINT, KINDS, VALIDITY_LABEL, SENSITIVITY_LABEL, DOC_TYPE_LABEL, SCOPE_CHOICES, PAGE, MAX_LIMIT, QUERY_MAX,
  freshFilters, searchArgs, validResult, detailFields, sourceHref, linkLabel, rowView, activeConditions, clearCondition, countLabel,
  web2Source, web2OpenTarget, web2SourceLabel, changeInfo, AUTO_TAG, MANUAL_TAG, RETIRE_REASONS, retireRequest, undoErrorText,
  isSearching, overdueLabel, seoulDay, storySort, chipList, overdueRecordsPath, LEDGER_ROW_COLS
} from './ledger-browse-model.mjs';
import { requestBasketNote, requestNoteDocOpen } from './basket-note-tasks.js';
import { offerUndoNotice } from './basket-record-delete.js';

const rt = window.KPTURuntime;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const q = v => encodeURIComponent(v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const workspaceId = () => rt?.context?.read?.()?.workspace?.id || null;
const isMissing = e => e?.status === 404 || /PGRST20[25]|42P01|42883|schema cache/i.test(String(e?.message || ''));

let state = fresh();
let bound = false;
let seq = 0;
function fresh() {
  return { phase: 'loading', organizations: [], topics: [], filters: freshFilters(), limit: PAGE, rows: [], busy: false, error: '',
    openId: null, details: new Map(), detailBusy: '', detailError: '', condOpen: false, changes: new Map(), acting: '', actError: '', notice: '',
    home: null, homeBusy: false, story: null };
}
const LIVE = 'validity=in.(current,needs_check,fulfilled)';
const ROW_COLS = LEDGER_ROW_COLS;

// 화면 틀: 맨 위 사본 상태 한 줄 → 고치기·기록하기 칸(닫혀 있음) → 목록·검색. 칸마다 renderer는 하나(각 모듈).
function installView() {
  if (document.querySelector('#ledgerView')) return;
  document.querySelector('#appView')?.insertAdjacentHTML('beforeend', `<section id="ledgerView" class="view-panel hidden" aria-label="원장"><div class="lg-root"><div id="ledgerExportRoot" class="lg-root" hidden></div><div id="ledgerFixRoot" class="lg-root" hidden></div><div id="ledgerBrowseRoot" class="lg-root" hidden></div></div></section>`);
}

// ---------- 첫 화면 칸(검색이 없을 때) ----------
async function readRows(path) {
  const rows = await rt.api(path, { singleFlight: false });
  return (Array.isArray(rows) ? rows : []).filter(validResult);
}
async function loadHome() {
  const ws = q(workspaceId()), today = seoulDay();
  const mine = seq;
  state.homeBusy = true; render();
  try {
    const [overdue, tracking, live, links, autos] = await Promise.all([
      readRows(overdueRecordsPath(workspaceId(), today)),
      readRows(`/rest/v1/app_ledger_records?workspace_id=eq.${ws}&kind=eq.event&event_status=eq.tracking&validity=in.(current,needs_check)&scope=eq.work&select=${ROW_COLS}&order=updated_at.desc&limit=20`),
      rt.api(`/rest/v1/app_ledger_records?workspace_id=eq.${ws}&${LIVE}&scope=eq.work&select=id,topic_id&limit=5000`, { singleFlight: false }),
      rt.api(`/rest/v1/app_ledger_links?workspace_id=eq.${ws}&target_organization_id=not.is.null&select=record_id,target_organization_id&limit=5000`, { singleFlight: false }),
      rt.api(`/rest/v1/app_ledger_record_changes?workspace_id=eq.${ws}&route=eq.auto&action=eq.created&select=record_id,created_at&order=created_at.desc&limit=30`, { singleFlight: false }).catch(() => [])
    ]);
    const liveIds = new Set((Array.isArray(live) ? live : []).map(r => String(r?.id || '')).filter(id => UUID.test(id)));
    const orgNames = new Map(state.organizations.map(o => [String(o.id), o.name])), topicNames = new Map(state.topics.map(t => [String(t.id), t.name]));
    const orgChips = chipList((Array.isArray(links) ? links : []).filter(l => liveIds.has(String(l?.record_id))).map(l => l.target_organization_id), orgNames);
    const topicChips = chipList((Array.isArray(live) ? live : []).map(r => r?.topic_id), topicNames);
    const autoIds = [...new Set((Array.isArray(autos) ? autos : []).map(c => String(c?.record_id || '')).filter(id => UUID.test(id)))].slice(0, 10);
    const recent = autoIds.length ? await readRows(`/rest/v1/app_ledger_records?workspace_id=eq.${ws}&id=in.(${autoIds.map(q).join(',')})&${LIVE}&select=${ROW_COLS}&limit=10`) : [];
    const order = new Map(autoIds.map((id, i) => [id, i]));
    recent.sort((a, b) => order.get(a.id) - order.get(b.id));
    const changes = await readChanges([...overdue, ...tracking, ...recent].map(r => r.id));
    if (mine !== seq) return;
    state.home = { overdue, tracking, orgChips, topicChips, recent };
    for (const [k, v] of changes) state.changes.set(k, v);
  } catch (e) {
    if (mine !== seq) return;
    if (isMissing(e)) state.phase = 'hidden';
    else state.home = { error: true };
  }
  state.homeBusy = false; render();
}

// ---------- 이야기(칩 → 시간순 타임라인) ----------
async function openStory(type, id) {
  const list = type === 'organization' ? state.organizations : state.topics;
  const item = list.find(x => String(x.id) === id);
  if (!item) return;
  state.story = { type, id, name: item.name, rows: null, error: '' };
  state.openId = null;
  const mine = ++seq;
  render();
  try {
    const rows = await rt.api('/rest/v1/rpc/app_ledger_search', { method: 'POST', singleFlight: false, body: {
      p_query: '', p_kinds: null, p_organization_id: type === 'organization' ? id : null, p_topic_id: type === 'topic' ? id : null,
      p_date_from: null, p_date_to: null, p_scope: null, p_include_inactive: false, p_limit: MAX_LIMIT } });
    if (mine !== seq || !state.story) return;
    state.story.rows = storySort((Array.isArray(rows) ? rows : []).filter(validResult));
    const changes = await readChanges(state.story.rows.map(r => r.id));
    for (const [k, v] of changes) state.changes.set(k, v);
  } catch { if (mine === seq && state.story) state.story.error = '이야기를 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.'; }
  if (mine === seq) render();
  document.querySelector('#lbStoryTitle')?.focus?.({ preventScroll: true });
}

async function search() {
  state.story = null;
  if (!isSearching(state.filters)) { state.rows = []; state.phase = 'ready'; ++seq; await loadHome(); return; }
  const built = searchArgs(state.filters, state.limit);
  if (built.error) { state.error = built.error; render(); return; }
  const mine = ++seq;
  state.busy = true; state.error = ''; render();
  try {
    const rows = await rt.api('/rest/v1/rpc/app_ledger_search', { method: 'POST', body: built.args, singleFlight: false });
    if (mine !== seq) return;
    state.rows = (Array.isArray(rows) ? rows : []).filter(validResult);
    const changes = await readChanges(state.rows.map(r => r.id));
    for (const [k, v] of changes) state.changes.set(k, v);
    if (mine !== seq) return;
    state.phase = 'ready';
  } catch (e) {
    if (mine !== seq) return;
    if (isMissing(e)) { state.phase = 'hidden'; }
    else state.error = /LEDGER_SEARCH_BAD/.test(String(e?.message || '')) ? '검색 조건을 확인하세요.' : '원장을 읽지 못했습니다. 잠시 뒤 다시 시도하세요.';
  }
  state.busy = false; render();
}

async function loadLists() {
  const ws = q(workspaceId());
  const [orgs, topics] = await Promise.all([
    rt.api(`/rest/v1/app_ledger_organizations?workspace_id=eq.${ws}&status=eq.active&select=id,ledger_id,name&order=name.asc&limit=1000`, { singleFlight: false }),
    rt.api(`/rest/v1/app_ledger_topics?workspace_id=eq.${ws}&status=eq.active&select=id,ledger_id,name&order=sort_order.asc,name.asc&limit=500`, { singleFlight: false })
  ]);
  if (!Array.isArray(orgs) || !Array.isArray(topics)) throw Object.assign(new Error('shape'), { status: 500 });
  state.organizations = (orgs || []).filter(o => UUID.test(String(o.id)));
  state.topics = (topics || []).filter(t => UUID.test(String(t.id)));
}

// 목록 기록들의 변경 기록(자동·수정 요청). 표가 없거나 못 읽으면 빈 값(꼬리표만 없음).
async function readChanges(ids) {
  const list = ids.filter(id => UUID.test(String(id)));
  if (!list.length) return new Map();
  try {
    const rows = [];
    for (let i = 0; i < list.length; i += 100) {
      const part = await rt.api(`/rest/v1/app_ledger_record_changes?workspace_id=eq.${q(workspaceId())}&record_id=in.(${list.slice(i, i + 100).map(q).join(',')})&select=record_id,action,route,run_id,note&order=created_at.asc&limit=1000`, { singleFlight: false });
      if (Array.isArray(part)) rows.push(...part);
    }
    return changeInfo(rows);
  } catch { return new Map(); }
}

let loading = null;
function load() {
  if (!workspaceId() || !document.querySelector('#ledgerBrowseRoot')) return Promise.resolve();
  loading ||= (async () => {
    if (state.phase !== 'ready') { state.phase = 'loading'; render(); }
    try { await loadLists(); }
    catch (e) { state.phase = isMissing(e) ? 'hidden' : 'error'; render(); return; }
    state.details.clear(); state.changes.clear();
    const story = state.story;
    await search();
    if (story) await openStory(story.type, story.id);
  })().finally(() => { loading = null; });
  return loading;
}

// ---------- 상세 ----------
async function readDetail(id) {
  const ws = q(workspaceId());
  const one = async path => { const rows = await rt.api(path, { singleFlight: false }); return Array.isArray(rows) ? rows : []; };
  const [record] = await one(`/rest/v1/app_ledger_records?id=eq.${q(id)}&workspace_id=eq.${ws}&select=*&limit=1`);
  if (!record) return null;
  const [recordSources, outLinks, inLinks] = await Promise.all([
    one(`/rest/v1/app_ledger_record_sources?record_id=eq.${q(id)}&select=id,source_id,locator,note&order=created_at.asc&limit=200`),
    one(`/rest/v1/app_ledger_links?record_id=eq.${q(id)}&select=id,record_id,target_record_id,target_organization_id,target_project_id,target_meeting_id,relation,note&order=created_at.asc&limit=200`),
    one(`/rest/v1/app_ledger_links?target_record_id=eq.${q(id)}&select=id,record_id,target_record_id,relation,note&order=created_at.asc&limit=200`)
  ]);
  const ids = list => [...new Set(list.filter(v => UUID.test(String(v || ''))))];
  const sourceIds = ids(recordSources.map(r => r.source_id));
  const recordIds = ids([...outLinks.map(l => l.target_record_id), ...inLinks.map(l => l.record_id), record.superseded_by]);
  const projectIds = ids(outLinks.map(l => l.target_project_id));
  const meetingIds = ids(outLinks.map(l => l.target_meeting_id));
  const orgIds = ids(outLinks.map(l => l.target_organization_id)).filter(i => !state.organizations.some(o => o.id === i));
  const inList = list => list.map(q).join(',');
  const [sources, records, projects, meetings, orgs] = await Promise.all([
    sourceIds.length ? one(`/rest/v1/app_ledger_sources?id=in.(${inList(sourceIds)})&select=id,ledger_id,title,doc_type,location,drive_file_id,source_date,sensitivity,status`) : [],
    recordIds.length ? one(`/rest/v1/app_ledger_records?id=in.(${inList(recordIds)})&select=id,ledger_id,title,kind`) : [],
    projectIds.length ? one(`/rest/v1/app_spaces?id=in.(${inList(projectIds)})&select=id,name`) : [],
    meetingIds.length ? one(`/rest/v1/app_meetings?id=in.(${inList(meetingIds)})&select=id,title,series_name`) : [],
    orgIds.length ? one(`/rest/v1/app_ledger_organizations?id=in.(${inList(orgIds)})&select=id,ledger_id,name`) : []
  ]);
  const names = {
    records: new Map(records.map(r => [r.id, r])),
    organizations: new Map([...state.organizations, ...orgs].map(o => [o.id, o])),
    projects: new Map(projects.map(p => [p.id, p.name || ''])),
    meetings: new Map(meetings.map(m => [m.id, m.series_name || m.title || '']))
  };
  const sourceById = new Map(sources.map(s => [s.id, s]));
  const originals = await readOriginals(sources);
  const topicName = state.topics.find(t => t.id === record.topic_id)?.name || '';
  const sup = names.records.get(record.superseded_by);
  return {
    record,
    fields: detailFields(record, { topicName, supersededBy: sup ? `${sup.ledger_id} ${sup.title}` : '' }),
    sources: recordSources.map(rs => ({ ...rs, source: sourceById.get(rs.source_id) || null, original: originalOf(sourceById.get(rs.source_id), originals) })),
    links: [...outLinks.map(l => linkLabel(l, names, 'out')), ...inLinks.map(l => linkLabel(l, names, 'in'))]
  };
}
// 근거가 Web2 기록이면 그 원문이 아직 있는지 종류별로 한 번씩 읽는다(owner RLS). 못 읽으면 '모름'(링크 없이 글자만).
const ORIGINAL_READ = {
  notes: ids => `/rest/v1/app_notes?workspace_id=eq.${q(workspaceId())}&id=in.(${ids})&select=id,kind,archived_at,journal_day`,
  meeting: ids => `/rest/v1/app_meetings?workspace_id=eq.${q(workspaceId())}&id=in.(${ids})&select=id`,
  org_update: ids => `/rest/v1/app_suborganization_updates?id=in.(${ids})&select=id,organization_id`,
  project_update: ids => `/rest/v1/app_project_progress_updates?id=in.(${ids})&select=id,project_id`
};
const tableOf = kind => (['basket', 'note', 'work'].includes(kind) ? 'notes' : kind);
async function readOriginals(sources) {
  const want = new Map();
  for (const s of sources) { const w = web2Source(s.location); if (w) { const t = tableOf(w.kind); want.set(t, [...(want.get(t) || []), w.id]); } }
  const found = new Map(), failed = new Set();
  await Promise.all([...want].map(async ([table, ids]) => {
    try {
      const rows = await rt.api(ORIGINAL_READ[table]([...new Set(ids)].map(q).join(',')), { singleFlight: false });
      for (const r of Array.isArray(rows) ? rows : []) if (UUID.test(String(r?.id))) found.set(String(r.id).toLowerCase(), r);
    } catch { failed.add(table); }
  }));
  return { found, failed };
}
function originalOf(source, originals) {
  const w = web2Source(source?.location);
  if (!w) return null;
  if (originals.failed.has(tableOf(w.kind))) return { src: w, label: web2SourceLabel(w, source), target: null, gone: false };
  const target = web2OpenTarget(w, originals.found.get(w.id));
  return { src: w, label: web2SourceLabel(w, source), target, gone: !target };
}
// ‹원문› 열기: 전체 검색과 같은 길(각 화면의 기존 여는 함수).
async function openOriginal(target) {
  const r = window.KPTURouter; if (!r || !target) return;
  try {
    await window.KPTUViewLoader?.load?.(target.view);
    if (target.view === 'basket') { if (target.note === 'doc') requestNoteDocOpen(target.id); else requestBasketNote(target.id); r.go('basket', { source: 'delegated' }); }
    else if (target.view === 'journal') { r.go('journal', { source: 'delegated' }); window.KPTUJournal?.show?.(target.day); }
    else if (target.view === 'projects') { r.go('projects', { source: 'delegated' }); await window.KPTUProjects?.open?.(target.id); }
    else if (target.view === 'team') { r.go('team', { source: 'delegated' }); await window.KPTUWorkplace?.open?.(target.id); }
    else if (target.view === 'meetings') { r.go('meetings', { source: 'delegated' }); await window.__KPTU_MEETING_ROUND_DETAIL_READY__; await window.KPTUMeetingRoundDetail?.open?.(target.id); }
  } catch (e) { console.error('ledger original open', e?.name || 'Error'); }
}

// ---------- 되돌리기 ----------
const changedLedger = () => { try { window.dispatchEvent(new CustomEvent('kptu:ledger-changed', { detail: { source: 'browse' } })); } catch { /* 다음 열기에 */ } window.KPTULedgerExport?.changed?.(); };
async function act(key, job) {
  if (state.acting) return;
  state.acting = key; state.actError = ''; state.notice = ''; render();
  try { await job(); }
  catch (e) { state.actError = undoErrorText(e); }
  state.acting = ''; render();
}
function retireRecord(row, reasonKey) {
  const body = retireRequest(row?.ledger_id, reasonKey);
  if (!body) return;
  return act('retire', async () => {
    const out = await rt.api('/rest/v1/rpc/app_apply_ledger_fix', { method: 'POST', body: { p_workspace_id: workspaceId(), p_request: body, p_dry_run: false }, singleFlight: false });
    const fix = typeof out?.fix_request_id === 'string' && UUID.test(out.fix_request_id) ? out.fix_request_id : null;
    state.openId = null; changedLedger();
    if (fix) offerUndoNotice({ text: `${row.ledger_id}을(를) 틀린 기록으로 표시했어요.`, onUndo: async () => {
      try { await rt.api('/rest/v1/rpc/app_undo_ledger_fix', { method: 'POST', body: { p_fix_request_id: fix }, singleFlight: false }); }
      catch (e) { return { message: undoErrorText(e) }; }
      changedLedger();
      return { message: '되돌렸어요.' };
    } });
  });
}
function undoRun(runId) {
  if (!UUID.test(String(runId || ''))) return;
  return act('run', async () => {
    const out = await rt.api('/rest/v1/rpc/app_auto_ledger_undo', { method: 'POST', body: { p_run_id: runId }, singleFlight: false });
    state.openId = null; changedLedger();
    const n = Number.isInteger(out?.records_retired) ? out.records_retired : null;
    state.notice = `이번 자동 기록을 취소했어요${n !== null ? `(기록 ${n}건 폐기)` : ''}.`;
  });
}

async function toggleDetail(id) {
  if (state.openId === id) { state.openId = null; render(); return; }
  state.openId = id; state.detailError = '';
  if (!state.details.has(id)) {
    state.detailBusy = id; render();
    try {
      const d = await readDetail(id);
      if (d) state.details.set(id, d); else state.detailError = '이 기록을 읽을 수 없습니다.';
    } catch { state.detailError = '상세를 읽지 못했습니다. 잠시 뒤 다시 시도하세요.'; }
    state.detailBusy = '';
  }
  render();
  document.querySelector(`#lbDetail-${CSS.escape(id)}`)?.focus?.({ preventScroll: true });
}

// ---------- 그리기 ----------
function render() {
  const root = document.querySelector('#ledgerBrowseRoot');
  if (!root) return;
  root.dataset.ledgerBrowse = state.phase;
  root.hidden = state.phase === 'hidden';
  if (state.phase === 'hidden') { root.innerHTML = ''; return; }
  if (!root.querySelector('[data-lb-shell]')) root.innerHTML = shellHtml();
  syncForm(root);
  const box = root.querySelector('#lbResults');
  if (state.phase === 'loading') box.innerHTML = '<p class="lg-note" role="status">원장을 읽는 중…</p>';
  else if (state.phase === 'error') box.innerHTML = '<p class="lg-error" role="alert">원장을 읽지 못했습니다.</p><button type="button" class="lg-tool" data-lb-action="reload">다시 읽기</button>';
  else box.innerHTML = state.story ? storyHtml() : isSearching(state.filters) ? resultsHtml() : homeHtml();
  root.querySelector('#lbStatus').textContent = state.busy ? '찾는 중…' : state.phase === 'ready' && !state.story && isSearching(state.filters) ? countLabel(state.rows.length, state.limit) : '';
  root.querySelector('#lbChips').innerHTML = chipsHtml();
  root.querySelector('#lbError').innerHTML = (state.error ? `<p class="lg-error" role="alert">${esc(state.error)}</p>` : '')
    + (state.notice ? `<p class="lg-note" role="status" data-lb-notice>${esc(state.notice)}</p>` : '');
}

const SEARCH_ICON = '<svg class="lb-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const isPhone = () => !!window.matchMedia?.('(max-width:760px)').matches;
function shellHtml() {
  const kindBoxes = KINDS.map(k => `<label class="lb-chip" title="${esc(KIND_HINT[k])}" data-hint="${esc(KIND_HINT[k])}"><input type="checkbox" name="lbKind" value="${k}"><span>${KIND_DISPLAY[k]}</span></label>`).join('');
  return `<section class="lg-card lb-card" data-lb-shell aria-labelledby="lbTitle">
    <form id="lbForm" class="lb-form" role="search" novalidate>
      <div class="lb-bar">
        <h3 id="lbTitle" class="lb-h">원장</h3>
        <label class="lb-search"><span class="lg-sr">찾을 말</span>${SEARCH_ICON}<input id="lbQuery" type="search" maxlength="${QUERY_MAX}" placeholder="${isPhone() ? '조직·주제·사람으로 찾기' : '조직·주제·사람·내용으로 찾기 (Enter)'}" autocomplete="off" enterkeyhint="search"></label>
        <button type="button" class="lb-cond-btn" id="lbCondBtn" data-lb-action="cond" aria-expanded="false" aria-controls="lbCond">조건 <span aria-hidden="true">▾</span></button>
        <button type="button" class="lb-add" data-lb-action="add">+ 기록하기</button>
      </div>
      <div class="lb-meta-row"><div id="lbChips" class="lb-chips" aria-label="걸린 조건"></div><p id="lbStatus" class="lb-count" role="status" aria-live="polite"></p></div>
      <div id="lbCond" class="lb-cond" hidden>
        <fieldset class="lb-kinds"><legend>종류</legend>${kindBoxes}</fieldset>
        <div class="lb-line2">
          <span class="lb-f lb-period"><span class="lb-fl">기간</span><input id="lbFrom" class="lb-date" type="date" aria-label="시작 날짜"><span aria-hidden="true">~</span><input id="lbTo" class="lb-date" type="date" aria-label="끝 날짜"></span>
          <label class="lb-f"><span class="lb-fl">조직</span><select id="lbOrg" class="lg-select lb-select"></select></label>
          <label class="lb-f"><span class="lb-fl">주제</span><select id="lbTopic" class="lg-select lb-select"></select></label>
        </div>
        <div class="lb-line2">
          <label class="lb-f"><span class="lb-fl">범위</span><select id="lbScope" class="lg-select lb-select">${SCOPE_CHOICES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="lb-check"><input id="lbInactive" type="checkbox"><span>지난 기록도 보기</span></label>
          <button type="button" class="lb-clear" data-lb-action="clear">조건 지우기</button>
        </div>
      </div>
    </form>
    <div id="lbError"></div>
    <div id="lbResults"></div>
  </section>`;
}
function chipsHtml() {
  return activeConditions(state.filters, state).map(c =>
    `<button type="button" class="lb-tag" data-lb-action="unset" data-lb-key="${esc(c.key)}" aria-label="조건 해제: ${esc(c.label)}">${esc(c.label)} <span aria-hidden="true">✕</span></button>`).join('');
}
function syncForm(root) {
  const f = state.filters;
  const set = (sel, v) => { const el = root.querySelector(sel); if (el && el !== document.activeElement && el.value !== v) el.value = v; };
  set('#lbQuery', f.q); set('#lbFrom', f.from); set('#lbTo', f.to); set('#lbScope', f.scope);
  root.querySelector('#lbInactive').checked = f.inactive;
  root.querySelectorAll('input[name="lbKind"]').forEach(el => { el.checked = f.kinds.includes(el.value); });
  const cond = root.querySelector('#lbCond'), btn = root.querySelector('#lbCondBtn');
  cond.hidden = !state.condOpen; btn.setAttribute('aria-expanded', String(state.condOpen));
  const options = (sel, list, all) => {
    const el = root.querySelector(sel), want = `<option value="">${all}</option>` + list.map(o => `<option value="${esc(o.id)}">${esc(o.name)}${o.ledger_id ? ` (${esc(o.ledger_id)})` : ''}</option>`).join('');
    if (el.dataset.lbOptions !== want) { el.innerHTML = want; el.dataset.lbOptions = want; }
    el.value = sel === '#lbOrg' ? f.organization : f.topic;
  };
  options('#lbOrg', state.organizations, '전체'); options('#lbTopic', state.topics, '전체');
}
function resultsHtml() {
  if (!state.rows.length) return '<p class="lg-note" data-lb-empty>조건에 맞는 기록이 없어요.</p>';
  return `<ul class="lb-list" data-lb-list>${state.rows.map(r => rowHtml(r)).join('')}</ul>
    ${state.rows.length >= state.limit && state.limit < MAX_LIMIT ? `<button type="button" class="lg-tool lb-more" data-lb-action="more" ${state.busy ? 'disabled' : ''}>더 보기</button>` : ''}`;
}
function section(key, title, body, count) {
  return `<section class="lb-sec" data-lb-sec="${key}" aria-labelledby="lbSec-${key}"><h4 id="lbSec-${key}" class="lb-sec-h">${esc(title)}${count ? ` <span class="lb-sec-n">${count}</span>` : ''}</h4>${body}</section>`;
}
function homeHtml() {
  const h = state.home;
  if (!h) return '<p class="lg-note" role="status">원장을 읽는 중…</p>';
  if (h.error) return '<p class="lg-error" role="alert">원장을 읽지 못했어요.</p><button type="button" class="lg-tool" data-lb-action="reload">다시 읽기</button>';
  // 한 기록은 한 칸에만(앞 칸에 나온 기록은 뒤 칸에서 뺀다: 줄·상세 id가 겹치지 않게).
  const shown = new Set();
  const once = rows => rows.filter(r => !shown.has(r.id) && shown.add(r.id));
  const list = (rows, extra) => `<ul class="lb-list">${rows.map(r => rowHtml(r, extra ? extra(r) : '')).join('')}</ul>`;
  const overdue = once(h.overdue), tracking = once(h.tracking), recent = once(h.recent);
  const chips = (type, list) => list.map(c => `<button type="button" class="lb-topic" data-lb-action="story" data-lb-type="${type}" data-lb-sid="${esc(c.id)}">${esc(c.name)} <span class="lb-topic-n">${c.count}</span></button>`).join('');
  const empty = !overdue.length && !tracking.length && !h.orgChips.length && !h.topicChips.length && !recent.length;
  if (empty) return '<p class="lg-note" data-lb-empty>아직 원장 기록이 없어요. 업데이트·사업 보고를 저장하면 자동으로 기록되고, [+ 기록하기]로 직접 넣을 수 있어요.</p>';
  return [
    overdue.length ? section('overdue', '상대가 안 지킨 약속', list(overdue, r => overdueLabel(r)), overdue.length) : '',
    tracking.length ? section('tracking', '지금 추적 중인 일', list(tracking), tracking.length) : '',
    h.orgChips.length || h.topicChips.length ? section('chips', '조직별·주제별', `${h.orgChips.length ? `<div class="lb-topics" data-lb-chips="organization" aria-label="조직">${chips('organization', h.orgChips)}</div>` : ''}${h.topicChips.length ? `<div class="lb-topics" data-lb-chips="topic" aria-label="주제">${chips('topic', h.topicChips)}</div>` : ''}`) : '',
    recent.length ? section('recent', '최근 자동으로 기록됨', list(recent)) : ''
  ].join('');
}
function storyHtml() {
  const s = state.story;
  const head = `<div class="lb-story-head"><button type="button" class="lg-text-btn" data-lb-action="home">‹ 원장</button><h4 id="lbStoryTitle" class="lb-sec-h" tabindex="-1">${esc(s.name)}</h4>${s.rows ? `<span class="lb-sec-n">${s.rows.length}</span>` : ''}</div>`;
  if (s.error) return head + `<p class="lg-error" role="alert">${esc(s.error)}</p>`;
  if (!s.rows) return head + '<p class="lg-note" role="status">이야기를 읽는 중…</p>';
  if (!s.rows.length) return head + '<p class="lg-note" data-lb-empty>이 이야기에 남은 기록이 없어요.</p>';
  return head + `<ol class="lb-timeline" data-lb-story="${esc(s.type)}">${s.rows.map(r => rowHtml(r)).join('')}</ol>`;
}
function rowHtml(r, extra = '') {
  const open = state.openId === r.id;
  const v = rowView(r);
  const info = state.changes.get(r.id);
  const tags = [info?.auto ? `<span class="lb-state lb-auto" data-lb-auto>${AUTO_TAG}</span>` : info?.manual ? `<span class="lb-state lb-manual" data-lb-manual>${MANUAL_TAG}</span>` : '',
    v.status ? `<span class="lb-state">${esc(v.status)}</span>` : '',
    r.validity && r.validity !== 'current' ? `<span class="lb-state">${esc(VALIDITY_LABEL[r.validity] || r.validity)}</span>` : '',
    r.sensitivity === 'S2' ? `<span class="lb-state">${esc(SENSITIVITY_LABEL.S2)}</span>` : ''].join('');
  return `<li class="lb-item${open ? ' is-open' : ''}" data-lb-row="${esc(r.id)}" data-lb-kind="${esc(r.kind)}">
    <button type="button" class="lb-head" data-lb-action="open" data-lb-id="${esc(r.id)}" aria-expanded="${open}" aria-controls="lbDetail-${esc(r.id)}">
      <span class="lbr-1"><span class="lbr-kind" data-kind="${esc(r.kind)}">${esc(KIND_DISPLAY[r.kind])}</span><span class="lbr-title">${esc(v.title)}</span>${tags}${v.date ? `<span class="lbr-date" title="${esc(v.dateFull)}">${esc(v.date)}</span>` : ''}</span>
      <span class="lbr-2"><span class="lbr-summary">${esc(extra || v.summary)}</span></span>
    </button>
    ${open ? `<div class="lb-detail" id="lbDetail-${esc(r.id)}" tabindex="-1" role="region" aria-label="${esc(v.title)} 상세">${detailHtml(r.id)}</div>` : ''}
  </li>`;
}
function detailHtml(id) {
  if (state.detailBusy === id) return '<p class="lg-note" role="status">상세를 읽는 중…</p>';
  const d = state.details.get(id);
  if (!d) return `<p class="lg-error" role="alert">${esc(state.detailError || '상세를 읽지 못했습니다.')}</p>`;
  const summary = d.record.summary ? `<p class="lb-text">${esc(d.record.summary)}</p>` : '';
  const orgs = (allRows().find(r => r.id === id)?.organizations || []).filter(Boolean);
  const fields = `<dl class="lb-fields">${(orgs.length ? [...d.fields, ['조직', orgs.join(', ')]] : d.fields).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
  const sources = d.sources.length ? `<ul class="lg-list" data-lb-sources>${d.sources.map(s => {
    const src = s.source;
    if (!src) return '<li>(읽을 수 없는 출처)</li>';
    if (s.original) {
      const o = s.original, at = state.openId;
      const open = o.target ? ` <button type="button" class="lg-text-btn" data-lb-action="original" data-lb-id="${esc(at)}" data-lb-src="${esc(s.id)}">‹원문›</button>` : o.gone ? ' <span class="lg-muted" data-lb-gone>원문이 지워졌어요</span>' : '';
      return `<li data-lb-web2="${esc(o.src.kind)}">${esc(o.label)}${open}</li>`;
    }
    const href = sourceHref(src);
    const title = href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(src.title)}</a>` : esc(src.title);
    const meta = [DOC_TYPE_LABEL[src.doc_type] || '', src.source_date || '', s.locator ? `근거위치 ${s.locator}` : '', !href && src.location ? src.location : '', src.status === 'retired' ? '폐기' : ''].filter(Boolean).map(esc).join(' · ');
    return `<li><b>${esc(src.ledger_id)}</b> ${title}${meta ? `<span class="lg-samples">${meta}</span>` : ''}</li>`;
  }).join('')}</ul>` : '<p class="lg-note">연결된 출처가 없습니다.</p>';
  const links = d.links.length ? `<ul class="lg-list" data-lb-links>${d.links.map(l => `<li>${l.dir === 'in' ? '← ' : ''}<b>${esc(l.relation)}</b> ${l.ledgerId && l.kind === 'record' ? `<button type="button" class="lg-tool" data-lb-action="find" data-lb-q="${esc(l.ledgerId)}">${esc(l.ledgerId)}</button> ` : l.ledgerId ? `${esc(l.ledgerId)} ` : ''}${esc(l.title)}${l.kind === 'project' ? ' <span class="lg-muted">(Web2 프로젝트)</span>' : l.kind === 'meeting' ? ' <span class="lg-muted">(Web2 사업 보고)</span>' : ''}</li>`).join('')}</ul>` : '<p class="lg-note">연결이 없습니다.</p>';
  const info = state.changes.get(id), row = d.record;
  const notes = info?.notes?.length ? `<p class="lg-note" data-lb-change>${info.notes.map(esc).join(' · ')}</p>` : '';
  const live = ['current', 'needs_check', 'fulfilled'].includes(d.record.validity);
  const items = [
    live ? `<button type="button" class="lg-tool" data-lb-action="fix" data-lb-id="${esc(id)}"${state.acting ? ' disabled' : ''}>고치기</button>` : '',
    live ? `<p class="lg-note">틀린 기록으로 표시(폐기, 지우지 않음)</p>${RETIRE_REASONS.map(([k, l]) => `<button type="button" class="lg-tool lg-danger" data-lb-action="retire" data-lb-id="${esc(id)}" data-lb-reason="${k}"${state.acting ? ' disabled' : ''}>${esc(l)}</button>`).join('')}` : '',
    info?.auto && info.runId ? `<button type="button" class="lg-tool lg-danger" data-lb-action="undo-run" data-lb-run="${esc(info.runId)}"${state.acting ? ' disabled' : ''}>${state.acting === 'run' ? '취소하는 중…' : '이번 자동 기록 취소'}</button>` : ''
  ].filter(Boolean).join('');
  const menu = items ? `<details class="lc-more lb-more"><summary class="lg-tool" aria-label="기록 관리: ${esc(row.ledger_id)}">⋯</summary><div class="lc-more-panel" role="group" aria-label="기록 관리">${items}</div></details>` : '';
  const err = state.actError ? `<p class="lg-error" role="alert" data-lb-act-error>${esc(state.actError)}</p>` : '';
  return `${menu || notes ? `<div class="lb-detail-top">${notes || '<span></span>'}${menu}</div>` : ''}${err}${summary}${fields}<h5>근거·출처</h5>${sources}<h5>연결</h5>${links}`;
}

function allRows() { return [...state.rows, ...(state.story?.rows || []), ...(state.home?.overdue || []), ...(state.home?.tracking || []), ...(state.home?.recent || [])]; }
function readForm(root) {
  const f = state.filters;
  f.q = root.querySelector('#lbQuery').value;
  f.from = root.querySelector('#lbFrom').value; f.to = root.querySelector('#lbTo').value;
  f.organization = root.querySelector('#lbOrg').value; f.topic = root.querySelector('#lbTopic').value;
  f.scope = root.querySelector('#lbScope').value; f.inactive = root.querySelector('#lbInactive').checked;
  f.kinds = [...root.querySelectorAll('input[name="lbKind"]:checked')].map(el => el.value);
}
function run() { state.limit = PAGE; state.openId = null; void search(); }

function bind() {
  if (bound) return;
  bound = true;
  const root = () => document.querySelector('#ledgerBrowseRoot');
  document.addEventListener('submit', e => {
    if (e.target?.id !== 'lbForm') return;
    e.preventDefault(); readForm(root()); run();
  });
  // 검색칸 Enter = 찾기(한글 입력 중 Enter는 글자 확정이므로 건너뜀). 찾기 버튼은 없다.
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.isComposing || e.target?.id !== 'lbQuery') return;
    e.preventDefault(); readForm(root()); run();
  });
  document.addEventListener('change', e => {
    const r = root();
    if (!r?.contains(e.target) || e.target.id === 'lbQuery') return;
    readForm(r); run();
  });
  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-lb-action]');
    if (!button || !root()?.contains(button) || button.disabled) return;
    const action = button.dataset.lbAction;
    if (action === 'open') void toggleDetail(button.dataset.lbId);
    else if (action === 'more') { state.limit = Math.min(MAX_LIMIT, state.limit + PAGE); void search(); }
    else if (action === 'cond') { state.condOpen = !state.condOpen; render(); }
    else if (action === 'unset') { readForm(root()); state.filters = clearCondition(state.filters, button.dataset.lbKey || ''); render(); run(); root().querySelector('#lbCondBtn')?.focus?.(); }
    else if (action === 'clear') { state.filters = freshFilters(); render(); run(); }
    else if (action === 'reload') void load();
    else if (action === 'original') {
      const d = state.details.get(button.dataset.lbId), s = d?.sources.find(x => x.id === button.dataset.lbSrc);
      if (s?.original?.target) void openOriginal(s.original.target);
    }
    else if (action === 'retire') {
      const row = state.details.get(button.dataset.lbId)?.record;
      const label = (RETIRE_REASONS.find(([k]) => k === button.dataset.lbReason) || [])[1];
      if (row && label && window.confirm(`${row.ledger_id}을(를) 틀린 기록으로 표시할까요? (${label}) 지우지 않고 폐기로 남깁니다.`)) void retireRecord(row, button.dataset.lbReason);
    }
    else if (action === 'undo-run') {
      if (window.confirm('이번 자동 기록 전체를 취소할까요? 그때 들어온 기록은 폐기로 남고, 다른 기록에 붙인 근거는 뗍니다.')) void undoRun(button.dataset.lbRun);
    }
    else if (action === 'find') { state.filters = { ...freshFilters(), q: button.dataset.lbQ || '', inactive: true, scope: 'all' }; render(); run(); }
    else if (action === 'story') void openStory(button.dataset.lbType === 'topic' ? 'topic' : 'organization', button.dataset.lbSid || '');
    else if (action === 'home') { state.story = null; state.openId = null; ++seq; render(); void loadHome(); }
    else if (action === 'add') window.KPTULedgerFix?.open?.({});
    else if (action === 'fix') {
      const d = state.details.get(button.dataset.lbId);
      if (d?.record) { button.closest('details')?.removeAttribute('open'); window.KPTULedgerFix?.open?.({ target: d.record.ledger_id, title: rowView(d.record).title }); }
    }
  });
  window.addEventListener('kptu:ledger-changed', () => { if (state.phase !== 'hidden' || document.querySelector('#ledgerBrowseRoot')) void load(); });
  window.KPTURouter?.on?.('ledger', () => { void load(); });
}

window.addEventListener('kptu:session-changed', () => { state = fresh(); if (document.querySelector('#ledgerBrowseRoot') && workspaceId()) void load(); });
async function boot() {
  installView();
  bind();
  await load();
  // 업무일지 "새로 기록된 약속 N"에서: 약속만 보이게 거른 뒤 화면을 연다(목록은 열 때 읽음).
  window.KPTULedgerBrowse = { reload: load, show: ({ kinds = [] } = {}) => { state.filters = { ...freshFilters(), kinds: kinds.filter(k => KINDS.includes(k)) }; state.openId = null; state.condOpen = false; state.story = null; } };
  return true;
}
window.__KPTU_LEDGER_BROWSE_READY__ = boot().catch(err => { console.error('ledger browse init', err?.name || 'error'); return false; });

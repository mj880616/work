// S57-20 BIZ-보고할일정 PR A(설계 docs/design/biz-report-plan-link.md 3·4절): '보고할 일정'을 읽고 쓰는 길 한 곳.
// 규칙은 report-plan-model.mjs. 여기는 서버 표 app_calendar_report_plans(일정 하나에 줄 하나)와 사업 보고 표의 일정 id 칸만 읽고 쓴다.
// - 저장은 모두 서버(기기 저장 없음). 권한은 DB가 정한다(소유자 RLS) — 여기서 보내는 작업공간 값은 넣을 자리를 가리킬 뿐이고, 남의 것이면 서버가 거절한다.
// - 새 표·새 칸이 없는 서버(적용 전·되돌린 뒤): 읽기가 '없음'으로 끝나고(plans=null), 화면은 표시 없이 지금 그대로 동작한다.
// - 읽은 값은 이 창이 떠 있는 동안만 메모리에 둔다(메뉴가 누른 자리에서 바로 열려야 해서). 로그인·계정이 바뀌면 비운다.
// - 일정 원본은 Google Calendar 그대로다. 여기서는 Google을 부르지 않는다.
import {planDecision, eventStatus, decisionWrite, ruleWrite, copyPatch, reportLink, planRowOf, eventCopy, isMissingStore, reportsOfEvent, nameKey, eventNameKey, PLAN_ON, PLAN_OFF, PLAN_SKIP, BY_RULE} from './report-plan-model.mjs';

const enc = encodeURIComponent;
const PLAN_PATH = '/rest/v1/app_calendar_report_plans';
const PLAN_FIELDS = 'id,google_event_id,google_calendar_id,state,decided_by,decided_at,title,event_day,starts_at';
const REPORT_FIELDS = 'id,title,series_name,meeting_at,created_at,google_event_id,google_calendar_id';
const LIMIT = 1000;
export const REPORT_PLANS_CHANGED = 'kptu:report-plans-changed';

const rtOf = () => window.KPTURuntime;
const ctxOf = rt => rt?.context?.read?.() || window.__KPTU_BOOT_CONTEXT__ || null;
const workspaceOf = rt => { const c = ctxOf(rt); return String(c?.workspace?.id || c?.workspaceId || ''); };
const keyOf = rt => { const c = ctxOf(rt), ws = workspaceOf(rt), user = String(c?.user?.id || ''); return ws && user ? `${rt?.session?.epoch?.() ?? ''}|${user}|${ws}` : ''; };

// store: {key, plans: 줄 목록 | null(표 없음), reports: 일정에 이어진 보고 목록 | null(칸 없음)}
let store = null, loading = null;
const current = (rt = rtOf()) => (store && store.key === keyOf(rt) ? store : null);
const announce = () => { try { window.dispatchEvent(new CustomEvent(REPORT_PLANS_CHANGED)); } catch {} };

async function readRows(rt, path, epoch) {
  try {
    const rows = await rt.api(path, {singleFlight: false, expectedSessionEpoch: epoch});
    return Array.isArray(rows) ? rows : [];
  } catch (error) { if (isMissingStore(error)) return null; throw error; }
}
const readPlans = (rt, ws, epoch) => readRows(rt, `${PLAN_PATH}?workspace_id=eq.${enc(ws)}&select=${PLAN_FIELDS}&order=decided_at.desc&limit=${LIMIT}`, epoch);
const readLinkedReports = (rt, ws, epoch) => readRows(rt, `/rest/v1/app_meetings?workspace_id=eq.${enc(ws)}&google_event_id=not.is.null&select=${REPORT_FIELDS}&order=created_at.desc&limit=${LIMIT}`, epoch);

// 한 번 읽어 두고 다시 쓴다. force면 다시 읽는다. 로그인 전이면 null.
export async function loadReportPlans({force = false} = {}, rt = rtOf()) {
  const key = keyOf(rt);
  if (!key || !rt?.api) return null;
  if (!force && store?.key === key) return store;
  if (!force && loading?.key === key) return loading.promise;
  const ws = workspaceOf(rt), epoch = rt.session?.epoch?.();
  const job = {key};
  job.promise = (async () => {
    const [plans, reports] = await Promise.all([readPlans(rt, ws, epoch), readLinkedReports(rt, ws, epoch)]);
    if (keyOf(rt) !== key) return null;
    store = {key, plans, reports};
    return store;
  })().finally(() => { if (loading === job) loading = null; });
  loading = job;
  const loaded = await job.promise;
  if (loaded) announce();
  return loaded;
}

// 읽어 둔 값(없으면 null — 아직 안 읽었거나 표가 없는 서버).
export function reportPlanData(rt = rtOf()) {
  const s = current(rt);
  return s?.plans ? {plans: s.plans, reports: s.reports || []} : null;
}
// 일정 하나의 '보고할 일정' 상태. {on, status, row} | null(표시하지 않음: 아직 안 읽음·표 없음·넣을 수 없는 일정).
export function eventPlan(event, rt = rtOf()) {
  const data = reportPlanData(rt);
  if (!data || !eventCopy(event)) return null;
  const decision = planDecision(event, data);
  return {on: decision.state === PLAN_ON, status: eventStatus(event, data), row: decision.row};
}
// 일정 내용을 모를 때(달력이 읽어 둔 범위 밖): 줄이 있으면 그 값만. 없으면 null.
export function eventPlanById(eventId, rt = rtOf()) {
  const row = planRowOf(eventId, reportPlanData(rt)?.plans);
  return row ? {on: row.state === PLAN_ON, status: '', row} : null;
}

const isConflict = error => Number(error?.status) === 409 || /23505|duplicate key/i.test(String(error?.message ?? ''));
const first = rows => (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? rows[0] : null);
function keep(row, key) {
  if (!row || store?.key !== key || !store.plans) return;
  store.plans = [row, ...store.plans.filter(p => p.id !== row.id && p.google_event_id !== row.google_event_id)];
}
const postRow = async (rt, ws, body, epoch) => first(await rt.api(`${PLAN_PATH}?select=${PLAN_FIELDS}`, {method: 'POST', body: {workspace_id: ws, ...body}, prefer: 'return=representation', singleFlight: false, expectedSessionEpoch: epoch}));
const patchRow = async (rt, ws, id, body, epoch) => first(await rt.api(`${PLAN_PATH}?workspace_id=eq.${enc(ws)}&id=eq.${enc(id)}&select=${PLAN_FIELDS}`, {method: 'PATCH', body, prefer: 'return=representation', singleFlight: false, expectedSessionEpoch: epoch}));
const readRow = async (rt, ws, eventId, epoch) => first(await rt.api(`${PLAN_PATH}?workspace_id=eq.${enc(ws)}&google_event_id=eq.${enc(eventId)}&select=${PLAN_FIELDS}&limit=1`, {singleFlight: false, expectedSessionEpoch: epoch}));

// [보고할 일정] 켬(on=true) / 끔(false). 끔은 그 일정 하나만 끈다(설계 4-2). 저장된 줄을 돌려준다.
export const setEventPlan = (event, on, rt = rtOf()) => setEventPlanState(event, on ? PLAN_ON : PLAN_OFF, rt);
// 결정 저장 한 길(설계 4-3): state = on(켬·[보고할까요?]) | off(끔 — 이 일정만) | skip(⋯ [빼기] — 같은 이름은 다시 묻지 않음).
// 줄이 있으면 고치고 없으면 넣는다. 다른 기기가 먼저 넣었으면(하나뿐 검사) 다시 읽고 고친다. 줄이 사라졌으면 넣는다.
export async function setEventPlanState(event, state, rt = rtOf()) {
  const loaded = await loadReportPlans({}, rt);
  if (!loaded?.plans) throw new Error('보고할 일정 표시를 아직 쓸 수 없어요.');
  const key = loaded.key, ws = workspaceOf(rt), epoch = rt.session?.epoch?.();
  let write = decisionWrite(planRowOf(event?.id, loaded.plans), state, event);
  if (!write) throw new Error('이 일정은 보고할 일정으로 표시할 수 없어요.');
  let saved = null;
  if (write.method === 'PATCH') {
    saved = await patchRow(rt, ws, write.id, write.body, epoch);
    if (!saved) write = decisionWrite(null, state, event);
  }
  if (!saved && write?.method === 'POST') {
    try { saved = await postRow(rt, ws, write.body, epoch); }
    catch (error) {
      if (!isConflict(error)) throw error;
      const row = await readRow(rt, ws, String(event.id), epoch);
      const again = row && decisionWrite(row, state, event);
      if (!again) throw error;
      saved = await patchRow(rt, ws, again.id, again.body, epoch);
    }
  }
  if (!saved) throw new Error('보고할 일정 표시를 저장하지 못했어요.');
  keep(saved, key);
  // [빼기]는 그 이름 전체다(설계 4-2). 같은 이름 기억으로 저절로 켜 둔 줄(rule, 아직 보고 없음)은 기억을 옮겨 적은 것뿐이라 같이 지운다 — 남겨 두면 뺀 뒤에도 □가 남는다.
  // 사람이 켠 줄(user)과 보고를 쓴 일정의 줄은 그대로 둔다. 지우다 실패해도 [빼기] 저장은 된 것이다(다음에 그 이름을 다시 빼면 지워진다).
  if (state === PLAN_SKIP) await dropRuleRowsOfName(saved, key, rt).catch(() => {});
  announce();
  return {on: saved.state === PLAN_ON, state: saved.state, row: saved};
}
async function dropRuleRowsOfName(saved, key, rt) {
  const name = nameKey(saved.title), s = store?.key === key ? store : null;
  if (!name || !s?.plans) return 0;
  const ids = s.plans.filter(p => p.id !== saved.id && p.decided_by === BY_RULE && p.state === PLAN_ON && nameKey(p.title) === name && !reportsOfEvent(p.google_event_id, s.reports).length).map(p => String(p.id));
  // 지우는 조건을 서버에서도 다시 건다(저절로 켜진 줄·켜짐 그대로일 때만) — 그 사이 다른 기기에서 사람이 정한 줄은 지우지 않는다.
  for (let i = 0; i < ids.length; i += DROP_CHUNK) {
    const part = ids.slice(i, i + DROP_CHUNK);
    await rt.api(`${PLAN_PATH}?workspace_id=eq.${enc(workspaceOf(rt))}&decided_by=eq.${BY_RULE}&state=eq.${PLAN_ON}&id=in.(${part.map(enc).join(',')})`, {method: 'DELETE', singleFlight: false, expectedSessionEpoch: rt.session?.epoch?.()});
    if (store === s) s.plans = s.plans.filter(p => !part.includes(String(p.id)));
  }
  return ids.length;
}
const DROP_CHUNK = 40;

// 저절로 골라 주기(설계 4-3): 같은 이름 기억으로 □가 된 일정을 화면이 처음 볼 때 줄을 넣는다(state=on, decided_by=rule). 이미 줄이 있으면 넣지 않는다.
// events = 화면이 읽은 Google 일정. 넣은 줄 수를 돌려준다. 다른 기기가 먼저 넣었으면(하나뿐 검사) 그 줄을 읽어 둔다. 한 번에 RULE_BATCH건까지(나머지는 다음에 볼 때).
const RULE_BATCH = 40;
let ruleBusy = false;
export async function addRulePlans(events, rt = rtOf()) {
  const s = current(rt);
  if (!s?.plans || ruleBusy) return 0;
  ruleBusy = true;
  const key = s.key, ws = workspaceOf(rt), epoch = rt.session?.epoch?.(), seen = new Set();
  let added = 0;
  try {
    for (const event of Array.isArray(events) ? events : []) {
      if (added >= RULE_BATCH || store?.key !== key) break;
      const id = String(event?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      // 이 일정에 이어진 보고가 있으면(보고 씀) 줄이 필요 없다.
      if (!eventNameKey(event) || reportsOfEvent(id, store.reports).length) continue;
      const write = ruleWrite(event, {plans: store.plans, reports: store.reports || []});
      if (!write) continue;
      let saved = null;
      try { saved = await postRow(rt, ws, write.body, epoch); }
      catch (error) {
        if (!isConflict(error)) throw error;
        saved = await readRow(rt, ws, id, epoch);
      }
      if (saved) { keep(saved, key); added++; }
    }
  } finally { ruleBusy = false; }
  if (added) announce();
  return added;
}

// 사본 맞추기(4-5)를 읽은 일정 여럿에 한 번에: 줄이 있는 일정만 보고, 다른 칸이 있는 줄만 고친다. 고친 줄 수.
export async function syncEventCopies(events, rt = rtOf()) {
  const s = current(rt);
  if (!s?.plans) return 0;
  const key = s.key, ws = workspaceOf(rt), epoch = rt.session?.epoch?.();
  let fixed = 0;
  for (const event of Array.isArray(events) ? events : []) {
    if (store?.key !== key) break;
    const row = planRowOf(event?.id, store.plans);
    const patch = row ? copyPatch(row, event) : {};
    if (!Object.keys(patch).length) continue;
    const saved = await patchRow(rt, ws, row.id, patch, epoch);
    if (saved) { keep(saved, key); fixed++; }
  }
  if (fixed) announce();
  return fixed;
}

// 사본 맞추기(4-5): 이 일정의 줄이 있고 제목·날짜·시각·캘린더 id가 다르면 그 칸만 고친다. 고쳤으면 true.
export async function syncEventCopy(event, rt = rtOf()) {
  const s = current(rt), row = planRowOf(event?.id, s?.plans);
  if (!row) return false;
  const patch = copyPatch(row, event);
  if (!Object.keys(patch).length) return false;
  const saved = await patchRow(rt, workspaceOf(rt), row.id, patch, rt.session?.epoch?.());
  if (!saved) return false;
  keep(saved, s.key);
  announce();
  return true;
}
// Web2에서 일정을 삭제할 때 그 일정의 줄도 같이 삭제한다(4-5). 이어진 보고는 그대로 둔다.
export async function dropEventPlan(eventId, rt = rtOf()) {
  const s = current(rt), id = String(eventId ?? '');
  if (!id || !s?.plans || !planRowOf(id, s.plans)) return false;
  await rt.api(`${PLAN_PATH}?workspace_id=eq.${enc(workspaceOf(rt))}&google_event_id=eq.${enc(id)}`, {method: 'DELETE', singleFlight: false, expectedSessionEpoch: rt.session?.epoch?.()});
  if (store === s) s.plans = s.plans.filter(p => p.google_event_id !== id);
  announce();
  return true;
}

// 보고 저장 때 보고 줄에 넣을 일정 연결 칸. 서버에 칸이 없거나 확인하지 못했으면 {}(연결 없이 지금처럼 저장).
export async function reportLinkBody(event, rt = rtOf()) {
  const link = reportLink(event);
  if (!link.google_event_id) return {};
  const loaded = await loadReportPlans({}, rt).catch(() => null);
  return loaded?.reports ? link : {};
}

if (!window.__KPTU_REPORT_PLANS__) {
  window.__KPTU_REPORT_PLANS__ = true;
  window.addEventListener('kptu:session-changed', () => { if (store && store.key !== keyOf(rtOf())) store = null; });
  // 보고를 저장·삭제하면 '일정에 이어진 보고' 목록을 다시 읽는다(읽어 둔 적이 있을 때만).
  window.addEventListener('kptu:meetings-changed', () => { if (current()) void loadReportPlans({force: true}).catch(() => {}); });
}

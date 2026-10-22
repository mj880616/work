// SEARCH-전체검색 S-2: 전체 검색의 읽기(설계 docs/design/global-search.md 2.2·7절). 화면은 global-search.js 하나가 그린다.
// - DB 기록: RPC app_search_records 한 번(SECURITY INVOKER, owner RLS 그대로). 인자 5개를 모두 보낸다(없으면 null).
// - Google 일정: 검색칸에 처음 글자를 칠 때 기존 Edge google-calendar events로 지난 3개월~앞 6개월을 한 번 읽어 이 탭 메모리에 둔다.
// - Google 할 일: 이 기기 저장본(google-tasks.js의 peekTasks). 없으면 같은 모듈의 listTasks로 한 번 읽는다(미완료 + 최근 완료).
// 쓰기·새 저장소 없음. 로그인이 바뀌면 메모리 사본을 버린다. 요청 취소 대신 요청 번호로 늦게 온 답을 버린다(runtime api에 signal 없음).
import {eventRanges, cleanServer, filterEvents, filterTasks} from './global-search-model.mjs';

const rt = () => window.KPTURuntime;
const ownerId = () => rt()?.session?.read?.()?.user?.id || '';
const EVENTS_TTL = 10 * 60 * 1000;

let events = null;   // {owner, at, list, failed}
let eventsFlight = null;
let tasks = null;    // {owner, list, failed}
let tasksFlight = null;
let epoch = 0;

export function reset() {
  epoch++; events = null; eventsFlight = null; tasks = null; tasksFlight = null;
}
window.addEventListener('kptu:session-changed', reset);

// DB 검색. kind가 있으면 "N건 모두 보기"(그 종류만 offset부터 per줄).
export async function searchRecords(query, {per = 3, kind = null, offset = 0} = {}) {
  const body = {p_query: query, p_kinds: null, p_per_kind: per, p_offset: kind ? offset : 0, p_kind: kind || null};
  const data = await rt().api('/rest/v1/rpc/app_search_records', {method: 'POST', body, singleFlight: false});
  return {words: Array.isArray(data?.words) ? data.words.map(String) : null, groups: cleanServer(data)};
}

// 일정: 한 번 읽어 둔 것을 돌려준다. 실패하면 failed=true(나머지 결과는 그대로).
export function loadEvents({now = Date.now()} = {}) {
  const owner = ownerId();
  if (!owner) return Promise.resolve({list: [], failed: true});
  if (events && events.owner === owner && !events.failed && now - events.at < EVENTS_TTL) return Promise.resolve(events);
  if (eventsFlight) return eventsFlight;
  const mine = epoch;
  const read = ([from, to]) => rt().api(`/functions/v1/google-calendar?action=events&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`, {refreshSession: true});
  eventsFlight = Promise.allSettled(eventRanges(now).map(read)).then(results => {
    if (mine !== epoch || owner !== ownerId()) return {list: [], failed: true};
    const ok = results.filter(r => r.status === 'fulfilled' && Array.isArray(r.value?.events) && !(r.value.warning && !r.value.events.length));
    const seen = new Set(), list = [];
    for (const r of ok) for (const e of r.value.events) {
      const key = (e?.calendarId || '') + '\n' + (e?.id || '');
      if (!e?.id || seen.has(key)) continue;
      seen.add(key);
      // 설명은 찾지 않으므로 두지 않는다(결정 4).
      list.push({id: e.id, calendarId: e.calendarId || null, title: e.title || '', location: e.location || '', start: e.start || null, allDay: !!e.allDay});
    }
    events = {owner, at: Date.now(), list, failed: ok.length !== results.length};
    return events;
  }).finally(() => { eventsFlight = null; });
  return eventsFlight;
}

async function tasksModule() {
  if (!window.KPTUGoogleTasks) await import('./google-tasks.js');
  return window.KPTUGoogleTasks;
}
// 할 일: 이 기기 저장본 먼저, 없으면 한 번 읽기. 미완료 + 최근 완료(google-tasks.js와 같은 기준).
export function loadTasks() {
  const owner = ownerId();
  if (!owner) return Promise.resolve({list: [], failed: true});
  if (tasks && tasks.owner === owner && !tasks.failed) return Promise.resolve(tasks);
  if (tasksFlight) return tasksFlight;
  const mine = epoch;
  tasksFlight = (async () => {
    let list = null, failed = false;
    try {
      const gt = await tasksModule();
      const copy = gt?.peekTasks?.();
      if (copy && copy.owner === owner) list = copy.tasks;
      else {
        const r = await gt.listTasks();
        if (r?.status === 'ok') list = r.tasks; else failed = true;
      }
      const recent = gt?.completedRecently || (() => true);
      list = (list || []).filter(t => t?.status !== 'completed' || recent(t));
    } catch { failed = true; list = []; }
    if (mine !== epoch || owner !== ownerId()) return {list: [], failed: true};
    tasks = {owner, list, failed};
    return tasks;
  })().finally(() => { tasksFlight = null; });
  return tasksFlight;
}

// 브라우저가 찾는 묶음(일정·할 일). 아직 못 읽었으면 그 묶음은 비어 있고 상태로 알린다.
export function localMatches(words) {
  const owner = ownerId();
  const ev = events && events.owner === owner ? events : null, tk = tasks && tasks.owner === owner ? tasks : null;
  return {
    schedule: ev ? filterEvents(ev.list, words) : [],
    task: tk ? filterTasks(tk.list, words) : [],
    eventsFailed: !!ev?.failed, tasksFailed: !!tk?.failed
  };
}

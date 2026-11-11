// S58-10 BIZ-보고할일정 PR C: 사업 보고 달력의 '보고할 일정' 시험용 흉내 서버(시험 쪽 메모리). 화면 사진 만들 때도 같은 것을 쓴다.
// 서버 표 app_calendar_report_plans(일정 하나에 줄 하나)·사업 보고(app_meetings의 일정 id 칸)·Google 일정 읽기(Edge google-calendar action=events)만 흉내 낸다.
// 일정·이름·id는 모두 가짜다. 오늘은 2026-11-11(수) 12:00(서울)로 고정한다.
import {expect} from '@playwright/test';
import {loginEntry} from './login-entry.mjs';
import {signInWithSession} from './session-login.mjs';
import {installViewPrefsServer} from './view-prefs-server.mjs';

export const BASE = process.env.APP_E2E_ORIGIN || 'http://127.0.0.1:8123';
export const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';
export const NOW = '2026-11-11T03:00:00Z';
export const WS = 'rc-ws';
const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const iso = (day, time) => new Date(`${day}T${time}:00+09:00`).toISOString();
export const DAY = n => `2026-11-${String(n).padStart(2, '0')}`;

const meeting = (n, title, day, time, extra = {}) => ({id: ID(n), workspace_id: WS, title, series_name: title, round_no: null, meeting_at: iso(day, time), activity_kind: 'meeting', created_by: 'rc-user', notes: '', decisions: '', transcript_text: '가짜 원문', created_at: iso(day, '20:00'), google_event_id: null, google_calendar_id: null, ...extra});
const event = (id, title, day, time, extra = {}) => ({id, calendarId: 'own', title, start: iso(day, time), end: new Date(Date.parse(iso(day, time)) + 3600e3).toISOString(), allDay: false, description: '', location: '', organizationIds: [], recurring: false, source: 'google', ...extra});
const plan = (n, eventId, title, day, time, state, extra = {}) => ({id: 'plan-' + n, workspace_id: WS, google_event_id: eventId, google_calendar_id: 'own', state, decided_by: 'user', decided_at: '2026-11-01T00:00:00.000Z', title, event_day: day, starts_at: time ? iso(day, time) : null, created_at: '2026-11-01T00:00:00.000Z', ...extra});
export const REPORT = {head: ID(901), weekly: ID(902), study: ID(903)};

// store=false: 새 표·새 칸이 아직 없는 서버(적용 전·되돌린 뒤). busy=true: 13일에 보고 4건을 더해 PC 칸에 '+n'이 나오게 한다.
export function makeState({store = true, busy = false, google = true} = {}) {
  const meetings = [
    meeting(901, '가짜 본부 집행위', DAY(11), '09:00', {google_event_id: 'ev-done', google_calendar_id: 'own'}), // 일정에 이어 쓴 보고 → ●
    meeting(902, '시험 주간 회의', DAY(4), '10:00', {google_event_id: 'wk-1104', google_calendar_id: 'own'}),   // 이 이름은 전에 보고를 썼다 → 같은 이름 일정은 저절로 □
    meeting(903, '예시 교육', DAY(10), '14:00')                                                              // 일정과 이어지지 않은 보고
  ];
  if (busy) ['09:00', '10:30', '13:00', '14:30'].forEach((t, i) => meetings.push(meeting(921 + i, `예시 묶음 ${i + 1}`, DAY(13), t)));
  const events = [
    event('ev-done', '가짜 본부 집행위', DAY(11), '09:00'),
    event('ev-todo', '가짜 지부 간담회', DAY(11), '10:00', {location: '가짜 회의실'}),
    event('ev-ask', '예시 기자회견', DAY(11), '15:00', {organizationIds: ['org-1']}),
    event('ev-ask-next', '예시 기자회견', DAY(20), '15:00', {organizationIds: ['org-1']}),
    event('ev-plain', '가짜 점심 약속', DAY(12), '12:00'),
    event('ev-ask-busy', '예시 현장 방문', DAY(13), '16:00', {organizationIds: ['org-2']}),
    event('wk-1104', '시험 주간 회의', DAY(4), '10:00'),
    event('wk-1118', '시험 주간 회의', DAY(18), '10:00'),
    event('wk-1125', '시험 주간 회의', DAY(25), '10:00'),
    event('ev-late1', '시험 운영위', DAY(9), '14:00'),
    event('ev-late2', '예시 대표자 회의', DAY(5), '11:00'),
    event('ev-off', '가짜 정리 모임', DAY(12), '18:00')
  ];
  const plans = [
    plan(1, 'ev-todo', '가짜 지부 간담회', DAY(11), '10:00', 'on'),
    plan(2, 'ev-late1', '시험 운영위', DAY(9), '14:00', 'on'),
    plan(3, 'ev-late2', '예시 대표자 회의', DAY(5), '11:00', 'on'),
    plan(4, 'ev-off', '가짜 정리 모임', DAY(12), '18:00', 'off')
  ];
  return {store, google, meetings, events, plans, seq: 100, planWrites: [], reportPosts: [], eventReads: [], planReads: 0,
    user: {id: 'rc-user', email: 'qa@example.org', user_metadata: {display_name: 'QA'}}};
}

export async function install(page, state) {
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method(), path = url.pathname;
    if (url.origin === BASE) return route.continue();
    if (url.origin !== SB) return route.abort();
    const ok = (body, status = 200) => route.fulfill({status, contentType: 'application/json', body: JSON.stringify(body ?? null)});
    const eq = name => { const v = url.searchParams.get(name); return v && v.startsWith('eq.') ? v.slice(3) : null; };
    if (path === '/auth/v1/token') return ok({access_token: 'synthetic', refresh_token: 'synthetic', expires_at: 4102444800, user: state.user});
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});
    if (path === '/rest/v1/app_workspace_members') return ok([{workspace_id: WS, user_id: state.user.id, role: 'owner', workspace: {id: WS, slug: 'qa', name: 'QA'}}]);
    if (path === '/rest/v1/app_workspaces') return ok([{id: WS, slug: 'qa', name: 'QA'}]);
    if (path === '/rest/v1/app_profiles') return ok([{user_id: state.user.id, display_name: 'QA'}]);
    if (path === '/rest/v1/app_calendar_report_plans') {
      if (!state.store) return ok({code: 'PGRST205', message: "Could not find the table 'public.app_calendar_report_plans' in the schema cache"}, 404);
      // 권한은 서버(RLS 소유자)가 정한다 — 흉내 서버도 내 작업공간 값이 아니면 아무것도 주지 않는다.
      if (method === 'GET') { state.planReads++; if (eq('workspace_id') !== WS) return ok([]); const id = eq('google_event_id'); return ok(state.plans.filter(p => !id || p.google_event_id === id)); }
      const body = method === 'DELETE' ? null : req.postDataJSON?.() ?? null;
      state.planWrites.push({method, query: decodeURIComponent(url.search), body});
      if (method === 'POST') {
        if (body.workspace_id !== WS) return ok({code: '42501', message: 'new row violates row-level security policy'}, 403);
        if (body.decided_by === 'rule' && body.state !== 'on') return ok({code: '23514', message: 'violates check constraint'}, 400);
        if (state.plans.some(p => p.google_event_id === body.google_event_id)) return ok({code: '23505', message: 'duplicate key value violates unique constraint "app_calendar_report_plans_event_key"'}, 409);
        const row = {id: 'plan-' + (++state.seq), created_at: new Date().toISOString(), ...body}; state.plans.push(row); return ok([row], 201);
      }
      if (eq('workspace_id') !== WS) return ok([]);
      if (method === 'PATCH') {
        const row = state.plans.find(p => p.id === eq('id')); if (!row) return ok([]);
        const next = {...row, ...body};
        if (next.decided_by === 'rule' && next.state !== 'on') return ok({code: '23514', message: 'violates check constraint'}, 400);
        Object.assign(row, body); return ok([row]);
      }
      if (method === 'DELETE') {
        const one = eq('google_event_id'), many = (url.searchParams.get('id') || '').match(/^in\.\((.*)\)$/)?.[1]?.split(',').map(decodeURIComponent) || null;
        const by = eq('decided_by'), st = eq('state');
        state.plans = state.plans.filter(p => !((one ? p.google_event_id === one : many ? many.includes(p.id) : false) && (!by || p.decided_by === by) && (!st || p.state === st)));
        return ok([]);
      }
      return ok({message: 'method'}, 405);
    }
    if (path === '/rest/v1/app_meetings') {
      const wantsLink = /google_event_id/.test(url.search);
      if (method === 'GET') {
        if (wantsLink && !state.store) return ok({code: '42703', message: 'column app_meetings.google_event_id does not exist'}, 400);
        const id = eq('id');
        if (id) return ok(state.meetings.filter(m => m.id === id));
        return ok(wantsLink ? state.meetings.filter(m => m.google_event_id) : state.meetings);
      }
      if (method === 'POST') {
        const body = req.postDataJSON(); state.reportPosts.push(body);
        if (!state.store && ('google_event_id' in body || 'google_calendar_id' in body)) return ok({code: 'PGRST204', message: "Could not find the 'google_event_id' column of 'app_meetings' in the schema cache"}, 400);
        const row = {id: ID(++state.seq), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), google_event_id: null, google_calendar_id: null, ...body};
        state.meetings.push(row); return ok([row], 201);
      }
      return ok([]);
    }
    if (path === '/functions/v1/google-calendar') {
      const action = url.searchParams.get('action');
      if (method === 'POST') return ok({ok: true});
      if (!state.google) return ok({connected: false, enabled: false, selected: [], calendars: [], events: [], eventColors: {}});
      const status = {connected: true, enabled: true, selected: ['own'], calendars: [{id: 'own', summary: '내 캘린더', accessRole: 'owner', backgroundColor: '#336699'}], colors: {}, eventColors: {}};
      if (action === 'events') {
        const min = Date.parse(url.searchParams.get('timeMin')), max = Date.parse(url.searchParams.get('timeMax'));
        state.eventReads.push({timeMin: url.searchParams.get('timeMin'), timeMax: url.searchParams.get('timeMax')});
        return ok({...status, events: state.events.filter(e => Date.parse(e.start) >= min && Date.parse(e.start) < max).map(e => ({...e}))});
      }
      return ok(status);
    }
    if (path === '/functions/v1/google-tasks') {
      if (url.searchParams.get('action') === 'links') return ok({links: [], meeting_links: []});
      return ok({connected: true, authorized: true, needs_reconnect: false, tasks: [], links: [], meeting_links: [], pending_scope: 'all'});
    }
    if (path.startsWith('/functions/v1/')) return ok({});
    if (path.startsWith('/rest/v1/rpc/')) return ok(null);
    return ok([]);
  });
}

// 사업 보고 [달력]을 연다(고른 보기는 서버 기억 view_prefs.report_view). 달력이 그려질 때까지 기다린다.
// routes(page): 위 흉내 서버 뒤에 더 거는 가로채기(나중에 건 것이 먼저 받는다 — 사진 출처·올리기 흉내 등).
export async function openReportCalendar(page, state, {width = 1280, height = 900, routes = null} = {}) {
  await page.setViewportSize({width, height});
  await page.clock.setFixedTime(new Date(NOW));
  await installViewPrefsServer(page, {report_view: 'calendar'});
  await install(page, state);
  if (routes) await routes(page);
  await page.goto(loginEntry(BASE + '/app/?view=meetings'));
  await signInWithSession(page, 'qa@example.org');
  await page.waitForFunction(() => window.KPTUViewLoader?.isLoaded('meetings'));
  await expect(page.locator('#reportViewSelect')).toHaveValue('calendar');
  const cal = page.locator('#meetingList .rv-cal');
  await expect(cal.locator(`[data-rv-cell="${DAY(11)}"]`)).toBeVisible();
  return cal;
}

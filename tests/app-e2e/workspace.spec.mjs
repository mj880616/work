import { test, expect } from '@playwright/test';
import { watchRetiredCollaboration } from './helpers/retired-collaboration.mjs';
watchRetiredCollaboration(test);

const SB = 'https://xmlkxfjeagycwttklxjw.supabase.co';

function now() { return new Date().toISOString(); }

async function installSupabaseMock(page, state) {
  await page.route(`${SB}/**`, async route => {
    const req = route.request();
    const url = new URL(req.url());
    const method = req.method();
    const path = url.pathname;
    const body = (() => { try { return req.postDataJSON(); } catch { return null; } })();
    const ok = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data ?? null) });

    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
      return ok({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer', user: state.user });
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      return ok({ access_token: 'e2e-access-2', refresh_token: 'e2e-refresh-2', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer', user: state.user });
    }
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});

    if (path === '/functions/v1/google-calendar') {
      const action=url.searchParams.get('action');
      if (method==='POST' && body?.action==='create-event') {
        const row={id:`google-${(state.googleEvents||[]).length+1}`,title:body.title,start:body.start_iso,end:body.end_iso,calendarId:body.calendar_id||'primary',source:'google'};
        state.googleEvents=(state.googleEvents||[]).concat(row);
        return ok({ok:true,event:row});
      }
      if (action === 'events') return ok({ events: state.googleEvents||[], eventColors: {} });
      return ok({ connected: true, enabled: true, selected: ['primary'], calendars: [{id:'primary',summary:'기본',primary:true,accessRole:'owner',backgroundColor:'#4285f4'}], colors: {} });
    }
    if (path === '/functions/v1/google-tasks') {
      const action=url.searchParams.get('action');
      if (action === 'create') {
        const row={id:`google-task-${state.tasks.length+1}`,title:body.title,due:body.due,status:'needsAction',taskListId:'@default',taskListTitle:'내 할 일'};
        state.tasks.push(row);
        return ok({ok:true,task:row});
      }
      if (action === 'toggle') {
        const row=state.tasks.find(task=>task.id===body.task_id);
        Object.assign(row,{status:body.completed?'completed':'needsAction',completed:body.completed?now():null});
        return ok({ok:true,task:row});
      }
      return ok({connected:true,authorized:true,tasks:state.tasks,links:[]});
    }
    if (path.startsWith('/functions/v1/')) return ok({});


    if (path.startsWith('/rest/v1/rpc/')) return ok(null);

    if (path === '/rest/v1/app_workspace_members') {
      if (url.searchParams.has('user_id') && url.searchParams.get('limit') === '1') return ok([{ workspace_id: state.workspace.id, role: 'owner', user_id: state.user.id, email: state.user.email }]);
      return ok(state.members);
    }
    if (path === '/rest/v1/app_profiles') return ok(state.profiles);
    if (path === '/rest/v1/app_workspaces') return ok([state.workspace]);
    if (path === '/rest/v1/app_profile_workplaces') return ok(state.workplaces);
    if (path === '/rest/v1/app_profile_report_projects') return ok([]);

    if (path === '/rest/v1/app_spaces') {
      if (method === 'GET') return ok(state.spaces);
      if (method === 'POST') {
        const row = { ...(body || {}), id: `space-${state.spaces.length + 1}`, created_at: now(), updated_at: now() };
        state.spaces.push(row);
        return ok([row]);
      }
      if (method === 'PATCH') return ok([]);
    }

    if (path === '/rest/v1/app_events') {
      if (method === 'GET') return ok(state.events);
      if (method === 'POST') {
        const row = { ...(body || {}), id: `event-${state.events.length + 1}`, created_at: now() };
        state.events.push(row);
        return ok([row]);
      }
    }
    if (path === '/rest/v1/app_event_suborganizations') return ok([]);

    if (path === '/rest/v1/app_meetings') {
      if (method === 'GET') return ok(state.meetings);
      if (method === 'POST') {
        const row = { ...(body || {}), id: `meeting-${state.meetings.length + 1}`, created_at: now() };
        state.meetings.push(row);
        return ok([row]);
      }
    }

    if (path === '/rest/v1/app_documents') return ok(state.documents);
    if (path === '/rest/v1/app_groups') return ok([]);
    if (path === '/rest/v1/app_group_members') return ok([]);
    if (path === '/rest/v1/app_pages') return ok(state.pages);
    if (path === '/rest/v1/app_page_shares') return ok([]);
    if (path === '/rest/v1/app_project_updates') return ok([]);
    if (path === '/rest/v1/app_project_checkitems') return ok([]);
    if (path === '/rest/v1/app_project_comments') return ok([]);



    if (path === '/rest/v1/app_direct_messages') {
      if (method === 'GET') return ok(state.directMessages);
      if (method === 'POST') {
        const row = { ...(body || {}), id: `message-${state.directMessages.length + 1}`, created_at: now(), read_at: null };
        state.directMessages.push(row);
        return ok([row]);
      }
      if (method === 'PATCH') return ok([]);
    }

    if (path.startsWith('/rest/v1/')) return ok([]);
    return ok({});
  });
}

test('login and core workspace flows remain usable', async ({ page }) => {
  const legacyTaskRequests=[];
  page.on('request',req=>{if(new URL(req.url()).pathname==='/rest/v1/app_tasks')legacyTaskRequests.push(req.method())});
  const state = {
    user: { id: 'user-1', email: 'e2e@example.org', user_metadata: { display_name: 'E2E 사용자' } },
    workspace: { id: 'workspace-1', slug: 'public-institutions', name: '웹2' },
    members: [
      { workspace_id: 'workspace-1', user_id: 'user-1', role: 'owner', email: 'e2e@example.org' },
      { workspace_id: 'workspace-1', user_id: 'user-2', role: 'editor', email: 'peer@example.org' }
    ],
    profiles: [
      { user_id: 'user-1', display_name: 'E2E 사용자', job_title: '국장' },
      { user_id: 'user-2', display_name: '동료 사용자', job_title: '팀원' }
    ],
    workplaces: [
      { id: 'workplace-1', user_id: 'user-1', full_name: '한국철도공사', sort_order: 10, created_at: now() },
      { id: 'workplace-2', user_id: 'user-1', full_name: '공항철도', sort_order: 20, created_at: now() }
    ],
    spaces: [{ id: 'space-1', workspace_id: 'workspace-1', name: '기존 프로젝트', parent_id: null, status: 'active', owner_id: 'user-1', visibility: 'team', sort_order: 10, created_at: now() }],
    pages: [{ id: 'page-1', workspace_id: 'workspace-1', space_id: 'space-1', slug: 'e2e-page', title: 'E2E 게시글', summary: '공개 게시글', visibility: 'public', status: 'published', owner_id: 'user-1', published_at: now(), created_at: now(), updated_at: now() }],
    events: [], googleEvents: [], tasks: [], meetings: [], documents: [], directMessages: [],

  };

  await installSupabaseMock(page, state);
  const returnTo='http://127.0.0.1:8123/app/';
  await page.goto(`http://127.0.0.1:8123/app/login/?return=${encodeURIComponent(returnTo)}`);

  await expect(page.locator('#emailAuthToggle')).toBeVisible({ timeout: 10000 });
  await page.locator('#emailAuthToggle').click();
  await expect(page.locator('#authEmail')).toBeVisible();
  await page.locator('#authEmail').fill('e2e@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({ timeout: 10000 });

  await page.locator('[data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await expect(page.locator('#googleCalendarPanel')).toBeVisible();
  expect(await page.locator('#googleCalendarPanel').evaluate(el=>el.open)).toBe(false);
  await expect(page.locator('#calendarUpcoming,#upcomingEvents')).toHaveCount(0);
  const addSize=await page.locator('#newEventBtn').evaluate(el=>el.getBoundingClientRect().width);
  expect(addSize).toBeLessThanOrEqual(44);
  await page.locator('#newEventBtn').click();
  await page.locator('#eventTitle').fill('E2E Web2 일정');
  await page.locator('#eventStartDate').fill('2026-09-14');
  await page.locator('#eventStartTime').fill('10:00');
  await page.locator('#eventEndDate').fill('2026-09-14');
  await page.locator('#eventEndTime').fill('11:00');
  await page.locator('#saveEventBtn').click();
  await expect.poll(() => state.events.length).toBe(1);
  expect(state.events[0].calendar_scope).toBe('personal');
  await expect(page.locator('.cm-app')).toContainText('E2E Web2 일정');

  await page.locator('#newEventBtn').click();
  await page.locator('#eventTitle').fill('E2E Google 일정');
  await page.locator('#eventTarget').selectOption('google');
  await page.locator('#eventStartDate').fill('2026-09-15');
  await page.locator('#eventStartTime').fill('10:00');
  await page.locator('#eventEndDate').fill('2026-09-15');
  await page.locator('#eventEndTime').fill('11:00');
  await page.locator('#saveEventBtn').click();
  await expect.poll(() => state.googleEvents.length).toBe(1);
  await expect(page.locator('.cp-event')).toContainText('E2E Google 일정');

  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#tasksView')).toBeVisible();
  await expect(page.locator('#taskList')).toBeEmpty();
  await expect(page.locator('#gtTaskSection')).toBeVisible();
  await page.locator('#newTaskBtn').click();
  await page.locator('#gtEditTitle').fill('E2E 할 일');
  await page.locator('#gtEditDue').fill(new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10));
  await page.locator('#gtSaveBtn').click();
  const task=page.locator('#gtTaskBody [data-google-task="google-task-1"]');
  await expect(task).toContainText('E2E 할 일');
  await expect(task).toHaveClass(/pending/);
  await task.locator('[data-gt-toggle]').click();
  await expect(task).toHaveClass(/completed/);
  await expect.poll(() => state.tasks[0].status).toBe('completed');
  // Only the task screen has retired this API; meeting follow-ups still use it.
  expect(legacyTaskRequests).toEqual([]);

  await expect(page.locator('#userBadge,#profileView,#teamManageTop')).toHaveCount(0);
  await page.locator('.app-nav [data-view="team"]').click();
  await expect(page.locator('#teamView')).toBeVisible();
  await expect(page.locator('#soOrganizationList')).toBeVisible();

  await page.locator('[data-view="pages"]').click();
  await expect(page.locator('#pagesView')).toBeVisible();
  await expect(page.locator('#web1BoardActive')).toContainText('위험업무 2인1조 법제화');
  await expect(page.locator('#web1BoardActive')).toContainText('공공기관 인력확충');
  await expect(page.locator('#web1BoardActive')).not.toContainText('E2E 게시글');

  await page.locator('[data-view="projects"]').click();
  await page.locator('#newProjectBtn').click();
  await expect(page.locator('#ps3CreateModal')).toBeVisible();
  await page.locator('#ps3CreateName').fill('E2E 프로젝트');
  await page.locator('#ps3CreateSave').dispatchEvent('click');
  await expect.poll(() => state.spaces.length).toBeGreaterThan(1);
  await expect(page.locator('#appView')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-ps3-close="ps3DetailModal"]').click();

  await page.locator('[data-view="meetings"]').click();
  await expect(page.locator('#meetingsView')).toBeVisible();
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('E2E 회의');
  await page.locator('#meetingAt').fill('2026-09-24T11:00');
  await page.locator('#meetingTranscript').fill('E2E 회의 결과 원문');
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(() => state.meetings.length).toBeGreaterThan(0);
  await expect(page.locator('#appView')).toBeVisible({ timeout: 10000 });

  await expect(page.locator('[data-view="messages"],#messagesView,[data-cc-view="messages"]')).toHaveCount(0);

  await expect(page.locator('#ccNotifTop,#ccNotifSidebar,#notificationsView,[data-kptu-notifications]')).toHaveCount(0);
});

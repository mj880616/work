import { test, expect } from '@playwright/test';

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
      return ok({ access_token: 'e2e-access', refresh_token: 'e2e-refresh', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer' });
    }
    if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
      return ok({ access_token: 'e2e-access-2', refresh_token: 'e2e-refresh-2', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, token_type: 'bearer' });
    }
    if (path === '/auth/v1/user') return ok(state.user);
    if (path === '/auth/v1/logout') return ok({});

    if (path === '/functions/v1/google-calendar') {
      if (url.searchParams.get('action') === 'events') return ok({ events: [], eventColors: {} });
      return ok({ connected: false, enabled: false, selected: [], calendars: [], colors: {} });
    }
    if (path.startsWith('/functions/v1/')) return ok({});

    if (path === '/rest/v1/rpc/app_respond_project_invitation') {
      const invite = state.projectInvites.find(x => x.id === body?.p_invitation);
      if (invite) invite.status = body?.p_accept ? 'accepted' : 'declined';
      return ok(null);
    }
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
    if (path === '/rest/v1/app_space_members') return ok([]);

    if (path === '/rest/v1/app_events') {
      if (method === 'GET') return ok(state.events);
      if (method === 'POST') {
        const row = { ...(body || {}), id: `event-${state.events.length + 1}`, created_at: now() };
        state.events.push(row);
        return ok([row]);
      }
    }
    if (path === '/rest/v1/app_event_attendees') return ok([]);

    if (path === '/rest/v1/app_tasks') {
      if (method === 'GET') return ok(state.tasks);
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body || {}];
        const created = rows.map(x => ({ ...x, id: `task-${state.tasks.length + 1}`, assignment_status: x.assignment_status || 'accepted', created_at: now(), updated_at: now() }));
        state.tasks.push(...created);
        return ok(created);
      }
      if (method === 'PATCH') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const row = state.tasks.find(x => x.id === id);
        if (row) Object.assign(row, body || {});
        return ok([]);
      }
      if (method === 'DELETE') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const idx = state.tasks.findIndex(x => x.id === id);
        if (idx >= 0) state.tasks.splice(idx, 1);
        return ok([]);
      }
    }

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

    if (path === '/rest/v1/app_project_invitations') {
      if (method === 'GET') return ok(state.projectInvites);
      if (method === 'POST') {
        const rows = Array.isArray(body) ? body : [body || {}];
        rows.forEach(x => state.projectInvites.push({ ...x, id: `invite-${state.projectInvites.length + 1}`, created_at: now() }));
        return ok(rows);
      }
      if (method === 'PATCH') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const row = state.projectInvites.find(x => x.id === id);
        if (row) Object.assign(row, body || {});
        return ok([]);
      }
    }

    if (path === '/rest/v1/app_notifications') {
      if (method === 'GET') return ok(state.notifications);
      if (method === 'PATCH') {
        const id = (url.searchParams.get('id') || '').replace(/^eq\./, '');
        const related = (url.searchParams.get('related_id') || '').replace(/^eq\./, '');
        state.notifications.forEach(n => {
          if ((id && n.id === id) || (related && n.related_id === related)) Object.assign(n, body || {});
        });
        return ok([]);
      }
    }

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
  const state = {
    user: { id: 'user-1', email: 'e2e@example.org', user_metadata: { display_name: 'E2E 사용자' } },
    workspace: { id: 'workspace-1', slug: 'public-institutions', name: '공공기관사업팀 Workspace' },
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
    events: [], tasks: [], meetings: [], documents: [], directMessages: [],
    projectInvites: [{ id: 'invite-1', project_id: 'space-1', user_id: 'user-1', role: 'edit', status: 'pending', created_at: now() }],
    notifications: [{ id: 'notif-1', user_id: 'user-1', kind: 'project_invite', related_id: 'invite-1', title: '프로젝트 초대', body: '기존 프로젝트에 초대되었습니다.', created_at: now(), read_at: null }]
  };

  await installSupabaseMock(page, state);
  await page.goto('http://127.0.0.1:8123/app/');

  await expect(page.locator('#emailAuthToggle')).toBeVisible({ timeout: 10000 });
  await page.locator('#emailAuthToggle').click();
  await expect(page.locator('#authEmail')).toBeVisible();
  await page.locator('#authEmail').fill('e2e@example.org');
  await page.locator('#authPassword').fill('password123');
  await page.locator('#authSubmit').click();
  await expect(page.locator('#appView')).toBeVisible({ timeout: 10000 });

  await page.locator('[data-view="calendar"]').click();
  await expect(page.locator('#calendarView')).toBeVisible();
  await page.locator('#newEventBtn').click();
  await page.locator('#eventTitle').fill('E2E 일정');
  await page.locator('#eventStart').fill('2026-09-14T10:00');
  await page.locator('#saveEventBtn').click();
  await expect.poll(() => state.events.length).toBe(1);

  await page.locator('[data-view="tasks"]').click();
  await expect(page.locator('#tasksView')).toBeVisible();
  await expect(page.locator('#tlTaskSections')).toContainText('내 할 일');
  await expect(page.locator('#tlTaskSections')).toContainText('팀에서 부여된 할 일');
  await page.locator('#newTaskBtn').click();
  await page.locator('#taskTitle').fill('E2E 할 일');
  await page.locator('#saveTaskBtn').click();
  await expect.poll(() => state.tasks.length).toBeGreaterThan(0);
  await expect(page.locator('.tl-task-section').first()).toContainText('E2E 할 일');
  await expect(page.locator('.tl-task-section').first().locator('.tl-completed')).not.toHaveAttribute('open', '');
  await page.locator('.tl-task-section').first().locator('[data-tl-toggle]').click();
  await expect.poll(() => state.tasks[0].status).toBe('done');
  await expect(page.locator('.tl-task-section').first().locator('.tl-completed summary')).toContainText('완료된 할 일');

  await page.locator('[data-view="profile"]').click();
  await expect(page.locator('#profileView')).toBeVisible();
  await expect(page.locator('#psWorkplaceList')).toContainText('한국철도공사');
  await expect(page.locator('#psWorkplaceList')).toContainText('공항철도');
  await expect(page.locator('#psWorkplaceList input')).toHaveCount(0);

  await page.locator('[data-view="pages"]').click();
  await expect(page.locator('#pagesView')).toBeVisible();
  await expect(page.locator('#pageList')).toContainText('E2E 게시글');
  const shortcut=page.locator('[data-page-shortcut="1"]');
  await expect(shortcut).toHaveText('바로가기');
  await expect(shortcut).toHaveAttribute('target','_blank');
  await expect(shortcut).toHaveAttribute('href',/slug=e2e-page.*external=1|external=1.*slug=e2e-page/);

  await page.locator('[data-view="projects"]').click();
  await page.locator('#newProjectBtn').click();
  await expect(page.locator('#projectCreateModal')).toBeVisible();
  await page.locator('#newProjectName').fill('E2E 프로젝트');
  await page.locator('#saveProjectBtn').dispatchEvent('click');
  await expect.poll(() => state.spaces.length).toBeGreaterThan(1);
  await expect(page.locator('#appView')).toBeVisible({ timeout: 10000 });

  await page.locator('[data-view="meetings"]').click();
  await expect(page.locator('#meetingsView')).toBeVisible();
  await page.locator('#newMeetingBtn').click();
  await page.locator('#meetingTitle').fill('E2E 회의');
  await page.locator('#saveMeetingBtn').click();
  await expect.poll(() => state.meetings.length).toBeGreaterThan(0);
  await expect(page.locator('#appView')).toBeVisible({ timeout: 10000 });

  await expect(page.locator('[data-view="messages"]')).toBeVisible({ timeout: 10000 });
  await page.locator('[data-view="messages"]').click();
  await expect(page.locator('#messagesView')).toBeVisible();
  await page.locator('[data-cc-peer="user-2"]').click();
  await page.locator('#ccMessageBody').fill('E2E 메시지');
  await page.locator('#ccSendMessage').click();
  await expect.poll(() => state.directMessages.length).toBe(1);

  await page.locator('#ccNotifTop').click();
  await expect(page.locator('#notificationsView')).toBeVisible();
  await expect(page.locator('[data-ncu-project-response="accept"]')).toBeVisible();
  await page.locator('[data-ncu-project-response="accept"]').click();
  await expect.poll(() => state.projectInvites[0].status).toBe('accepted');
  await expect(page.locator('#ncuList')).toContainText('수락함');
});
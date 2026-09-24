import {test, expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const supabase = 'https://xmlkxfjeagycwttklxjw.supabase.co';

async function mock(page, role) {
  await page.route(`${supabase}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/auth/v1/token' ? {access_token: 'qa', refresh_token: 'qa', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600} :
      path === '/auth/v1/user' ? {id: 'qa-user', email: 'qa@example.org', user_metadata: {display_name: 'QA'}} :
      path === '/rest/v1/app_workspace_members' ? [{workspace_id: 'qa-ws', user_id: 'qa-user', role}] :
      path === '/rest/v1/app_workspaces' ? [{id: 'qa-ws', name: 'QA Workspace'}] :
      path === '/rest/v1/app_profiles' ? [{user_id: 'qa-user', display_name: 'QA'}] :
      path === '/rest/v1/app_access_requests' ? [{id: 'req-1', user_id: 'new-user', status: 'pending'}] :
      path === '/functions/v1/google-calendar' ? {connected: false, enabled: false, calendars: [], events: []} :
      path === '/functions/v1/google-tasks' ? {tasks: [], needs_reconnect: false} :
      path.startsWith('/rest/v1/') || path.startsWith('/functions/v1/') ? [] : {};
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
  });
}

for (const role of ['owner', 'author']) {
  test(`${role} workspace does not expose member approval from a legacy link`, async ({page}) => {
    await mock(page, role);
    await page.goto(loginEntry('http://127.0.0.1:8123/app/?view=team&focus=access-requests'));
    await page.locator('#emailAuthToggle').click();
    await page.locator('#authEmail').fill('qa@example.org');
    await page.locator('#authPassword').fill('password123');
    await page.locator('#authSubmit').click();
    await expect(page.locator('#teamView')).toBeVisible();
    await expect(page.locator('#soTeamSection')).toBeVisible();
    await expect(page.locator('#aaReviewSection,#aaHomeCard,.aa-nav-badge,#memberList,#inviteBtn,#inviteModal')).toHaveCount(0);
  });
}

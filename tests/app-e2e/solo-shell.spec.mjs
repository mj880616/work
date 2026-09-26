import {test, expect} from '@playwright/test';
import {loginEntry} from './helpers/login-entry.mjs';

const supabase = 'https://xmlkxfjeagycwttklxjw.supabase.co';
const person = {id: 'solo-shell-user', email: 'solo@example.org', user_metadata: {display_name: '김명진'}};

async function mockWorkspace(page) {
  await page.route(`${supabase}/**`, route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/auth/v1/token' ? {access_token: 'solo-access', refresh_token: 'solo-refresh', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600} :
      path === '/auth/v1/user' ? person :
      path === '/rest/v1/app_workspace_members' ? [{workspace_id: 'solo-workspace', user_id: person.id, role: 'owner'}] :
      path === '/rest/v1/app_workspaces' ? [{id: 'solo-workspace', name: '웹2'}] :
      path === '/rest/v1/app_profiles' ? [{user_id: person.id, display_name: '김명진'}] :
      path === '/functions/v1/google-calendar' ? {connected: false, enabled: false, selected: [], calendars: [], events: []} :
      path === '/functions/v1/push-notifications' ? {enabled: false, web_enabled: false, native_enabled: false, public_key: 'qa'} :
      path.startsWith('/rest/v1/') ? [] : {};
    return route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(data)});
  });
}

for (const width of [1280, 768, 390, 360]) {
  test(`solo workspace shell at ${width}px has no member or message UI`, async ({page}) => {
    await page.setViewportSize({width, height: 844});
    await mockWorkspace(page);
    await page.goto(loginEntry('http://127.0.0.1:8123/app/'));
    await page.locator('#emailAuthToggle').click();
    await page.locator('#authEmail').fill(person.email);
    await page.locator('#authPassword').fill('password123');
    await page.locator('#authSubmit').click();
    await expect(page.locator('#appView')).toBeVisible();
    await page.locator('.app-nav [data-view="team"]').click();
    await expect(page.locator('#teamView')).toBeVisible();
    await expect(page.locator('#soTeamSection')).toBeVisible();
    await expect(page.locator('#userBadge')).toHaveCount(0);
    await expect(page.locator('.topbar')).not.toContainText('김명진');
    await expect(page.locator('#workspaceRole,#memberList,#inviteModal,#messagesView,[data-view="messages"],[data-cc-view="messages"]')).toHaveCount(0);
    await expect(page.locator('.app-nav')).not.toContainText('구성원');
    await expect(page.locator('.app-nav')).not.toContainText('메시지');
    await expect(page.locator('#appView')).not.toContainText('소유자');
    await expect(page.locator('#appView')).not.toContainText('구성원');
    await expect(page.locator('#ccMobileDock')).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

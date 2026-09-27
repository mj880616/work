import { expect } from '@playwright/test';

// Catch retired requests even when a broad API mock returns an empty success.
export function watchRetiredCollaboration(test) {
  const calls = new WeakMap();
  test.beforeEach(async ({ page }) => {
    const seen = [];
    calls.set(page, seen);
    page.on('request', request => {
      const path = new URL(request.url()).pathname;
      if (/^\/rest\/v1\/(app_event_attendees|app_space_members|app_project_invitations|rpc\/app_respond_project_invitation)$/.test(path)) {
        seen.push(`${request.method()} ${path}`);
      }
    });
  });
  test.afterEach(async ({ page }) => {
    expect(calls.get(page), 'Web2 must not request retired collaboration APIs').toEqual([]);
  });
}

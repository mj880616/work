import { test, expect } from '@playwright/test';

const loaderUrl='http://127.0.0.1:8123/app/loader-v2.js?task8=1';

test('noncritical page builder and AI modules are not awaited during startup', async ({ request }) => {
  const response=await request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  for(const path of [
    './page-builder.js?v=2',
    './workplace-ai-report.js?v=1',
    './workflow-ai-v3.js?v=2',
    './meeting-ai-ingest-client.js?v=1&text=1',
    './meeting-ai-paste-ui.js?v=1'
  ]) expect(source).not.toContain(`await import('${path}')`);
});

test('critical readiness boundary remains explicit', async ({ request }) => {
  const response=await request.get(loaderUrl);
  expect(response.ok()).toBeTruthy();
  const source=await response.text();
  expect(source).toContain('await window.__KPTU_TEAM_READY__');
  expect(source).toContain('window.__KPTU_MARK_APP_UI_READY__?.()');
});

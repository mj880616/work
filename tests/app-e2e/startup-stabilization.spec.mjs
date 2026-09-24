import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('project loader waits for the actual project boot promise',()=>{
  const project=read('app/project-system-v3.js');
  const viewLoader=read('app/view-loader.js');
  expect(project).toContain("window.__KPTU_PROJECT_V3_READY__=boot().catch");
  expect(project).not.toContain("window.__KPTU_PROJECT_V3_READY__=true");
  expect(viewLoader).toContain("module('./project-system-v3.js?v=21','__KPTU_PROJECT_V3_READY__')");
});

test('library reuses project choices already loaded for its route',()=>{
  const team=read('app/team.js');
  const library=read('app/library-upload.js');
  expect(team).toContain("window.__KPTU_TEAM_SPACES__=()=>spaces");
  expect(library).toContain("const sharedSpaces=window.__KPTU_TEAM_SPACES__?.()");
  expect(library).toContain("luSpaces=Array.isArray(sharedSpaces)?sharedSpaces:");
});

test('push initialization remains available but never blocks requested view readiness',()=>{
  const loader=read('app/loader-v2.js');
  const ready=loader.indexOf("window.__KPTU_MARK_APP_UI_READY__?.({usable:result?.ok===true})");
  const push=loader.indexOf("import('./push-notifications-ui.js?v=4')");
  expect(ready).toBeGreaterThan(-1);
  expect(push).toBeGreaterThan(ready);
});

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('Web2 startup uses core CSS instead of the full feature stylesheet',()=>{
  const loader=read('app/loader-v2.js');
  const core=read('app/core.css');
  expect(loader).toContain("link.href='./core.css?v=1'");
  expect(loader).not.toContain("link.href='./styles.css");
  expect(core).toContain("@import url('./base-ui.css?v=5')");
  expect(core).toContain("@import url('./team.css?v=2')");
  expect(core).toContain("@import url('./workspace-ui.css?v=9')");
});

test('view loader owns feature-specific styles',()=>{
  const source=read('app/view-loader.js');
  expect(source).toContain("await styles(['./calendar-ui.css?v=5','./suborganizations.css?v=5'])");
  expect(source).toContain("await styles(['./task-layout.css?v=4','./google-tasks.css?v=4'])");
  expect(source).toContain("await styles(['./project-system-v3.css?v=13','./forum-flow-polish.css?v=1'])");
  expect(source).toContain("await styles(['./library-upload.css?v=1'])");
  expect(source).toContain("await styles(['./meeting-ui.css?v=8'])");
  expect(source).toContain("await styles(['./web1-press.css?v=1'])");
  expect(source).toContain("await styles(['./suborganizations.css?v=5','./workplace-detail.css?v=3'])");
  expect(source).toContain("await styles(['./photo-room.css?v=2'])");
  expect(source).toContain("await styles(['./notification-center-ui.css?v=2'])");
});

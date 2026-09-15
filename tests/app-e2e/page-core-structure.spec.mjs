import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('page core uses explicit readiness without post-render correction',async()=>{
  const loader=read('app/loader-v2.js');
  const styles=read('app/styles.css');
  const team=read('app/team.js');
  const files=['app/page-list-controller.js','app/page-save-controller.js','app/page-shortcut.js','app/page-management.js','app/page-inline-viewer-v2.js'];

  expect(loader).toContain("page-list-controller.js?v=1");
  expect(loader).toContain('__KPTU_PAGE_LIST_READY__');
  expect(loader).toContain("page-save-controller.js?v=1");
  expect(loader).toContain('__KPTU_PAGE_SAVE_READY__');
  expect(loader).toContain("page-shortcut.js?v=2");
  expect(loader).toContain('__KPTU_PAGE_SHORTCUT_READY__');
  expect(loader).toContain("page-management.js?v=2");
  expect(loader).toContain('__KPTU_PAGE_MANAGEMENT_READY__');
  expect(loader).toContain("page-inline-viewer-v2.js?v=1");
  expect(loader).toContain('__KPTU_PAGE_INLINE_VIEWER_READY__');
  expect(loader).not.toContain('page-editor-fix.js');
  expect(loader).not.toContain("page-inline-viewer.js");
  expect(styles).toContain("page-core.css?v=1");
  expect(team).toContain('function renderPages(){window.KPTUPageList?.render?.()}');
  expect(team).not.toContain("$('#pageList').innerHTML=rows.map");
  expect(team).toContain('__KPTU_SYNC_TEAM_PAGES__');
  expect(existsSync('app/page-editor-fix.js')).toBeFalsy();
  expect(existsSync('app/page-inline-viewer.js')).toBeFalsy();

  for(const path of files){
    const text=read(path);
    expect(text).not.toContain('MutationObserver');
    expect(text).not.toContain("createElement('style')");
    expect(text).not.toContain('createElement("style")');
    expect(text).not.toContain('location.reload');
    expect(text).not.toContain('setTimeout(');
  }
});

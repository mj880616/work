import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('page core and builder use explicit readiness without post-render correction',async()=>{
  const loader=read('app/loader-v2.js');
  const styles=read('app/styles.css');
  const team=read('app/team.js');
  const save=read('app/page-save-controller.js');
  const builder=read('app/page-builder.js');
  const files=['app/page-list-controller.js','app/page-save-controller.js','app/page-builder.js','app/page-shortcut.js','app/page-management.js','app/page-inline-viewer-v2.js'];

  expect(loader).toContain("page-list-controller.js?v=5");
  expect(loader).toContain('__KPTU_PAGE_LIST_READY__');
  expect(loader).toContain("page-save-controller.js?v=4");
  expect(loader).toContain('__KPTU_PAGE_SAVE_READY__');
  expect(loader).toContain("page-builder.js?v=3");
  expect(loader).toContain('__KPTU_PAGE_BUILDER_READY__');
  expect(loader).toContain("page-shortcut.js?v=2");
  expect(loader).toContain('__KPTU_PAGE_SHORTCUT_READY__');
  expect(loader).toContain("page-management.js?v=4");
  expect(loader).toContain('__KPTU_PAGE_MANAGEMENT_READY__');
  expect(loader).toContain("page-inline-viewer-v2.js?v=4");
  expect(loader).toContain('__KPTU_PAGE_INLINE_VIEWER_READY__');
  expect(loader).not.toContain('page-editor-fix.js');
  expect(loader).not.toContain("page-inline-viewer.js");
  expect(styles).toContain("page-core.css?v=6");
  expect(styles).toContain("page-builder.css?v=2");
  expect(team).toContain('function renderPages(){window.KPTUPageList?.render?.()}');
  expect(team).not.toContain("$('#pageList').innerHTML=rows.map");
  expect(team).toContain('__KPTU_SYNC_TEAM_PAGES__');
  expect(save).toContain("addEventListener('click',interceptOpen,true)");
  expect(save).toContain('kptu:page-editor-opened');
  expect(builder).toContain("addEventListener('kptu:page-editor-opened'");
  expect(builder).toContain('__KPTU_PAGE_BUILDER_READY__');
  expect(builder).toContain("/functions/v1/page-ai-draft");
  expect(builder).toContain("/functions/v1/document-ai-index");
  expect(builder).toContain("/functions/v1/library-files");
  expect(existsSync('app/page-builder.css')).toBeTruthy();
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

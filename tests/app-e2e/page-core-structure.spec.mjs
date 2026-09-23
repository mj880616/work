import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('authenticated board uses Web1 source without loading retired page management modules',async()=>{
  const loader=read('app/loader-v2.js');
  const team=read('app/team.js');
  const board=read('app/web1-board.js');
  const index=read('app/index.html');

  expect(loader).toContain("import('./web1-board.js?v=3')");
  for(const retired of [
    'page-list-controller.js',
    'page-save-controller.js',
    'page-builder.js',
    'page-shortcut.js',
    'page-management.js',
    'page-inline-viewer-v2.js'
  ])expect(loader).not.toContain(retired);

  expect(team).toContain('function renderPages(){window.KPTUWeb1Board?.render?.()}');
  expect(index).toContain('id="web1BoardActive"');
  expect(index).toContain('id="web1BoardArchived"');
  expect(index).not.toContain('id="newPageBtn"');
  expect(index).not.toContain('id="pageSearch"');
  expect(index).not.toContain('id="pageFilter"');

  expect(board).toContain("key:'2in1'");
  expect(board).toContain("key:'workforce'");
  expect(board).toContain("key:'private-rail'");
  expect(board).toContain("key:'rail-council'");
  expect(board).toContain("key:'sanbyeol'");
  expect(board).not.toContain('public-policy');
  expect(board).not.toContain('/press/');
  expect(board).toContain('main_project_archive_state');
  expect(board).toContain('https://raw.githubusercontent.com/mj880616/work/main/');
  expect(board).toContain('frame.srcdoc=injectReaderBridge');
  expect(board).toContain('repoPathFromCanonical');
  expect(index).toContain('sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-downloads"');
  expect(board).not.toContain('MutationObserver');
  expect(board).not.toContain("createElement('style')");
  expect(board).not.toContain('setTimeout(');
});

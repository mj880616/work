import { test, expect } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

const read=path=>readFileSync(path,'utf8');

test('share pages menu loads no Web1 board and no retired page management modules',async()=>{
  const loader=read('app/loader-v2.js');
  const views=read('app/view-loader.js');
  const team=read('app/team.js');
  const index=read('app/index.html');

  // DOMAIN-④ E2: the Web1 board (web1-board.js, five old Web1 cards and their reader) is removed with Web1.
  expect(existsSync('app/web1-board.js')).toBe(false);
  expect(existsSync('app/web1-board.css')).toBe(false);
  expect(views).not.toContain('web1-board');
  expect(views).toContain("module('./share-pages.js'");
  for(const retired of [
    'page-list-controller.js',
    'page-save-controller.js',
    'page-builder.js',
    'page-shortcut.js',
    'page-management.js',
    'page-inline-viewer-v2.js'
  ]){
    expect(loader).not.toContain(retired);
    expect(views).not.toContain(retired);
    expect(existsSync(`app/${retired}`)).toBe(false);
  }

  expect(team).not.toContain('KPTUWeb1Board');
  expect(index).not.toContain('id="web1BoardActive"');
  expect(index).not.toContain('id="web1BoardDetailModal"');
  expect(index).toContain('id="sharePagesRoot"');
  expect(index).not.toContain('id="newPageBtn"');
  expect(index).not.toContain('id="pageSearch"');
  expect(index).not.toContain('id="pageFilter"');
});

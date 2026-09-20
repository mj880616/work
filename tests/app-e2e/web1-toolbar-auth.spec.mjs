import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';

const repoRoot=new URL('../../',import.meta.url);
const read=path=>readFile(new URL(path,repoRoot),'utf8');

test('Web1 capability manifest exposes only designated anonymous-edit pages',async()=>{
  const js=await read('app/web1-page-capabilities.js');
  expect(js).toContain("'/work/2in1/'");
  expect(js).toContain("'/work/workforce/joint-struggle-0921/'");
  expect(js).not.toContain("publicEdit:true,default");
});

test('Web1 does not inject a shared header before page content',async()=>{
  for(const path of ['2in1/index.html','workforce/joint-struggle-0921/index.html','private-rail/index.html','rail-council/index.html','sanbyeol/index.html','review/260914-press-article-redline/index.html']){
    const html=await read(path);
    expect(html,path).not.toContain('web1-toolbar.js');
    expect(html,path).not.toContain('id="web1Toolbar"');
  }
});

test('Web1 admin auth uses Google OAuth and immutable admin user id',async()=>{
  const js=await read('app/web1-admin-auth.js');
  expect(js).toContain("provider=google");
  expect(js).toContain('987b778e-69fe-4080-ad7f-191dc732d234');
  expect(js).not.toContain('0822');
  expect(js).not.toContain('password');
});

test('designated public-edit pages do not ask for legacy master password',async()=>{
  const html=await read('2in1/index.html');
  expect(html).not.toContain('마스터 비밀번호');
  expect(html).not.toContain('master_password');
  const edge=await read('supabase/functions/pc0921-board/index.ts');
  expect(edge).toContain('PUBLIC_EDIT_BOARDS');
  expect(edge).toMatch(/PUBLIC_EDIT_BOARDS=new Set\(\[["']pc0921["'],["']pc2in1["']\]\)/);
});

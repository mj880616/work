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

test('shared Web1 toolbar has the fixed control order and mounts before title',async()=>{
  const js=await read('app/web1-toolbar.js');
  const back=js.indexOf('web1Back');
  const edit=js.indexOf('web1Edit');
  const print=js.indexOf('web1Print');
  const logout=js.indexOf('web1Logout');
  expect(back).toBeGreaterThan(-1);
  expect(back).toBeLessThan(edit);
  expect(edit).toBeLessThan(print);
  expect(print).toBeLessThan(logout);
  expect(js).toContain('insertBefore');
});

test('Web1 admin auth uses Google OAuth and immutable admin user id',async()=>{
  const js=await read('app/web1-admin-auth.js');
  expect(js).toContain("provider=google");
  expect(js).toContain('987b778e-69fe-4080-ad7f-191dc732d234');
  expect(js).not.toContain('0822');
  expect(js).not.toContain('password');
});

test('representative Web1 pages load the shared toolbar',async()=>{
  for(const path of ['2in1/index.html','workforce/joint-struggle-0921/index.html','private-rail/index.html','rail-council/index.html','sanbyeol/index.html']){
    const html=await read(path);
    expect(html,path).toContain('/work/app/web1-toolbar.js?v=');
  }
});

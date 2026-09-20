import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

test('anonymous public post uses only the single-post RPC and isolated shell',async({page})=>{
  const calls=[];
  await page.route(`${SB}/**`,async route=>{
    const request=route.request();
    calls.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{
      title:'공개 글',summary:'외부 공유용 요약',body:'## 본문\n[자료](https://example.org/data.pdf)\n<script>alert(1)</script>',
      page_design:{layout:'editorial'},updated_at:'2026-09-19T00:00:00Z'
    }])});
  });
  await page.goto(`${BASE}/p/?slug=sample-public`);
  await expect(page.locator('#paper h1')).toHaveText('공개 글');
  await expect(page.locator('#paper h2')).toHaveText('본문');
  await expect(page.locator('#paper a')).toHaveAttribute('href','https://example.org/data.pdf');
  await expect(page.locator('#paper script')).toHaveCount(0);
  await expect(page.locator('nav,#editPageBtn,#secureShareBtn,[data-edit-page]')).toHaveCount(0);
  expect(calls).toEqual([{path:'/rest/v1/rpc/app_public_post',body:{p_slug:'sample-public'}}]);
});

test('private post and guessed slug stay unavailable after publication is revoked',async({page})=>{
  await page.route(`${SB}/rest/v1/rpc/app_public_post`,route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.goto(`${BASE}/p/?slug=private-guess`);
  await expect(page.locator('#paper')).toContainText('공개된 게시글을 찾을 수 없습니다.');
  await expect(page.locator('#paper h1')).toHaveCount(0);
});

test('legacy seventh public URL resolves through the shared shell without a hardcoded base path',async({page})=>{
  await page.route(`${SB}/rest/v1/rpc/app_public_post`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{title:'기존 공개 글',summary:'',body:'공개 본문',updated_at:'2026-09-19T00:00:00Z'}])}));
  await page.goto(`${BASE}/p/bus-strike-publicness-internal-archive-202609/`);
  await expect(page).toHaveURL(/\/p\/\?slug=bus-strike-publicness-internal-archive-202609$/);
  await expect(page.locator('#paper h1')).toHaveText('기존 공개 글');
});

test('project public view uses the same shell and only whitelisted blocks',async({page})=>{
  const calls=[];
  await page.route(`${SB}/**`,route=>{
    const request=route.request();calls.push({path:new URL(request.url()).pathname,body:request.postDataJSON()});
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({title:'산별전환',summary:'공개 개요',blocks:[
      {section:'현황',title:'현재 상황',type:'text',content:{text:'현장 논의 진행'}},
      {section:'현황',title:'조직별 상태',type:'table',content:{columns:['조직','상태'],rows:[['철도','논의'],['지하철','교육']]}},
      {section:'자료',title:'링크',type:'links',content:{items:[{label:'자료',url:'javascript:alert(1)',note:'주의'}]}}
    ]})});
  });
  await page.goto(`${BASE}/p/?slug=project-123456781234123412341234567890ab`);
  await expect(page.locator('#paper h1')).toHaveText('산별전환');
  await expect(page.locator('#paper')).toContainText('현장 논의 진행');
  await expect(page.locator('#paper table')).toContainText('지하철');
  await expect(page.locator('#paper a[href^="javascript:"]')).toHaveCount(0);
  expect(calls).toEqual([{path:'/rest/v1/rpc/app_public_project',body:{p_slug:'project-123456781234123412341234567890ab'}}]);
});

test('unpublished project yields no content on its original URL',async({page})=>{
  await page.route(`${SB}/rest/v1/rpc/app_public_project`,route=>route.fulfill({status:200,contentType:'application/json',body:'null'}));
  await page.goto(`${BASE}/p/?slug=project-123456781234123412341234567890ab`);
  await expect(page.locator('#paper')).toContainText('공개된 게시글을 찾을 수 없습니다.');
  await expect(page.locator('#paper h1')).toHaveCount(0);
});

test('public post migrations constrain rows and remove legacy anonymous paths',()=>{
  const prepare=readFileSync(new URL('../../supabase/migrations/20260920120000_public_single_post_prepare.sql',import.meta.url),'utf8');
  const cutover=readFileSync(new URL('../../supabase/migrations/20260920121000_public_single_post_cutover.sql',import.meta.url),'utf8');
  expect(prepare).toContain("p.status = 'published'");
  expect(prepare).toContain("p.visibility = 'public'");
  expect(prepare).toContain('p.slug = p_slug');
  expect(prepare).toContain("d.visibility = 'public'");
  expect(prepare).toContain("p.visibility = 'unlisted' and p.slug in (");
  expect(prepare).toContain("p_slug = 'public-doc-' || left(replace(d.id::text, '-', ''), 12)");
  expect(prepare).not.toContain('p.workspace_id,');
  expect(cutover).not.toContain('insert into public.app_pages');
  expect(cutover).toContain('drop policy if exists app_pages_public_read');
  expect(cutover).toContain('revoke execute on function public.app_public_projects_snapshot() from anon');
  expect(cutover).toContain('revoke execute on function public.app_public_workspace_snapshot() from anon');
});

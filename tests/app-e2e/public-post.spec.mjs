import {readFileSync} from 'node:fs';
import {test,expect} from '@playwright/test';
import {renderShell} from '../../scripts/public-page-meta.mjs';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';

test('generated slug shell loads the shared renderer and uses fixed metadata slug',async({page})=>{
  const template=readFileSync(new URL('../../p/index.html',import.meta.url),'utf8');
  const shell=renderShell(template,{slug:'generated-public',title:'생성 공개 페이지',summary:'생성 요약',visibility:'public',metadata:{}},{site:'https://mj880616.github.io/work'});
  const calls=[];
  await page.route(`${BASE}/p/generated-public/?slug=wrong-public`,route=>route.fulfill({status:200,contentType:'text/html',body:shell}));
  await page.route(`${SB}/rest/v1/rpc/app_public_post`,route=>{
    calls.push(route.request().postDataJSON());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{title:'생성 공개 페이지',summary:'생성 요약',body:'렌더링 확인',page_design:{}}])});
  });
  await page.goto(`${BASE}/p/generated-public/?slug=wrong-public`);
  await expect(page.locator('#paper h1')).toHaveText('생성 공개 페이지');
  await expect(page.locator('#paper')).toContainText('렌더링 확인');
  expect(calls).toEqual([{p_slug:'generated-public'}]);
});

test('all seven reviewed legacy URLs retain a fixed shell or generic redirect',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../../p/.custom-page-shells.json',import.meta.url),'utf8'));
  expect(manifest.slugs).toHaveLength(6);
  for(const slug of manifest.slugs){
    const shell=readFileSync(new URL(`../../p/${slug}/index.html`,import.meta.url),'utf8');
    expect(shell).toContain(`<meta name="kptu-page-slug" content="${slug}">`);
    expect(shell).toContain('PUBLIC_PAGE_META_START');
  }
  const seventh=readFileSync(new URL('../../p/bus-strike-publicness-internal-archive-202609/index.html',import.meta.url),'utf8');
  expect(seventh).toContain("location.replace('../?slug=bus-strike-publicness-internal-archive-202609')");
});

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

test('legacy public project URL uses the existing not-found UI without calling a project RPC',async({page})=>{
  const calls=[];
  await page.route(`${SB}/**`,route=>{
    calls.push(new URL(route.request().url()).pathname);
    return route.fulfill({status:500,contentType:'application/json',body:'{}'});
  });
  await page.goto(`${BASE}/p/?slug=project-123456781234123412341234567890ab`);
  await expect(page.locator('#paper')).toContainText('공개된 게시글을 찾을 수 없습니다.');
  await expect(page.locator('#paper h1')).toHaveCount(0);
  expect(calls).toEqual([]);
});

test('ordinary public posts still use app_public_post after project publication is retired',async({page})=>{
  const calls=[];
  await page.route(`${SB}/rest/v1/rpc/app_public_post`,route=>{
    calls.push(route.request().postDataJSON());
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{title:'계속 공개되는 글',summary:'요약',body:'본문',page_design:{}}])});
  });
  await page.goto(`${BASE}/p/?slug=still-public`);
  await expect(page.locator('#paper h1')).toHaveText('계속 공개되는 글');
  expect(calls).toEqual([{p_slug:'still-public'}]);
});

test('public post migrations constrain rows and remove legacy anonymous paths',()=>{
  const prepare=readFileSync(new URL('../../supabase/migrations/20260920120000_public_single_post_prepare.sql',import.meta.url),'utf8');
  const cutover=readFileSync(new URL('../../supabase/migrations/20260920122000_public_single_post_cutover.sql',import.meta.url),'utf8');
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
  const ownerOnly=readFileSync(new URL('../../supabase/migrations/20260923074619_web2_project_owner_only.sql',import.meta.url),'utf8');
  expect(ownerOnly).toContain("'projects','[]'::jsonb");
  expect(ownerOnly).toContain('revoke execute on function public.app_public_project(text) from public,anon,authenticated');
  expect(ownerOnly).toContain('create policy app_spaces_scoped_read');
  expect(ownerOnly).toContain('using (owner_id = (select auth.uid()))');
});

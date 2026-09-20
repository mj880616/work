import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';

test('new posts start private, publication is confirmed, and private transition hides the link',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/page-management-fixture.html`);
  await page.evaluate(()=>{
    document.body.innerHTML=`<button id="newPageBtn">새 글</button><div id="editorModal" class="hidden">
      <h2 id="editorHeading"></h2><input id="pageTitle"><input id="pageSlug"><textarea id="pageSummary"></textarea><textarea id="pageBody"></textarea>
      <select id="pageStatus"><option value="draft">초안</option><option value="published">게시</option></select>
      <select id="pageVisibility"><option value="public">공개</option><option value="private">비공개</option></select>
      <select id="pageSpace"></select><div id="pageGroupChecks"></div><div id="revisionList"></div>
      <button id="secureShareBtn" class="hidden">비밀 공유</button><a id="publicOpenBtn" class="hidden">열기</a>
      <button id="savePageBtn">저장</button><div id="editorStatus"></div></div>`;
    window.KPTUCapabilities={workspaceId:()=> 'workspace-1'};
    window.__savedPages=[];
    window.KPTURuntime.api=async(path,options={})=>{
      if(path.startsWith('/rest/v1/app_spaces'))return [];
      if(path.startsWith('/rest/v1/app_groups'))return [];
      if(path.startsWith('/rest/v1/app_page_revisions'))return [];
      if(path==='/rest/v1/rpc/app_save_page_v2'){
        window.__savedPages.push(options.body);
        return {...options.body,id:'page-1',slug:options.body.p_slug,title:options.body.p_title,
          summary:options.body.p_summary,body:options.body.p_body,status:options.body.p_status,
          visibility:options.body.p_visibility,space_id:options.body.p_space};
      }
      return [];
    };
  });
  await page.addScriptTag({url:`${BASE}/app/page-save-controller.js`});
  await page.evaluate(()=>window.__KPTU_PAGE_SAVE_READY__);
  await page.locator('#newPageBtn').click();
  await expect(page.locator('#pageVisibility')).toHaveValue('private');
  await expect(page.locator('#pageStatus')).toHaveValue('draft');
  await page.locator('#pageTitle').fill('시험 게시글');
  await page.locator('#pageVisibility').selectOption('public');
  await expect(page.locator('#pageStatus')).toHaveValue('published');
  let confirmations=0;
  page.on('dialog',async dialog=>{confirmations++;await dialog.accept()});
  await page.locator('#savePageBtn').click();
  await expect(page.locator('#publicOpenBtn')).toBeVisible();
  await expect(page.locator('#copyPublicPageBtn')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__savedPages.length)).toBe(1);
  expect(confirmations).toBe(1);
  expect(await page.evaluate(()=>window.__savedPages[0].p_visibility)).toBe('public');
  await page.locator('#pageVisibility').selectOption('private');
  await page.locator('#savePageBtn').click();
  await expect(page.locator('#publicOpenBtn')).toHaveClass(/hidden/);
  await expect(page.locator('#copyPublicPageBtn')).toHaveClass(/hidden/);
  expect(confirmations).toBe(1);
  expect(await page.evaluate(()=>window.__savedPages.at(-1).p_visibility)).toBe('private');
});

test('editing a legacy group post preserves its existing permission rows',async({page})=>{
  await page.goto(`${BASE}/tests/app-e2e/page-management-fixture.html`);
  await page.evaluate(()=>{
    document.body.innerHTML=`<div id="editorModal" class="hidden"><h2 id="editorHeading"></h2><input id="pageTitle"><input id="pageSlug"><textarea id="pageSummary"></textarea><textarea id="pageBody"></textarea><select id="pageStatus"><option value="draft">초안</option><option value="published">게시</option></select><select id="pageVisibility"></select><select id="pageSpace"></select><div id="revisionList"></div><a id="publicOpenBtn" class="hidden"></a><button id="savePageBtn">저장</button><div id="editorStatus"></div></div>`;
    window.KPTUCapabilities={workspaceId:()=> 'workspace-1'};
    window.__permissionWrites=[];
    window.KPTURuntime.api=async(path,options={})=>{
      if(path.includes('app_page_permissions')){if(options.method)window.__permissionWrites.push(options.method);return [{group_id:'group-1'}]}
      if(path.startsWith('/rest/v1/app_pages?id='))return [{id:'page-1',space_id:null,slug:'legacy-group',title:'기존 글',summary:'',body:'본문',visibility:'groups',status:'draft'}];
      if(path.startsWith('/rest/v1/app_spaces')||path.startsWith('/rest/v1/app_page_revisions'))return [];
      if(path==='/rest/v1/rpc/app_save_page_v2')return {id:'page-1',slug:'legacy-group',title:'기존 글',summary:'',body:'본문',space_id:null,status:'draft',visibility:options.body.p_visibility};
      return [];
    };
  });
  await page.addScriptTag({url:`${BASE}/app/page-save-controller.js`});
  await page.evaluate(()=>window.__KPTU_PAGE_SAVE_READY__);
  await page.evaluate(()=>window.KPTUPageSave.open('page-1'));
  await expect(page.locator('#pageVisibility')).toHaveValue('groups');
  await page.locator('#savePageBtn').click();
  await expect(page.locator('#editorStatus')).toContainText('저장했습니다.');
  expect(await page.evaluate(()=>window.__permissionWrites)).toEqual([]);
});

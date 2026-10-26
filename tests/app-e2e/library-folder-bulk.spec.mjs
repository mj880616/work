import {test,expect} from '@playwright/test';
import {expandLibraryTree} from './helpers/library-tree.mjs';
import {bootLibrary,libFolder,libDoc,SB,press} from './helpers/library-folder-server.mjs';
// LIB-폴더탐색기 화면 ③(docs/design/library-tree.md 12절): 선택 모드 일괄 수정 줄([프로젝트|담당조직|종류 바꾸기][폴더로 옮기기][삭제]),
// 바꾼 칸은 칸별 기록 'user', '… 바꿨어요 · 되돌리기', 일부 실패, PC Ctrl/Shift+클릭 선택.
const FOLDERS=[libFolder('fa','top-a',{name:'가상 A',sort_order:1024}),libFolder('fn',null,{name:'가상 N',sort_order:2048})];
const ORIGIN={project_id:'ai',category:'ai'};
const DOCS=[libDoc('a-1','top-a',{field_origin:{...ORIGIN}}),libDoc('a-2','top-a',{field_origin:{...ORIGIN}}),libDoc('a1-1','child-a1',{field_origin:{...ORIGIN}}),libDoc('n-1',null,{field_origin:{...ORIGIN}})];
const line=page=>page.locator('#libraryFolderStatusLine');
const bar=page=>page.locator('#librarySelectBar');
async function boot(page,width){
  const r=await bootLibrary(page,width,{folders:FOLDERS,items:[],docs:structuredClone(DOCS),group:'폴더'});
  const {s}=r;s.patches=[];
  await page.route(`${SB}/rest/v1/app_documents*`,route=>{
    const req=route.request();if(req.method()!=='PATCH')return route.fallback();
    const id=new URL(req.url()).searchParams.get('id').replace(/^eq\./,''),body=req.postDataJSON();
    s.patches.push({id,body});
    if(s.failPatch===id)return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({message:'fail'})});
    const row=s.docs.find(d=>d.id===id);Object.assign(row,body);return route.fulfill({json:[row]});
  });
  await page.route(`${SB}/rest/v1/app_suborganizations*`,route=>route.fulfill({json:[{id:'org-1',name:'가상 조직',active:true}]}));
  await expandLibraryTree(page);
  return r;
}
async function pick(page,ids,width){
  await press(page,page.locator('#librarySelectBtn'),width);
  for(const id of ids)await page.locator(`[data-lu-pick="${id}"]`).check();
  await expect(page.locator('#librarySelectCount')).toHaveText(`${ids.length}개 골랐음`);
}
const menuItem=(page,name)=>page.locator('#luBulkMenu').getByRole('button',{name,exact:true});

for(const width of [390,1280])test.describe(`일괄 수정 ${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`한 줄 도구줄: 고른 것이 없으면 꺼져 있고, 고르면 켜진다 ${width}`,async({page})=>{
    const {errors}=await boot(page,width);
    await press(page,page.locator('#librarySelectBtn'),width);
    const labels=['프로젝트 바꾸기','담당조직 바꾸기','종류 바꾸기','폴더로 옮기기','삭제'];
    for(const name of labels){await expect(bar(page).getByRole('button',{name,exact:true})).toBeVisible();await expect(bar(page).getByRole('button',{name,exact:true})).toBeDisabled()}
    await page.locator('[data-lu-pick="a-2"]').check();
    for(const name of labels)await expect(bar(page).getByRole('button',{name,exact:true})).toBeEnabled();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`프로젝트 바꾸기: 고른 자료 모두, 사용자 수정 표시, 칸 기록 user, 되돌리기 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    await pick(page,['a-2','a1-1'],width);
    await press(page,bar(page).getByRole('button',{name:'프로젝트 바꾸기',exact:true}),width);
    await expect(page.locator('#luBulkMenu')).toBeVisible();
    await expect(menuItem(page,'프로젝트 없음')).toBeVisible();
    await press(page,menuItem(page,'민자철도 정책 대응'),width);
    await expect.poll(()=>s.patches.length).toBe(2);
    expect(s.patches.map(p=>p.id)).toEqual(['a-2','a1-1']);
    for(const p of s.patches){
      expect(p.body.project_id).toBe('top-b');expect(p.body.auto_classified).toBe(false);expect(p.body.classification_note).toBe('사용자 수정');
      expect(p.body.field_origin).toEqual({project_id:'user',category:'ai'});expect(Object.keys(p.body).sort()).toEqual(['auto_classified','classification_note','field_origin','project_id','updated_at']);
    }
    await expect(line(page)).toContainText('2개의 프로젝트을(를) 바꿨어요');
    expect(s.docs.find(d=>d.id==='a1-1').project_id).toBe('top-b');
    expect(s.docs.find(d=>d.id==='a-1').project_id).toBe('top-a');
    await expect(page.locator('#librarySelectCount')).toHaveText('2개 골랐음');
    await press(page,line(page).locator('.lu-undo'),width);
    await expect.poll(()=>s.docs.find(d=>d.id==='a1-1').project_id).toBe('child-a1');
    expect(s.docs.find(d=>d.id==='a-2').project_id).toBe('top-a');
    expect(s.docs.find(d=>d.id==='a-2').field_origin).toEqual(ORIGIN);
    expect(errors).toEqual([]);
  });

  test(`종류 바꾸기·담당조직 바꾸기 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    await pick(page,['a-1','n-1'],width);
    await press(page,bar(page).getByRole('button',{name:'종류 바꾸기',exact:true}),width);
    await expect(menuItem(page,'기타')).toBeVisible();
    await press(page,menuItem(page,'기타'),width);
    await expect.poll(()=>s.patches.length).toBe(2);
    for(const p of s.patches){expect(p.body.category).toBe('기타');expect(p.body.field_origin.category).toBe('user');expect(p.body.field_origin.project_id).toBe('ai')}
    await expect(line(page)).toContainText('2개의 종류을(를) 바꿨어요');
    s.patches.length=0;
    await press(page,bar(page).getByRole('button',{name:'담당조직 바꾸기',exact:true}),width);
    await expect(menuItem(page,'가상 조직')).toBeVisible();await expect(menuItem(page,'담당조직 없음')).toBeVisible();
    await press(page,menuItem(page,'가상 조직'),width);
    await expect.poll(()=>s.patches.length).toBe(2);
    for(const p of s.patches){expect(p.body.organization_id).toBe('org-1');expect(p.body.classification_note).toBe('사용자 수정')}
    expect(errors).toEqual([]);
  });

  test(`일부만 실패하면 성공한 만큼만 바꾸고 알려 주며, 실패한 자료는 그대로 골라 둔다 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);s.failPatch='a1-1';
    await pick(page,['a-2','a1-1'],width);
    await press(page,bar(page).getByRole('button',{name:'종류 바꾸기',exact:true}),width);
    await press(page,menuItem(page,'기타'),width);
    await expect(line(page)).toContainText('1개의 종류을(를) 바꿨고 1개는 바꾸지 못했어요');await expect(line(page)).toHaveClass(/error/);
    expect(s.docs.find(d=>d.id==='a-2').category).toBe('기타');expect(s.docs.find(d=>d.id==='a1-1').category).toBe('정책자료');
    await expect(page.locator('#librarySelectCount')).toHaveText('2개 골랐음');
    expect(errors.filter(e=>!/500|fail/i.test(e))).toEqual([]);
  });

  test(`폴더로 옮기기: 고른 자료를 한 폴더로(프로젝트는 그대로), 되돌리기 ${width}`,async({page})=>{
    const {s,errors}=await boot(page,width);
    await pick(page,['a-2','a1-1'],width);
    await press(page,bar(page).getByRole('button',{name:'폴더로 옮기기',exact:true}),width);
    await expect(page.locator('#libraryFolderModal')).toBeVisible();
    await expect(page.locator('#libraryFolderHint')).toContainText('고른 2개');
    await press(page,page.locator('#libraryFolderTargets').getByRole('radio',{name:/가상 N/}),width);
    await press(page,page.locator('#libraryFolderSave'),width);
    await expect.poll(()=>s.items.filter(x=>x.folder_id==='fn').map(x=>x.document_id).sort()).toEqual(['a-2','a1-1']);
    expect(s.docs.find(d=>d.id==='a1-1').project_id).toBe('child-a1');
    await expect(line(page)).toContainText('2개를 옮겼어요');
    await press(page,line(page).locator('.lu-undo'),width);
    await expect.poll(()=>s.items.length).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe('PC Ctrl/Shift+클릭',()=>{
  test('선택 모드가 아니어도 Ctrl+클릭으로 시작하고, Shift+클릭으로 범위를 더한다. 그냥 클릭은 자료를 연다',async({page})=>{
    const {errors}=await boot(page,1280);
    const row=id=>page.locator(`[data-lu-document="${id}"]`);
    await row('a-2').click({modifiers:['Control']});
    await expect(bar(page)).toBeVisible();await expect(page.locator('[data-lu-pick="a-2"]')).toBeChecked();await expect(page.locator('#librarySelectCount')).toHaveText('1개 골랐음');
    await expect(page.locator('#documentModal')).toBeHidden();
    await row('n-1').click({modifiers:['Shift']});
    // 폴더 밖(a-2, a1-1) 다음의 줄들 중 a-2부터 n-1까지 보이는 줄 모두.
    const order=await page.locator('#documentList [data-lu-document]').evaluateAll(xs=>xs.filter(x=>x.checkVisibility()).map(x=>x.dataset.luDocument));
    const want=order.slice(order.indexOf('a-2'),order.indexOf('n-1')+1);
    await expect(page.locator('#librarySelectCount')).toHaveText(`${want.length}개 골랐음`);
    for(const id of want)await expect(page.locator(`[data-lu-pick="${id}"]`)).toBeChecked();
    // Ctrl+클릭은 그 줄만 뺀다.
    await row('a-2').click({modifiers:['Control']});
    await expect(page.locator('[data-lu-pick="a-2"]')).not.toBeChecked();await expect(page.locator('#librarySelectCount')).toHaveText(`${want.length-1}개 골랐음`);
    expect(errors).toEqual([]);
  });
});

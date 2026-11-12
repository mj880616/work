import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {bootLibrary,libDoc,libFolder,menuButton,press,movePicker} from './helpers/library-folder-server.mjs';
// S60-18 LIB-받는폴더나누기(시안 docs/design/mockups/lib-receive-sort.html, 명진 11/12 09:52~09:53):
// 받는 폴더(잡동사니)를 연 화면 위 줄·두 칸 칸 머리·폴더 메뉴의 [폴더로 나누기] → 창이 바로 뜨고 제안이 채워짐
// (① 규칙 ② 서버 AI가 기존 폴더 ③ 새 폴더 제안) → 체크·폴더 바꾸기·새 폴더 이름 고치기 → [옮기기]를 눌러야 새 폴더를 만들고 옮김
// → 되돌리기 한 번으로 전부 받는 폴더로, 이번에 만든 빈 폴더도 지움. 가짜 서버·지어낸 이름만. SORT_SHOTS에 폴더를 주면 PR 사진을 남긴다.
const u=n=>`5f000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RECV=u(1),GYO=u(2),HOE=u(3);
const R1=u(101),R2=u(102),R3=u(103),R4=u(104),G1=u(201);
const FOLDERS=[libFolder(GYO,null,{name:'가상 교섭',sort_order:1024}),libFolder(HOE,null,{name:'가상 회의',parent_id:GYO,sort_order:1024}),libFolder(RECV,null,{name:'잡동사니',sort_order:2048})];
const DOCS=[libDoc(G1,null,{title:'가상협약 요구안'}),libDoc(R1,null,{title:'가상협약 잠정합의서'}),libDoc(R2,null,{title:'산별 토론회 발제문'}),libDoc(R3,null,{title:'산별 토론회 자료집'}),libDoc(R4,null,{title:'메모'})];
const ITEMS=[{document_id:G1,folder_id:GYO},{document_id:R1,folder_id:RECV},{document_id:R2,folder_id:RECV},{document_id:R3,folder_id:RECV},{document_id:R4,folder_id:RECV}];
const SHOTS=process.env.SORT_SHOTS||'';
const shot=async(page,name,info)=>{if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}`})}await page.screenshot({path:info.outputPath(name)})};
const modal=page=>page.locator('#librarySortModal');
const row=(page,id)=>modal(page).locator(`[data-sort-row="${id}"]`);
const folderOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;
// 서버 AI(ai-assist kind=library_sort) 흉내: 받은 자료 id만 보고 답한다. 화면이 보낸 몸통은 s.aiBodies에.
async function mockAi(page,s,answer){
  s.aiBodies=[];
  await page.route('**/functions/v1/ai-assist',async route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,body:''});
    const body=req.postDataJSON();s.aiBodies.push(body);
    if(s.aiHold)await s.aiHold;
    return route.fulfill({json:{ok:true,kind:'library_sort',items:answer(body.document_ids)}});
  });
}
const NEW_ANSWER=ids=>ids.flatMap(id=>id===R2||id===R3?[{id,folder_id:null,new:{name:'산별전환',parent_id:GYO},why:'산별 토론 자료'}]:[]);
async function enterReceive(page){await page.locator(`#libraryFolderNav [data-lu-nav="${RECV}"]`).click();await expect(page.locator('#libraryPath')).toContainText('잡동사니')}

test.describe('PC 1280 한 칸',()=>{
  test.use({hasTouch:false});
  test('위 줄 [폴더로 나누기] → 창 바로 → 규칙·AI·새 폴더 제안 → 폴더 바꾸기·이름 고치기 → 옮기기 → 되돌리기 전부 원래대로',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    let release;s.aiHold=new Promise(r=>{release=r});
    await mockAi(page,s,NEW_ANSWER);
    // 다른 폴더를 연 화면에는 단추가 없다.
    await page.locator(`#libraryFolderNav [data-lu-nav="${GYO}"]`).click();
    await expect(page.locator('#libraryPath [data-lu-sort]')).toHaveCount(0);
    await enterReceive(page);
    const btn=page.locator('#libraryPath [data-lu-sort]');
    await expect(btn).toHaveText('폴더로 나누기');
    await btn.click();
    // 창은 AI를 기다리지 않고 바로 뜬다: 규칙으로 찾은 1개는 바로, 나머지 3개는 기다림.
    await expect(modal(page)).toBeVisible();
    await expect(row(page,R1).locator('.lu-sort-pick')).toContainText('가상 교섭');
    await expect(row(page,R1).locator('.lu-sort-why')).toHaveText('같은 낱말로 시작하는 자료가 이 폴더에 있어요');
    await expect(modal(page).locator('#librarySortSub')).toContainText('나머지 3개는 AI가 보고 있어요');
    release();
    // 서버 AI에는 규칙으로 못 찾은 자료 id만(폴더 id·글 없음).
    await expect.poll(()=>s.aiBodies.length).toBe(1);
    expect(s.aiBodies[0]).toEqual({kind:'library_sort',document_ids:[R2,R3,R4].sort((a,b)=>DOCS.findIndex(d=>d.id===a)-DOCS.findIndex(d=>d.id===b))});
    await expect(row(page,R2).locator('.lu-sort-nf')).toHaveText('새 폴더');
    await expect(row(page,R2).locator('.lu-sort-pick').first()).toContainText('가상 교섭 › 산별전환');
    await expect(row(page,R3).locator('.lu-sort-nf')).toHaveText('새 폴더');
    // 같은 새 폴더 묶음의 이름·자리 고치기는 첫 줄 하나에만.
    await expect(modal(page).locator('[data-sort-gname]')).toHaveCount(1);
    await expect(modal(page).locator('.lu-sort-stay summary')).toHaveText('어디에도 맞지 않는 1개 — 그대로 둬요');
    await expect(modal(page).locator('#librarySortSub')).toHaveText('4개 중 1개는 있는 폴더, 2개는 새 폴더를 제안해요 · 그대로 둬요 1개. 체크한 것만 옮겨요.');
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 3개 옮기기');
    await shot(page,'pc-1280-dialog.png',info);
    expect(s.writes.filter(w=>w.method!=='GET')).toEqual([]);
    // 폴더 바꾸기: '📁 … ▾' → 지금 폴더 고르기 창. 받는 폴더 자신은 '지금 여기'로 흐림.
    await row(page,R1).locator('[data-sort-pick]').click();
    await expect(movePicker(page).or(page.locator('#luSortPicker'))).toBeVisible();
    const picker=page.locator('#luSortPicker');
    await expect(picker.locator(`[data-lu-move-folder="${RECV}"]`)).toHaveAttribute('aria-disabled','true');
    await picker.locator(`[data-lu-move-folder="${HOE}"]`).last().click();
    await expect(row(page,R1).locator('.lu-sort-pick')).toContainText('가상 교섭 › 가상 회의');
    // 새 폴더 이름 고치기(같은 묶음 두 줄 모두 바뀜).
    await modal(page).locator('[data-sort-gname]').fill('산별 전환');
    await modal(page).locator('[data-sort-gname]').press('Enter');
    await expect(row(page,R3).locator('.lu-sort-pick').first()).toContainText('가상 교섭 › 산별 전환');
    // 체크를 풀면 그 줄은 옮기지 않는다.
    await row(page,R3).locator('[data-sort-check]').uncheck();
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 2개 옮기기');
    await row(page,R3).locator('[data-sort-check]').check();
    await shot(page,'pc-1280-edited.png',info);
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    const made=s.folders.find(f=>f.name==='산별 전환');
    expect(made).toMatchObject({parent_id:GYO,project_id:null,workspace_id:'workspace-1'});
    expect(folderOf(s,R1)).toBe(HOE);expect(folderOf(s,R2)).toBe(made.id);expect(folderOf(s,R3)).toBe(made.id);expect(folderOf(s,R4)).toBe(RECV);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('3개를 폴더로 옮겼어요 · 새 폴더 1개');
    // 받는 폴더에 1개 남아 단추는 그대로.
    await expect(page.locator('#libraryPath [data-lu-sort]')).toBeVisible();
    await shot(page,'pc-1280-done.png',info);
    // 되돌리기 한 번: 옮긴 것 전부 받는 폴더로, 이번에 만든 빈 폴더는 지움(휴지통에도 남지 않음).
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect.poll(()=>s.folders.some(f=>f.id===made.id)).toBe(false);
    for(const id of [R1,R2,R3,R4])expect(folderOf(s,id)).toBe(RECV);
    expect(s.trash).toEqual([]);
    expect(s.rpc.filter(r=>r.fn==='app_trash_purge').map(r=>r.id)).toEqual([made.id]);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('되돌렸어요 · 3개를 받는 폴더로');
    // 폴더 메뉴(우클릭)에도 [폴더로 나누기] — 받는 폴더에만.
    await page.locator(`#libraryFolderNav [data-lu-nav="${RECV}"]`).click({button:'right'});
    await expect(page.locator('#luFolderMenu [data-lu-folder-action="sort"]')).toHaveText('폴더로 나누기');
    await page.keyboard.press('Escape');
    await page.locator(`#libraryFolderNav [data-lu-nav="${GYO}"]`).click({button:'right'});
    await expect(page.locator('#luFolderMenu')).toBeVisible();
    await expect(page.locator('#luFolderMenu [data-lu-folder-action="sort"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('AI를 못 쓰면 규칙으로 찾은 것만, 나머지는 그대로 둬요(직접 선택 가능) · 받는 폴더가 비면 단추 없음',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await page.route('**/functions/v1/ai-assist',route=>route.fulfill({status:429,json:{ok:false,error:'daily_limit'}}));
    await enterReceive(page);
    await page.locator('#libraryPath [data-lu-sort]').click();
    await expect(modal(page).locator('#librarySortStatus')).toHaveText('오늘 AI 사용량을 다 써서 규칙으로 찾은 것만 보여요.');
    await expect(modal(page).locator('.lu-sort-stay summary')).toHaveText('어디에도 맞지 않는 3개 — 그대로 둬요');
    // 그대로 둬요 줄도 직접 폴더를 고르면 체크되어 옮길 수 있다(접힌 묶음을 펼쳐서).
    await modal(page).locator('.lu-sort-stay summary').click();
    await row(page,R4).locator('[data-sort-pick]').click();
    await page.locator('#luSortPicker').locator(`[data-lu-move-folder="${GYO}"]`).last().click();
    await expect(row(page,R4).locator('[data-sort-check]')).toBeChecked();
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 2개 옮기기');
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    expect(folderOf(s,R1)).toBe(GYO);expect(folderOf(s,R4)).toBe(GYO);expect(folderOf(s,R2)).toBe(RECV);
    expect(s.writes.filter(w=>w.table==='folders')).toEqual([]);
    // 남은 자료를 모두 옮기면 단추가 없어진다.
    await page.locator('#libraryPath [data-lu-sort]').click();
    for(const id of [R2,R3]){await row(page,id).locator('[data-sort-pick]').click();await page.locator('#luSortPicker').locator(`[data-lu-move-folder="${GYO}"]`).last().click()}
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    await expect(page.locator('#libraryPath [data-lu-sort]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('자료 105개: AI는 40개씩 3번, 옮기기는 100개씩 2번, 되돌리기도 전부',async({page})=>{
    const many=Array.from({length:105},(_,i)=>libDoc(u(1000+i),null,{title:`가상 낱장 ${i}`}));
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:many.map(d=>({document_id:d.id,folder_id:RECV})),docs:many,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await mockAi(page,s,ids=>ids.map(id=>({id,folder_id:HOE,new:null,why:'회의 자료'})));
    await enterReceive(page);
    await page.locator('#libraryPath [data-lu-sort]').click();
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 105개 옮기기');
    expect(s.aiBodies.map(b=>b.document_ids.length)).toEqual([40,40,25]);
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    expect(s.items.every(x=>x.folder_id===HOE)).toBe(true);
    expect(s.writes.filter(w=>w.table==='items'&&w.method==='PATCH').length).toBe(2);
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect.poll(()=>s.items.every(x=>x.folder_id===RECV)).toBe(true);
    expect(errors).toEqual([]);
  });
});

test.describe('PC 1280 두 칸',()=>{
  test.use({hasTouch:false});
  test('받는 폴더를 연 칸 머리에 [폴더로 나누기], 하위 폴더 안 받는 폴더도 같음',async({page},info)=>{
    const folders=[...FOLDERS.filter(f=>f.id!==RECV),libFolder(RECV,null,{name:'잡동사니',parent_id:GYO,sort_order:4096})];
    const {s,errors}=await bootLibrary(page,1280,{folders,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:true},receiveFolder:RECV}});
    await mockAi(page,s,NEW_ANSWER);
    await expect(page.locator('[data-lu-pane-i] [data-lu-sort]')).toHaveCount(0);
    await page.locator(`[data-lu-pane-i="0"] [data-lu-nav="${GYO}"]`).click({button:'right'});
    await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
    await page.locator(`[data-lu-pane-i="0"] [data-lu-nav="${RECV}"]`).click({button:'right'});
    await page.locator('#luFolderMenu [data-lu-folder-action="enter"]').click();
    const btn=page.locator('[data-lu-pane-i="0"] .lu-pane-head [data-lu-sort]');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(row(page,R2).locator('.lu-sort-nf')).toHaveText('새 폴더');
    await shot(page,'pc-1280-two.png',info);
    await modal(page).locator('[data-sort-close]').first().click();
    await expect(modal(page)).toBeHidden();
    expect(s.writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('폰 412',()=>{
  test.use({hasTouch:true,isMobile:true});
  test('⋯ 메뉴 [폴더로 나누기] → 창(가로로 넘치지 않음) → 새 폴더 자리 맨 위로 → 옮기기 → 되돌리기',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{receiveFolder:RECV}});
    await mockAi(page,s,NEW_ANSWER);
    await press(page,menuButton(page,'f:'+RECV),412);
    await press(page,page.locator('#luFolderMenu [data-lu-folder-action="sort"]'),412);
    await expect(modal(page)).toBeVisible();
    await expect(row(page,R2).locator('.lu-sort-nf')).toHaveText('새 폴더');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const card=await modal(page).locator('.lu-sort-card').boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);expect(card.x+card.width).toBeLessThanOrEqual(413);
    await shot(page,'phone-412-dialog.png',info);
    // 새 폴더 놓을 자리: 맨 위.
    await press(page,modal(page).locator('[data-sort-place]'),412);
    await press(page,page.locator('#luSortPicker [data-lu-move-out]'),412);
    await expect(modal(page).locator('[data-sort-place]')).toHaveText('놓을 자리: 맨 위 ▾');
    await expect(row(page,R2).locator('.lu-sort-pick').first()).toContainText('산별전환');
    await press(page,modal(page).locator('[data-sort-apply]'),412);
    await expect(modal(page)).toBeHidden();
    const made=s.folders.find(f=>f.name==='산별전환');
    expect(made.parent_id).toBe(null);
    expect(folderOf(s,R2)).toBe(made.id);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('3개를 폴더로 옮겼어요 · 새 폴더 1개');
    await shot(page,'phone-412-done.png',info);
    await press(page,page.locator('#libraryFolderStatusLine .lu-undo'),412);
    await expect.poll(()=>s.folders.some(f=>f.id===made.id)).toBe(false);
    for(const id of [R1,R2,R3,R4])expect(folderOf(s,id)).toBe(RECV);
    expect(errors).toEqual([]);
  });
});

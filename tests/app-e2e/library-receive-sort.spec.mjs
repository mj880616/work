import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {bootLibrary,libDoc,libFolder,menuButton,press} from './helpers/library-folder-server.mjs';
import {folderSheet,sheetGo} from './helpers/folder-sheet.mjs';
import { treeEnter } from './helpers/tree-enter.mjs';
// S69-62: 폴더 고르기 = [파일] '옮길 곳' 창 하나 — 줄 누르기는 고르기+펼치기, [이 폴더로 정하기]·[여기에 두기]로만 정한다.
const sheetId=(page,id)=>folderSheet(page).locator(`.fx-dest-tree [data-fx-dest-pick="${id}"]`);
async function pickIds(page,ids){for(const id of ids)await sheetId(page,id).click();await sheetGo(page).click();await expect(folderSheet(page)).toHaveCount(0)}
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
async function enterReceive(page){await treeEnter(page.locator(`#libraryFolderNav [data-lu-nav="${RECV}"]`));await expect(page.locator('#libraryPath')).toContainText('잡동사니')}

test.describe('PC 1280 한 칸',()=>{
  test.use({hasTouch:false});
  test('위 줄 [폴더로 나누기] → 창 바로 → 규칙·AI·새 폴더 제안 → 폴더 바꾸기·이름 고치기 → 옮기기 → 되돌리기 전부 원래대로',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    let release;s.aiHold=new Promise(r=>{release=r});
    await mockAi(page,s,NEW_ANSWER);
    // 다른 폴더를 연 화면에는 단추가 없다.
    await treeEnter(page.locator(`#libraryFolderNav [data-lu-nav="${GYO}"]`));
    await expect(page.locator('#libraryPath [data-lu-sort]')).toHaveCount(0);
    await enterReceive(page);
    const btn=page.locator('#libraryPath [data-lu-sort]');
    await expect(btn).toHaveText('폴더로 나누기');
    await btn.click();
    // 창은 AI를 기다리지 않고 바로 뜬다: 규칙으로 찾은 1개는 바로, 나머지 3개는 기다림.
    await expect(modal(page)).toBeVisible();
    await expect(row(page,R1).locator('.lu-sort-pick')).toContainText('가상 교섭');
    // S69-16: 이미 그 폴더에 든 닮은 자료(본보기)를 까닭으로 보여 준다.
    await expect(row(page,R1).locator('.lu-sort-why')).toHaveText('닮은 자료: 가상협약 요구안');
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
    await expect(folderSheet(page)).toBeVisible();
    // 받는 폴더 자신은 '지금 여기'(고르면 [이 폴더로 정하기]가 꺼짐), 처음 고른 곳은 지금 제안 폴더.
    await expect(sheetId(page,RECV).locator('.ft-tag')).toHaveText('지금 여기');
    await expect(sheetId(page,GYO)).toHaveAttribute('aria-current','true');
    await sheetId(page,RECV).click();
    await expect(sheetGo(page)).toBeDisabled();
    await pickIds(page,[GYO,HOE]);
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
    // 만든 폴더는 휴지통에 넣은 뒤 비우기(app_trash_purge)까지 한다. 폴더가 목록에서 빠진 때는 아직 비우기 전일 수 있어 끝 상태를 기다린다.
    await expect.poll(()=>s.trash).toEqual([]);
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
    await pickIds(page,[GYO]);
    await expect(row(page,R4).locator('[data-sort-check]')).toBeChecked();
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 2개 옮기기');
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    expect(folderOf(s,R1)).toBe(GYO);expect(folderOf(s,R4)).toBe(GYO);expect(folderOf(s,R2)).toBe(RECV);
    expect(s.writes.filter(w=>w.table==='folders')).toEqual([]);
    // 남은 자료를 모두 옮기면 단추가 없어진다.
    await page.locator('#libraryPath [data-lu-sort]').click();
    for(const id of [R2,R3]){await row(page,id).locator('[data-sort-pick]').click();await pickIds(page,[GYO])}
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    await expect(page.locator('#libraryPath [data-lu-sort]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('자료 105개: AI는 10개씩 11번(S68-16), 옮기기는 100개씩 2번, 되돌리기도 전부',async({page})=>{
    const many=Array.from({length:105},(_,i)=>libDoc(u(1000+i),null,{title:`가상 낱장 ${i}`}));
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:many.map(d=>({document_id:d.id,folder_id:RECV})),docs:many,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await mockAi(page,s,ids=>ids.map(id=>({id,folder_id:HOE,new:null,why:'회의 자료'})));
    await enterReceive(page);
    await page.locator('#libraryPath [data-lu-sort]').click();
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 105개 옮기기');
    expect(s.aiBodies.map(b=>b.document_ids.length)).toEqual([10,10,10,10,10,10,10,10,10,10,5]);
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    expect(s.items.every(x=>x.folder_id===HOE)).toBe(true);
    expect(s.writes.filter(w=>w.table==='items'&&w.method==='PATCH').length).toBe(2);
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect.poll(()=>s.items.every(x=>x.folder_id===RECV)).toBe(true);
    expect(errors).toEqual([]);
  });
});

// S68-16(명진 11/22 14:45 캡처: 34줄 모두 '→ ⋯'): 10개씩 차례로 묻고 묶음마다 줄을 바로 채운다. 늦거나 실패한 묶음은 그 줄만 '그대로 둬요'(까닭 한 줄),
// 근거 없는 그림(붙여넣은 그림 …)은 AI에 보내지 않는다. 끝나면 '⋯' 줄이 하나도 남지 않는다.
test.describe('PC 1280 S68-16 AI 묶음 진행·실패',()=>{
  test.use({hasTouch:false});
  const LOOSE=Array.from({length:23},(_,i)=>libDoc(u(3000+i),null,{title:`가상 낱장 ${i}`}));
  const PASTE=[0,1].map(i=>libDoc(u(3100+i),null,{title:`붙여넣은 그림 11-13 03:3${8+i}`,file_name:`paste-${i}.png`,mime_type:'image/png'}));
  const ALL=[...LOOSE,...PASTE],ITEMS2=ALL.map(d=>({document_id:d.id,folder_id:RECV}));
  const waits=page=>modal(page).locator('.lu-sort-wait');
  test('첫 묶음 답은 바로 보이고, 늦은 묶음은 그 줄만 그대로 둬요, 근거 없는 그림은 AI에 안 보냄, ⋯ 남지 않음',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS2,docs:ALL,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    s.aiBodies=[];let release;const hold=new Promise(r=>{release=r});
    await page.route('**/functions/v1/ai-assist',async route=>{
      const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,body:''});
      const body=req.postDataJSON(),n=s.aiBodies.push(body);
      if(n===2){await hold;return route.fulfill({status:504,json:{ok:false,error:'ai_timeout'}})}
      return route.fulfill({json:{ok:true,kind:'library_sort',items:body.document_ids.map(id=>({id,folder_id:HOE,new:null,why:'회의 자료'}))}});
    });
    await enterReceive(page);
    await page.locator('#libraryPath [data-lu-sort]').click();
    // 첫 묶음(10개)은 채워지고, 둘째 묶음을 기다리는 동안 머리줄에 진행 수.
    await expect(row(page,LOOSE[0].id).locator('.lu-sort-pick')).toContainText('가상 교섭 › 가상 회의');
    await expect(modal(page).locator('#librarySortSub')).toContainText('나머지 13개는 AI가 보고 있어요(10/23)');
    await expect(waits(page)).toHaveCount(13);
    // 근거 없는 그림 2개(이름도 기본, 그림 글자도 없음)는 AI에 보내지 않고 그림 모음 새 폴더(맨 위, 체크 꺼짐) — S68-18.
    for(const d of PASTE){await expect(row(page,d.id).locator('.lu-sort-why')).toHaveText('근거가 없어 그림끼리 모아요');await expect(row(page,d.id).locator('.lu-sort-pick').first()).toContainText('그림 모음');await expect(row(page,d.id).locator('.lu-sort-check')).not.toBeChecked()}
    release();
    await expect(waits(page)).toHaveCount(0);
    expect(s.aiBodies.map(b=>b.document_ids.length)).toEqual([10,10,3]);
    expect(s.aiBodies.flatMap(b=>b.document_ids).some(id=>PASTE.some(d=>d.id===id))).toBe(false);
    await expect(row(page,LOOSE[10].id).locator('.lu-sort-why')).toHaveText('AI 답이 늦어 건너뛰었어요 — 직접 선택');
    await expect(row(page,LOOSE[22].id).locator('.lu-sort-pick')).toContainText('가상 교섭 › 가상 회의');
    await expect(modal(page).locator('#librarySortStatus')).toHaveText('AI 제안을 일부 받지 못했어요. 그 줄은 폴더를 직접 선택해 주세요.');
    await expect(modal(page).locator('#librarySortSub')).toHaveText('25개 중 13개는 있는 폴더, 2개는 새 폴더를 제안해요 · 그대로 둬요 10개. 체크한 것만 옮겨요.');
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 13개 옮기기');
    expect(s.writes.filter(w=>w.method!=='GET')).toEqual([]);
    expect(errors).toEqual([]);
  });
  test('서버에 닿지 못하면 남은 묶음도 보내지 않고 모든 줄을 바로 그대로 둬요',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS2,docs:ALL,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    let calls=0;
    await page.route('**/functions/v1/ai-assist',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,body:''});calls++;return route.fulfill({status:404,body:'not found'})});
    await enterReceive(page);
    await page.locator('#libraryPath [data-lu-sort]').click();
    await expect(modal(page).locator('#librarySortStatus')).toHaveText('AI 제안을 받지 못해 규칙으로 찾은 것만 보여요. 나머지는 폴더를 직접 선택해 주세요.');
    await expect(waits(page)).toHaveCount(0);
    expect(calls).toBe(1);
    await expect(modal(page).locator('.lu-sort-stay summary')).toHaveText('어디에도 맞지 않는 23개 — 그대로 둬요');
    await expect(row(page,LOOSE[22].id).locator('.lu-sort-why')).toHaveText('AI 답을 받지 못했어요 — 직접 선택');
    expect(s.writes.filter(w=>w.method!=='GET')).toEqual([]);
    expect(errors).toEqual([]);
  });
});

// S68-18(명진 11/22 15:32): 이름이 기본 이름뿐인 그림은 그림 속 글자(서버가 읽어 둔 글자)로 폴더를 찾고, 못 찾으면 AI에 글자째 맡기고,
// 그래도 모르면 그림만 모으는 폴더(이름에 '사진'이 든 기존 폴더)를 제안한다. 아직 안 읽은 그림은 글자 읽기를 서버에 맡긴다(기다리지 않음).
test.describe('PC 1280 S68-18 그림 글자로 폴더 찾기',()=>{
  test.use({hasTouch:false});
  const PIC=u(4),OCR1=u(4001),OCR2=u(4002),UNREAD=u(4003),NAMED=u(4004);
  const folders=[...FOLDERS,libFolder(PIC,null,{name:'가상 행사 사진',sort_order:3072})];
  const png=(id,title)=>libDoc(id,null,{title,file_name:'paste.png',mime_type:'image/png'});
  const docs=[png(OCR1,'붙여넣은 그림 11-13 03:38'),png(OCR2,'붙여넣은 그림 11-13 03:39'),png(UNREAD,'IMG_20261113_0340'),png(NAMED,'가상 현수막 시안')];
  const items=docs.map(d=>({document_id:d.id,folder_id:RECV}));
  const TEXT={[OCR1]:{extracted_text:'가상 회의 안내\n일시 …',extraction_status:'ready'},[OCR2]:{extracted_text:'가상 집회 현수막 문구',extraction_status:'ready'},[UNREAD]:{extracted_text:null,extraction_status:null}};
  test('글자에 폴더 이름 → 그 폴더, 글자만 있으면 AI, 모르면 사진 폴더(체크 꺼짐), 안 읽은 그림은 글자 읽기 요청',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders,items,docs,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    const textReads=[],textAsks=[];s.aiBodies=[];
    await page.route('**/rest/v1/app_documents*',route=>{
      const url=new URL(route.request().url());
      if(route.request().method()!=='GET'||!/extracted_text/.test(url.searchParams.get('select')||''))return route.fallback();
      const ids=String(url.searchParams.get('id')||'').replace(/^in\.\(|\)$/g,'').split(',');textReads.push(ids);
      return route.fulfill({json:ids.filter(id=>TEXT[id]).map(id=>({id,file_name:'paste.png',mime_type:'image/png',...TEXT[id]}))});
    });
    await page.route('**/functions/v1/document-actions',route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,body:''});textAsks.push(route.request().postDataJSON());return route.fulfill({json:{ok:true,status:'ready'}})});
    await page.route('**/functions/v1/ai-assist',route=>{
      const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,body:''});
      s.aiBodies.push(req.postDataJSON());return route.fulfill({json:{ok:true,kind:'library_sort',items:[]}});
    });
    await enterReceive(page);
    await page.locator('#libraryPath [data-lu-sort]').click();
    await expect(modal(page).locator('.lu-sort-wait')).toHaveCount(0);
    // 글자 읽기는 기본 이름 그림 3장만(이름이 있는 그림은 이름으로 판단).
    expect(textReads.flat().sort()).toEqual([OCR1,OCR2,UNREAD].sort());
    // ① 그림 글자에 폴더 이름 '가상 회의' → 그 폴더(체크 켜짐).
    await expect(row(page,OCR1).locator('.lu-sort-pick')).toContainText('가상 교섭 › 가상 회의');
    await expect(row(page,OCR1).locator('.lu-sort-why')).toHaveText("그림 글자: 제목에 폴더 이름 '가상 회의' 포함");
    await expect(row(page,OCR1).locator('.lu-sort-check')).toBeChecked();
    // ② 글자는 있으나 규칙이 못 찾은 그림·이름 있는 그림은 AI에(서버가 그 글자를 재료로 읽음). 안 읽은 기본 이름 그림은 보내지 않음.
    expect(s.aiBodies.flatMap(b=>b.document_ids).sort()).toEqual([OCR2,NAMED].sort());
    // ③ AI도 못 고르면 이름에 '사진'이 든 기존 폴더로(체크 꺼짐).
    for(const id of [OCR2,NAMED]){await expect(row(page,id).locator('.lu-sort-pick')).toContainText('가상 행사 사진');await expect(row(page,id).locator('.lu-sort-why')).toHaveText('AI도 맞는 폴더를 찾지 못해 그림끼리 모아요');await expect(row(page,id).locator('.lu-sort-check')).not.toBeChecked()}
    await expect(row(page,UNREAD).locator('.lu-sort-pick')).toContainText('가상 행사 사진');
    await expect(row(page,UNREAD).locator('.lu-sort-why')).toHaveText('그림 글자를 읽기 시작했어요 — 지금은 그림끼리 모아요(다시 열면 글자로 찾아요)');
    await expect.poll(()=>textAsks.length).toBe(1);
    expect(textAsks[0]).toEqual({action:'document-text',document_id:UNREAD});
    await expect(modal(page).locator('[data-sort-apply]')).toHaveText('선택한 1개 옮기기');
    // 체크를 켜고 옮기면 사진 폴더로 옮긴다(새 폴더 없음).
    await row(page,UNREAD).locator('.lu-sort-check').check();
    await modal(page).locator('[data-sort-apply]').click();
    await expect(modal(page)).toBeHidden();
    expect(folderOf(s,OCR1)).toBe(HOE);
    expect(folderOf(s,UNREAD)).toBe(PIC);
    expect(folderOf(s,OCR2)).toBe(RECV);
    expect(s.writes.filter(w=>w.table==='folders'&&w.method==='POST')).toEqual([]);
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
    // S61-46·S69-62: 놓을 자리 고르기는 폴더를 만드는 곳이 아니라 [새 폴더]·[새 폴더 제안]을 그리지 않는다. 맨 위 줄 '자료실' = 맨 위.
    await expect(folderSheet(page)).toBeVisible();
    await expect(folderSheet(page).locator('[data-fx-dest-mkdir]')).toHaveCount(0);
    await expect(folderSheet(page).locator('[data-fd-extra]')).toHaveCount(0);
    await press(page,folderSheet(page).locator('[data-fx-dest-pick="__root__"]'),412);
    await press(page,sheetGo(page),412);
    await expect(folderSheet(page)).toHaveCount(0);
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

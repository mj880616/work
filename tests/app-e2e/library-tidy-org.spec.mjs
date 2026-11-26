import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc,libFolder,press} from './helpers/library-folder-server.mjs';
// S69-12(사용자 11/24 08:09 '본부 집행위가 아닌 다른 단체 회의 자료를 집행위 폴더로 옮겨 버림'):
// [정돈 제안]이 종류 낱말 하나('회의자료')로 묶지 않고 단체(제목 앞 임자)별로 나누는지, 섞여 든 다른 단체 자료를 단체별 후보로 보여 주는지,
// [옮기기]가 옮기기 전 자리를 서버 기록에 남겨 창을 닫은 뒤에도 [지난 정돈 되돌리기]로 원래 자리에 돌아가는지 본다. 가짜 서버·지어낸 이름만.
const u=n=>`5f200000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const TEAM=u(1),MEET=u(2),EXEC=u(3),COUNCIL=u(4),RECV=u(5);
const FOLDERS=[libFolder(TEAM,null,{name:'가상팀',sort_order:1024}),libFolder(MEET,null,{name:'회의',parent_id:TEAM,sort_order:1024}),
  libFolder(EXEC,null,{name:'집행위',parent_id:MEET,sort_order:1024}),libFolder(COUNCIL,null,{name:'가상협의회',parent_id:MEET,sort_order:2048}),
  libFolder(RECV,null,{name:'잡동사니',sort_order:2048})];
const HQ=[u(101),u(102),u(103),u(104)],CO=[u(201),u(202),u(203)],CO_HOME=[u(211),u(212)],ETC=[u(301),u(302)];
const DOCS=[
  ...['43차','41차','42차','44차'].map((n,i)=>libDoc(HQ[i],null,{title:`${n} 본부집행위원회 회의자료`,file_name:`${i}.hwp`})),
  libDoc(CO[0],null,{title:'가상협의회 8차대표자및9차집행위원회연석회의자료'}),libDoc(CO[1],null,{title:'가상협의회 6차대표자회의자료'}),libDoc(CO[2],null,{title:'가상협의회 3차집행위원회회의자료'}),
  libDoc(CO_HOME[0],null,{title:'가상협의회 5차대표자회의자료'}),libDoc(CO_HOME[1],null,{title:'가상협의회 2차집행위원회회의자료'}),
  libDoc(ETC[0],null,{title:'26-41차 가상집행국 회의자료'}),libDoc(ETC[1],null,{title:'민간가상노조 2026 3차 정기간담회 회의자료'})];
const ITEMS=[...HQ,...CO,...ETC].map(id=>({document_id:id,folder_id:EXEC})).concat(CO_HOME.map(id=>({document_id:id,folder_id:COUNCIL})));
const modal=page=>page.locator('#libraryTidyModal');
const group=(page,gid)=>modal(page).locator(`[data-tidy-group="${gid}"]`);
const folderOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;
async function openTeam(page){
  await page.locator(`#libraryFolderNav [data-lu-nav="${TEAM}"]`).click({button:'right'});
  await page.locator('#luFolderMenu [data-lu-folder-action="tidy"]').click();
  await expect(modal(page)).toBeVisible();
}

test.describe('PC 1280',()=>{
  test.use({hasTouch:false});
  test('단체별 묶음 → 같은 단체 폴더로 옮기기 → 창 닫은 뒤 [지난 정돈 되돌리기]로 원래 자리',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await openTeam(page);
    await expect(modal(page).locator('#libraryTidySub')).toHaveText('가상팀 안 · 흩어진 같은 자료 1묶음 · 다른 이름이 섞인 자료 2묶음(5개)을 찾았어요. 묶음마다 선택하세요.');
    // 다른 단체 회의자료 3개는 집행위가 아니라 같은 단체 자료가 모인 '가상협의회' 폴더로.
    const co=group(page,'g:가상협의회 회의자료');
    await expect(co.locator('.lu-tidy-head b')).toHaveText('가상협의회 회의자료');
    await expect(co.locator('[data-tidy-pick]')).toContainText('가상협의회');
    await expect(co.locator('[data-tidy-row]')).toHaveCount(3);
    // 한 개씩 섞여 든 다른 단체 자료는 단체별 후보(새 폴더, 기본 '그대로').
    for(const word of ['가상집행국','민간가상노조']){
      const g=group(page,`s:${EXEC}:${word}`);
      await expect(g.locator('.lu-tidy-mix')).toHaveText('섞여 있음');
      await expect(g.locator('[data-tidy-mode="keep"]')).toHaveAttribute('aria-pressed','true');
    }
    // 본부 집행위 자료는 어느 묶음에도 없다.
    for(const id of HQ)await expect(modal(page).locator(`[data-tidy-row="${id}"]`)).toHaveCount(0);
    // 옮기기 전에는 기록 줄이 없다(창을 열기만 하면 아무것도 쓰지 않음).
    await expect(modal(page).locator('.lu-tidy-past')).toHaveCount(0);
    expect(s.writes.filter(w=>w.method!=='GET')).toEqual([]);expect(s.moveLogWrites).toEqual([]);
    await expect(modal(page).locator('[data-tidy-apply]')).toHaveText('선택한 3개 옮기기');
    await modal(page).locator('[data-tidy-apply]').click();
    await expect(modal(page)).toBeHidden();
    for(const id of CO)expect(folderOf(s,id)).toBe(COUNCIL);
    for(const id of [...HQ,...ETC])expect(folderOf(s,id)).toBe(EXEC);
    // 옮기기 전 자리가 서버 기록에 남는다(번호만).
    // (기록은 창을 닫은 뒤 적는다 — 적힐 때까지 기다린다. 바쁜 실행에서 바로 보면 아직 비어 있을 수 있음, S69-16에서 발견)
    await expect.poll(()=>s.moveLog.map(r=>[r.kind,r.document_id,r.from_folder_id,r.to_folder_id]).sort()).toEqual(CO.map(id=>['tidy',id,EXEC,COUNCIL]).sort());
    expect(new Set(s.moveLog.map(r=>r.batch_id)).size).toBe(1);
    expect(Object.keys(s.moveLog[0]).sort()).toEqual(['batch_id','created_at','document_id','from_folder_id','id','kind','to_folder_id','workspace_id']);
    // 창을 닫은 뒤(그 자리 되돌리기 없이) 다시 열면 [지난 정돈 되돌리기].
    await page.locator('#libraryTopMenuBtn').click();
    await page.locator('#luTopMenu [data-lu-top="tidy"]').click();
    await expect(modal(page)).toBeVisible();
    const past=modal(page).locator('.lu-tidy-past');
    await expect(past.locator('summary')).toContainText('지난 정돈 되돌리기');
    await past.locator('summary').click();
    await expect(past.locator('.lu-tidy-past-row')).toHaveCount(1);
    await expect(past.locator('.lu-tidy-past-row span')).toContainText('정돈 제안 3개');
    // 그 사이 하나는 다른 곳으로 옮겼다 — 그것은 그대로 둔다.
    s.items.find(x=>x.document_id===CO[2]).folder_id=RECV;
    await past.locator('[data-tidy-undo]').click();
    await expect(modal(page)).toBeHidden();
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('되돌렸어요 · 2개를 옮기기 전 자리로 · 1개는 그 사이 옮겨졌거나 원래 폴더가 없어 그대로 두었어요');
    expect(folderOf(s,CO[0])).toBe(EXEC);expect(folderOf(s,CO[1])).toBe(EXEC);expect(folderOf(s,CO[2])).toBe(RECV);
    for(const id of CO_HOME)expect(folderOf(s,id)).toBe(COUNCIL);
    expect(s.moveLog).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('그 자리 되돌리기도 기록을 지운다',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await openTeam(page);
    await modal(page).locator('[data-tidy-apply]').click();
    await expect(modal(page)).toBeHidden();
    await expect.poll(()=>s.moveLog.length).toBe(3);
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('되돌렸어요 · 3개를 원래 자리로');
    for(const id of CO)expect(folderOf(s,id)).toBe(EXEC);
    expect(s.moveLog).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('폰 412',()=>{
  test.use({hasTouch:true,isMobile:true});
  test('기록 표가 아직 없어도 옮기기는 되고, [지난 정돈 되돌리기]는 보이지 않음',async({page})=>{
    const {s,errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{receiveFolder:RECV,moveLogMissing:true}});
    await press(page,page.locator('#libraryTopMenuBtn'),412);
    await press(page,page.locator('#luTopMenu [data-lu-top="tidy"]'),412);
    await expect(modal(page)).toBeVisible();
    // 자료실 전체 정돈: 흩어진 '가상협의회 회의자료'만(섞인 묶음은 폴더 안 정돈에서만).
    await expect(group(page,'g:가상협의회 회의자료')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await press(page,modal(page).locator('[data-tidy-apply]'),412);
    await expect(modal(page)).toBeHidden();
    for(const id of CO)expect(folderOf(s,id)).toBe(COUNCIL);
    await press(page,page.locator('#libraryTopMenuBtn'),412);
    await press(page,page.locator('#luTopMenu [data-lu-top="tidy"]'),412);
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('#libraryTidySub')).toContainText('찾지 못했어요');
    await expect(modal(page).locator('.lu-tidy-past')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

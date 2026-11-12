import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {bootLibrary,libDoc,libFolder,press} from './helpers/library-folder-server.mjs';
// S61-13 LIB-정돈제안(시안 docs/design/mockups/lib-tidy-suggest.html, 명진 11/13 04:31·04:36):
// 자료실 맨 위 ⋯·빈 자리 우클릭·폴더 메뉴 [정돈 제안] → 창이 바로 뜨고 묶음은 뒤에서 채움 → 같은 종류인데 폴더가 갈라진 자료를 묶음으로
// ('지금: … 3 · … 1') → 묶음마다 [옮기기|그대로]·체크·옮길 폴더 ▾ → [옮기기]를 눌러야 옮김 → 되돌리기 한 번으로 전부 원래 자리, 새 빈 폴더도 지움.
// '회의 녹음' 폴더의 녹음은 묶음에서 빠진다. 가짜 서버·지어낸 이름만. TIDY_SHOTS에 폴더를 주면 PR 사진을 남긴다.
const u=n=>`5f100000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const IM=u(1),PR=u(2),RECV=u(3),REC=u(4);
const H1=u(101),H2=u(102),H3=u(103),H4=u(104),H5=u(105),H6=u(106),H7=u(107),M1=u(201),M2=u(202),X1=u(301);
const FOLDERS=[libFolder(IM,null,{name:'가상 임금협약',sort_order:1024}),libFolder(PR,null,{name:'가상 성명·보도자료',sort_order:2048}),libFolder(RECV,null,{name:'잡동사니',sort_order:3072}),libFolder(REC,null,{name:'회의 녹음',sort_order:4096})];
const DOCS=[libDoc(H1,null,{title:'가상 철도 합의서',file_name:'a.hwp'}),libDoc(H2,null,{title:'가상 버스 합의서'}),libDoc(H3,null,{title:'가상 택시 합의서'}),
  libDoc(H4,null,{title:'가상 해운 잠정합의서',file_name:'b.hwp'}),libDoc(H5,null,{title:'가상 합의서 3쪽',file_name:'c.png'}),libDoc(H6,null,{title:'가상 합의서 이행 촉구 보도자료'}),
  libDoc(H7,null,{title:'가상 교섭 합의서 녹음',file_name:'rec.m4a',mime_type:'audio/mp4'}),
  libDoc(M1,null,{title:'가상 교육 명단'}),libDoc(M2,null,{title:'가상 교육 명단 2차'}),libDoc(X1,null,{title:'메모'})];
const ITEMS=[{document_id:H1,folder_id:IM},{document_id:H2,folder_id:IM},{document_id:H3,folder_id:IM},{document_id:H4,folder_id:PR},{document_id:H5,folder_id:RECV},
  {document_id:H6,folder_id:PR},{document_id:H7,folder_id:REC},{document_id:M1,folder_id:RECV}];
const SHOTS=process.env.TIDY_SHOTS||'';
const shot=async(page,name,info)=>{if(SHOTS){mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}`})}await page.screenshot({path:info.outputPath(name)})};
const modal=page=>page.locator('#libraryTidyModal');
const group=(page,word)=>modal(page).locator(`[data-tidy-group="g:${word}"]`);
const folderOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;
async function openFromTop(page,width){
  await press(page,page.locator('#libraryTopMenuBtn'),width);
  await press(page,page.locator('#luTopMenu [data-lu-top="tidy"]'),width);
  await expect(modal(page)).toBeVisible();
}
async function checkDialog(page){
  await expect(modal(page).locator('#libraryTidySub')).toHaveText('같은 종류인데 폴더가 갈라진 자료 2묶음(4개)을 찾았어요. 묶음마다 고르세요.');
  const h=group(page,'합의서');
  await expect(h.locator('.lu-tidy-head b')).toHaveText('합의서');
  await expect(h.locator('.lu-tidy-head small')).toHaveText('5개');
  await expect(h.locator('.lu-tidy-at')).toHaveText('지금: 가상 임금협약 3 · 가상 성명·보도자료 1 · 잡동사니 1');
  await expect(h.locator('[data-tidy-pick]')).toContainText('가상 임금협약');
  await expect(h.locator('[data-tidy-row]')).toHaveCount(2);
  await expect(h.locator(`[data-tidy-row="${H4}"] .lu-sort-why`)).toHaveText('지금 가상 성명·보도자료에 있음');
  await expect(h.locator('.lu-tidy-stay')).toHaveText('이미 그 폴더에 있는 3개는 그대로');
  const m=group(page,'명단');
  await expect(m.locator('.lu-tidy-at')).toHaveText('지금: 잡동사니 1 · 폴더 밖 1');
  await expect(m.locator('.lu-sort-nf')).toHaveText('새 폴더');
  await expect(m.locator('[data-tidy-gname]')).toHaveValue('명단');
  // 녹음(회의 녹음 폴더·소리 파일)은 어느 묶음에도 없다.
  await expect(modal(page).locator(`[data-tidy-row="${H7}"]`)).toHaveCount(0);
  await expect(modal(page).locator('[data-tidy-apply]')).toHaveText('고른 4개 옮기기');
}

test.describe('PC 1280',()=>{
  test.use({hasTouch:false});
  test('맨 위 ⋯ [정돈 제안] → 묶음 → 그대로·옮길 폴더 바꾸기 → 옮기기 → 되돌리기 전부 원래대로',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await openFromTop(page,1280);
    await checkDialog(page);
    await shot(page,'pc-1280-dialog.png',info);
    expect(s.writes.filter(w=>w.method!=='GET')).toEqual([]);
    // 묶음 '그대로' → 그 묶음은 옮기지 않음.
    await group(page,'명단').locator('[data-tidy-mode="keep"]').click();
    await expect(group(page,'명단').locator('[data-tidy-mode="keep"]')).toHaveAttribute('aria-pressed','true');
    await expect(modal(page).locator('[data-tidy-apply]')).toHaveText('고른 2개 옮기기');
    await group(page,'명단').locator('[data-tidy-mode="move"]').click();
    // 체크 하나 빼기.
    await group(page,'합의서').locator(`[data-tidy-row="${H5}"] [data-tidy-check]`).uncheck();
    await expect(modal(page).locator('[data-tidy-apply]')).toHaveText('고른 3개 옮기기');
    await group(page,'합의서').locator(`[data-tidy-row="${H5}"] [data-tidy-check]`).check();
    // 옮길 폴더 바꾸기: 성명·보도자료로 바꾸면 그 안 1개는 그대로, 임금협약 3개가 줄로. 다시 임금협약으로.
    await group(page,'합의서').locator('[data-tidy-pick]').click();
    const picker=page.locator('#luTidyPicker');
    await expect(picker).toBeVisible();
    await picker.locator(`[data-lu-move-folder="${PR}"]`).last().click();
    await expect(group(page,'합의서').locator('[data-tidy-row]')).toHaveCount(4);
    await expect(group(page,'합의서').locator('.lu-tidy-stay')).toHaveText('이미 그 폴더에 있는 1개는 그대로');
    await group(page,'합의서').locator('[data-tidy-pick]').click();
    await picker.locator(`[data-lu-move-folder="${IM}"]`).last().click();
    await expect(group(page,'합의서').locator('[data-tidy-row]')).toHaveCount(2);
    await modal(page).locator('[data-tidy-apply]').click();
    await expect(modal(page)).toBeHidden();
    const made=s.folders.find(f=>f.name==='명단');
    expect(made).toMatchObject({parent_id:null,project_id:null,workspace_id:'workspace-1'});
    expect(folderOf(s,H4)).toBe(IM);expect(folderOf(s,H5)).toBe(IM);expect(folderOf(s,M1)).toBe(made.id);expect(folderOf(s,M2)).toBe(made.id);
    expect(folderOf(s,H6)).toBe(PR);expect(folderOf(s,H7)).toBe(REC);expect(folderOf(s,X1)).toBe(undefined);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('4개를 폴더로 옮겼어요 · 새 폴더 1개');
    await shot(page,'pc-1280-done.png',info);
    // 되돌리기 한 번: 원래 자리로(폴더 밖이던 것은 연결을 지움), 이번에 만든 빈 폴더는 지움(휴지통에도 남지 않음).
    await page.locator('#libraryFolderStatusLine .lu-undo').click();
    await expect.poll(()=>s.folders.some(f=>f.id===made.id)).toBe(false);
    expect(folderOf(s,H4)).toBe(PR);expect(folderOf(s,H5)).toBe(RECV);expect(folderOf(s,M1)).toBe(RECV);expect(folderOf(s,M2)).toBe(undefined);
    expect(s.trash).toEqual([]);
    expect(s.rpc.filter(r=>r.fn==='app_trash_purge').map(r=>r.id)).toEqual([made.id]);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('되돌렸어요 · 4개를 원래 자리로');
    expect(errors).toEqual([]);
  });

  test('폴더 메뉴·빈 자리 우클릭에서 열면 그 폴더 안만',async({page})=>{
    const {s,errors}=await bootLibrary(page,1280,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    await page.locator(`#libraryFolderNav [data-lu-nav="${IM}"]`).click({button:'right'});
    await page.locator('#luFolderMenu [data-lu-folder-action="tidy"]').click();
    await expect(modal(page)).toBeVisible();
    await expect(modal(page).locator('#libraryTidySub')).toHaveText('가상 임금협약 안 · 흩어진 같은 종류 자료를 찾지 못했어요.');
    await expect(modal(page).locator('[data-tidy-apply]')).toBeDisabled();
    await modal(page).locator('[data-tidy-close]').first().click();
    await expect(modal(page)).toBeHidden();
    expect(s.writes.filter(w=>w.method!=='GET')).toEqual([]);
    expect(errors).toEqual([]);
  });
});

test.describe('폰 412',()=>{
  test.use({hasTouch:true,isMobile:true});
  test('맨 위 ⋯ [정돈 제안] → 창(가로로 넘치지 않음) → 옮기기 → 되돌리기',async({page},info)=>{
    const {s,errors}=await bootLibrary(page,412,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{receiveFolder:RECV}});
    await openFromTop(page,412);
    await checkDialog(page);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const card=await modal(page).locator('.lu-sort-card').boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);expect(card.x+card.width).toBeLessThanOrEqual(413);
    await shot(page,'phone-412-dialog.png',info);
    await press(page,modal(page).locator('[data-tidy-apply]'),412);
    await expect(modal(page)).toBeHidden();
    expect(folderOf(s,H4)).toBe(IM);expect(folderOf(s,H5)).toBe(IM);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('4개를 폴더로 옮겼어요 · 새 폴더 1개');
    await shot(page,'phone-412-done.png',info);
    await press(page,page.locator('#libraryFolderStatusLine .lu-undo'),412);
    await expect(page.locator('#libraryFolderStatusLine')).toContainText('되돌렸어요 · 4개를 원래 자리로');
    expect(folderOf(s,H4)).toBe(PR);
    expect(folderOf(s,H5)).toBe(RECV);expect(folderOf(s,M2)).toBe(undefined);
    expect(s.folders.some(f=>f.name==='명단')).toBe(false);
    expect(errors).toEqual([]);
  });
});

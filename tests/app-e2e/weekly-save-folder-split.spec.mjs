import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc,menuButton,press} from './helpers/library-folder-server.mjs';
// S70-11 WEEKLY-저장폴더나누기(명진 11/25 "주간보고 안에 … 주간보고, 팀 보고 취합 폴더 만들어놨어 관련 기능에서 파일 만들 때 알아서 저기 안에 넣어요"):
// 저장 폴더가 종류별 둘(내 주간 보고 = weekly_folder, 팀 보고 취합 = weekly_team_folder). 정해 둔 폴더 아래 하위 폴더가 생기고 지난 자료를 옮겨 두었으면
// 다음 저장 때 한 번 다시 묻고, 팀 보고 취합은 지난 팀 자료가 없으면 이름에 '취합'이 든 곁 폴더를 권한다. 가짜 서버만 쓴다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('team',null,{name:'가상 팀',sort_order:1024}),
  libFolder('wk',null,{name:'가상 보고',parent_id:'team',sort_order:1024}),
  libFolder('mine',null,{name:'가상 내 보고',parent_id:'wk',sort_order:1024}),
  libFolder('teamf',null,{name:'가상 팀 보고 취합',parent_id:'wk',sort_order:2048}),
  libFolder('other',null,{name:'가상 다른',sort_order:2048}),
];
const P='주간보고›개인 확정본',C='주간보고›팀 확정본';
const at=d=>`2026-11-${String(d).padStart(2,'0')}T00:00:00Z`;
const DOCS=[
  libDoc('p-1',null,{category:P,created_at:at(10)}),libDoc('p-2',null,{category:P,created_at:at(17)}),
  libDoc('p-new',null,{category:P,created_at:at(24)}),libDoc('p-next',null,{category:P,created_at:at(25)}),
  libDoc('c-new',null,{category:C,created_at:at(24)}),libDoc('c-next',null,{category:C,created_at:at(25)}),
];
// 명진처럼 지난 내 주간 보고 파일을 이미 하위 폴더로 옮겨 둔 상태.
const ITEMS=[{document_id:'p-1',folder_id:'mine'},{document_id:'p-2',folder_id:'mine'}];
const boot=(page,width,init)=>bootLibrary(page,width,{folders:FOLDERS,items:ITEMS,docs:DOCS,group:'폴더',init:{viewPrefs:null,...init}});
const file=(page,docId,kind='personal')=>page.evaluate(([id,k])=>import('/app/weekly-save-folder.js').then(m=>m.fileWeeklyReport({docId:id,kind:k})).then(r=>r.status),[docId,kind]);
const itemOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;

for(const width of [1280,390]){
  test.describe(`${width}`,()=>{
    test.use({hasTouch:false});
    test('하위 폴더 두 개: 내 보고 [확정] → 다시 묻기 [예] → 그 하위 폴더, 팀 취합 저장 → 다른 하위 폴더, 다시 저장하면 묻지 않음',async({page})=>{
      const {s,errors}=await boot(page,width,{weeklyFolder:'wk',weeklyTeamFolder:null});
      const notice=page.locator('#kptuNotice'),text=notice.locator('.kptu-notice-text');
      // 내 주간 보고: 정해 둔 폴더(가상 보고) 아래 하위 폴더가 생겼고 지난 자료가 그쪽에 있다 → 한 번 다시 묻는다(이번 자료는 우선 정해 둔 폴더에).
      expect(await file(page,'p-new')).toBe('asked');
      await expect(text).toHaveText('앞으로 내 주간 보고는 ‘가상 팀 › 가상 보고 › 가상 내 보고’ 폴더에 넣을까요?');
      await expect(notice.getByRole('button',{name:'다른 폴더'})).toBeVisible();
      expect(itemOf(s,'p-new')).toBe('wk');
      await notice.getByRole('button',{name:'예',exact:true}).click();
      await expect.poll(()=>s.weeklyFolder).toBe('mine');
      await expect.poll(()=>itemOf(s,'p-new')).toBe('mine');
      expect(s.items.filter(x=>x.document_id==='p-new')).toHaveLength(1);
      await expect(text).toHaveText('앞으로 내 주간 보고는 ‘가상 팀 › 가상 보고 › 가상 내 보고’ 폴더에 넣어요.');
      // 팀 보고 취합: 칸이 비었고 지난 팀 자료가 폴더에 없다 → 내 주간 보고 폴더 곁의 '취합' 폴더를 권한다.
      expect(await file(page,'c-new','confirmed')).toBe('asked');
      await expect(text).toHaveText('앞으로 팀 보고 취합은 ‘가상 팀 › 가상 보고 › 가상 팀 보고 취합’ 폴더에 넣을까요?');
      expect(itemOf(s,'c-new')).toBeUndefined();
      await notice.getByRole('button',{name:'예',exact:true}).click();
      await expect.poll(()=>s.weeklyTeamFolder).toBe('teamf');
      await expect.poll(()=>itemOf(s,'c-new')).toBe('teamf');
      expect(s.weeklyFolder).toBe('mine'); // 팀 칸만 바뀐다
      // 다시 저장하면 묻지 않고 각자 폴더에.
      expect(await file(page,'p-next')).toBe('filed');
      expect(itemOf(s,'p-next')).toBe('mine');
      await expect(text).toHaveText('내 주간 보고를 ‘가상 팀 › 가상 보고 › 가상 내 보고’ 폴더에 넣었어요.');
      expect(await file(page,'c-next','confirmed')).toBe('filed');
      expect(itemOf(s,'c-next')).toBe('teamf');
      await expect(text).toHaveText('팀 보고 취합을 ‘가상 팀 › 가상 보고 › 가상 팀 보고 취합’ 폴더에 넣었어요.');
      expect(s.weeklyPatches).toEqual(['mine']);
      expect(s.weeklyTeamPatches).toEqual(['teamf']);
      await expect.poll(()=>(s.mirrors||[]).length).toBeGreaterThan(0);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('PC 1280',()=>{
  test.use({hasTouch:false});
  test('다시 묻기에 답하지 않으면 이번 자료는 원래 폴더 그대로, 다음 저장은 묻지 않는다(한 번만 묻기)',async({page})=>{
    const {s,errors}=await boot(page,1280,{weeklyFolder:'wk',weeklyTeamFolder:null});
    expect(await file(page,'p-new')).toBe('asked');
    expect(itemOf(s,'p-new')).toBe('wk');
    // 답하지 않음 = 이번 자료는 원래 폴더 그대로. 바로 앞 자료가 원래 폴더라 다음 저장은 묻지 않는다.
    expect(await file(page,'p-next')).toBe('filed');
    expect(itemOf(s,'p-next')).toBe('wk');
    expect(s.weeklyPatches||[]).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('팀 칸이 아직 없는 서버면 지금처럼: 내 주간 보고는 한 폴더에 그대로(다시 묻지 않음), 팀 보고 취합은 아무것도 안 함',async({page})=>{
    const {s,errors}=await boot(page,1280,{weeklyFolder:'wk',weeklyTeamFolderMissing:true});
    expect(await file(page,'p-new')).toBe('filed');
    expect(itemOf(s,'p-new')).toBe('wk');
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('주간 보고 파일을 ‘가상 팀 › 가상 보고’ 폴더에 넣었어요.');
    expect(await file(page,'c-new','confirmed')).toBe('off');
    expect(itemOf(s,'c-new')).toBeUndefined();
    expect(s.weeklyTeamPatches).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test('자료실 [+ 자료 등록]에서 분류 팀 확정본을 골라 올리면 팀 보고 취합 폴더에, 분류를 안 고르면 그대로',async({page})=>{
    const cats=['기타','주간보고',P,C];
    const {s,errors}=await boot(page,1280,{weeklyFolder:'mine',weeklyTeamFolder:'teamf',documentCategories:cats,viewPrefs:{library_two:false}});
    const send=async(name,category)=>{
      await page.locator('#newDocumentBtn').click();
      await expect(page.locator('#documentModal')).toBeVisible();
      if(category)await page.locator('#docCategory').selectOption(category);
      await page.locator('#libraryFileInput').setInputFiles({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF synthetic')});
      await page.locator('#saveDocumentBtn').click();
      await expect(page.locator('#documentModal')).toBeHidden();
    };
    await send('팀.pdf',C);
    await expect.poll(()=>itemOf(s,'upload-1')).toBe('teamf');
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('팀 보고 취합을 ‘가상 팀 › 가상 보고 › 가상 팀 보고 취합’ 폴더에 넣었어요.');
    await send('그냥.pdf','');
    await expect.poll(()=>s.uploads.length).toBe(2);
    await page.waitForTimeout(300);
    expect(itemOf(s,'upload-2')).toBeUndefined();
    expect(s.weeklyPatches||[]).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('폴더 ⋯ 메뉴에서 두 저장 폴더를 보고 바꾼다(정해 둔 폴더와 그 곁에서만 줄이 보임)',async({page})=>{
    const {s,errors}=await boot(page,1280,{weeklyFolder:'other',weeklyTeamFolder:null,viewPrefs:{library_two:false}});
    await press(page,menuButton(page,'f:other'),1280);
    const menu=page.locator('#luFolderMenu');
    const mine=menu.locator('[data-lu-folder-action="weekly-personal"]'),team=menu.locator('[data-lu-folder-action="weekly-confirmed"]');
    await expect(mine).toHaveText('✓ 내 주간 보고 저장 폴더');
    await expect(mine).toHaveAttribute('aria-pressed','true');
    await expect(team).toHaveText('팀 보고 취합 저장 폴더');
    await press(page,team,1280);
    await expect.poll(()=>s.weeklyTeamFolder).toBe('other');
    expect(s.weeklyTeamPatches).toEqual(['other']);
    await press(page,menuButton(page,'f:other'),1280);
    await expect(menu.locator('[data-lu-folder-action="weekly-confirmed"]')).toHaveAttribute('aria-pressed','true');
    // 정해 둔 폴더와 상관없는 폴더(맨 위 '가상 팀')에는 줄이 없다.
    await page.keyboard.press('Escape');
    await press(page,menuButton(page,'f:team'),1280);
    await expect(menu.locator('[data-lu-folder-action="rename"]')).toBeVisible();
    await expect(menu.locator('[data-lu-folder-action^="weekly-"]')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

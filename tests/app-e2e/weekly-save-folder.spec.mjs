import {test,expect} from '@playwright/test';
import {bootLibrary,libFolder,libDoc} from './helpers/library-folder-server.mjs';
// S69-67 WEEKLY-저장폴더(명진 11/24 "주간보고에서 한글파일 만들기를 하든, 내가 수정해서 올리기를 하든 그 파일은 … 주간보고 폴더로"):
// [주간 보고] [확정]·② [올리기]가 자료실에 저장한 자료(journal-hwpx.js → weekly-save-folder.js fileWeeklyReport)는 사람마다 고른 저장 폴더에 하나 들어간다(복사 아님).
// 처음 한 번 묻고(지난 주간보고가 모인 폴더를 권함), 고르면 서버(내 프로필 weekly_folder)에 저장. 칸이 없는 서버면 지금처럼(아무것도 안 함).
// 폴더에 넣은 뒤 드라이브는 기존 맞추기(drive-mirror auto)만 부탁한다. 가짜 서버만 쓴다. 이름은 지어낸 것.
const FOLDERS=[
  libFolder('team',null,{name:'가상 팀',sort_order:1024}),
  libFolder('wk',null,{name:'가상 보고',parent_id:'team',sort_order:1024}),
  libFolder('other',null,{name:'가상 다른',sort_order:2048}),
];
const P='주간보고›개인 확정본';
const DOCS=[libDoc('w-1',null,{category:P}),libDoc('w-2',null,{category:P}),libDoc('w-new',null,{category:P}),libDoc('n-1',null)];
const ITEMS=[{document_id:'w-1',folder_id:'wk'},{document_id:'w-2',folder_id:'wk'},{document_id:'n-1',folder_id:'other'}];
const boot=(page,width,init,items=ITEMS)=>bootLibrary(page,width,{folders:FOLDERS,items,docs:DOCS,group:'폴더',init:{viewPrefs:null,...init}});
const file=(page,docId)=>page.evaluate(id=>import('/app/weekly-save-folder.js').then(m=>m.fileWeeklyReport({docId:id})).then(r=>r.status),docId);
const itemOf=(s,id)=>s.items.find(x=>x.document_id===id)?.folder_id;

for(const width of [1440,390]){
  test.describe(`${width}`,()=>{
    test.use({hasTouch:false});
    test('처음 한 번: 지난 주간보고가 모인 폴더를 권하고 [예] → 저장, 이번 자료도 그 폴더에, 드라이브 맞추기 부탁',async({page})=>{
      const {s,errors}=await boot(page,width,{weeklyFolder:null});
      expect(await file(page,'w-new')).toBe('asked');
      const notice=page.locator('#kptuNotice');
      await expect(notice.locator('.kptu-notice-text')).toHaveText('주간 보고 파일을 ‘가상 팀 › 가상 보고’ 폴더에 모을까요?');
      await expect(notice.getByRole('button',{name:'다른 폴더'})).toBeVisible();
      expect(itemOf(s,'w-new')).toBeUndefined(); // 답하기 전에는 지금처럼(폴더 밖)
      await notice.getByRole('button',{name:'예',exact:true}).click();
      await expect.poll(()=>s.weeklyFolder).toBe('wk');
      await expect.poll(()=>itemOf(s,'w-new')).toBe('wk');
      expect(s.items.filter(x=>x.document_id==='w-new')).toHaveLength(1);
      await expect(notice.locator('.kptu-notice-text')).toHaveText('앞으로 주간 보고 파일은 ‘가상 팀 › 가상 보고’ 폴더에 넣어요.');
      await expect.poll(()=>s.mirrors||[]).toContain('auto');
      expect(s.weeklyPatches).toEqual(['wk']);
      expect(errors).toEqual([]);
    });
  });
}

test.describe('PC 1440',()=>{
  test.use({hasTouch:false});
  test('정해 둔 폴더가 있으면 묻지 않고 넣는다 — 받는 폴더에 먼저 들어간 자료도 옮기고, 이미 그 폴더면 쓰지 않는다',async({page})=>{
    const {s,errors}=await boot(page,1440,{weeklyFolder:'wk'},[...ITEMS,{document_id:'w-new',folder_id:'other'}]);
    expect(await file(page,'w-new')).toBe('filed');
    expect(itemOf(s,'w-new')).toBe('wk');
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('주간 보고 파일을 ‘가상 팀 › 가상 보고’ 폴더에 넣었어요.');
    await expect.poll(()=>(s.mirrors||[]).length).toBe(1);
    const writes=s.writes.filter(w=>w.table==='items').length, mirrors=s.mirrors.length;
    // 같은 주 다시 확정·② [올리기](같은 자료의 파일만 바뀜): 연결은 그대로, 새 드라이브 파일을 맞추기만 부탁한다.
    expect(await file(page,'w-new')).toBe('same');
    expect(s.writes.filter(w=>w.table==='items').length).toBe(writes);
    await expect.poll(()=>s.mirrors.length).toBe(mirrors+1);
    expect(s.weeklyPatches||[]).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('정해 둔 폴더가 휴지통에 갔으면 다시 묻는다',async({page})=>{
    const {s}=await boot(page,1440,{weeklyFolder:'gone'});
    expect(await file(page,'w-new')).toBe('asked');
    await expect(page.locator('#kptuNotice .kptu-notice-text')).toHaveText('주간 보고 파일을 ‘가상 팀 › 가상 보고’ 폴더에 모을까요?');
    expect(itemOf(s,'w-new')).toBeUndefined();
  });

  test('서버 칸이 아직 없으면 지금처럼: 묻지도 넣지도 않는다',async({page})=>{
    const {s,errors}=await boot(page,1440,{weeklyFolderMissing:true});
    expect(await file(page,'w-new')).toBe('off');
    expect(itemOf(s,'w-new')).toBeUndefined();
    expect(s.weeklyPatches).toBeUndefined();
    expect(s.mirrors).toBeUndefined();
    await expect(page.locator('#kptuNotice')).toBeHidden();
    expect(errors).toEqual([]);
  });
});

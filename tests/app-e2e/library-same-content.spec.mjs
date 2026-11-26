import {test,expect} from '@playwright/test';
import {bootLibrary,libDoc,libFolder,press,SB} from './helpers/library-folder-server.mjs';
// S69-45 LIB-같은내용정리: 자료실 ⋯ [같은 내용 자료 정리] → 미리 보기(묶음·남길 것·휴지통 갈 것·건너뜀) → [정리하기]는 건너뜀이 아닌 묶음만 보냄 → 결과 '휴지통 N · 건너뜀 M'
//    → [되돌리기]는 서버가 준 되돌리기 묶음을 그대로 돌려보냄. 가짜 서버·지어낸 이름만.
const u=n=>`5f450000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RECV=u(1);
const GROUPS=[
  {key:'k1',keep:{id:u(11),title:'가상 교섭안',path:'가상 교섭'},drop:[{id:u(12),title:'가상 교섭안 사본',path:'잡동사니'},{id:u(13),title:'가상 교섭안(1)',path:'폴더 밖'}],skip:null},
  {key:'k2',keep:{id:u(21),title:'가상 회의 자료',path:'잡동사니'},drop:[{id:u(22),title:'가상 회의 자료 사본',path:'잡동사니'}],skip:'linked'},
];
const UNDO={folder:u(90),moves:[{d:u(12),f:RECV},{d:u(13),f:null}],links:[]};
async function mockServer(page,{after=null}={}){
  const calls=[];let applied=false;
  await page.route(`${SB}/functions/v1/library-files`,async route=>{
    const req=route.request();if(req.method()==='OPTIONS')return route.fulfill({status:204,body:''});
    const body=req.postDataJSON();calls.push(body);
    const ok=d=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d)});
    if(body.action==='same-content-scan')return ok(applied&&after?after:{ok:true,groups:GROUPS,totals:{groups:2,trash:2,skipped:1},more:false,partial:false});
    if(body.action==='same-content-apply'){applied=true;return ok({ok:true,trashed:2,skipped:0,in_trash:true,undo:UNDO})}
    if(body.action==='same-content-undo'){applied=false;return ok({ok:true,restored:2,missed:0})}
    return route.fulfill({status:400,body:'{}'});
  });
  return calls;
}
for(const width of [1280,390]){
 test.describe(`${width}`,()=>{
  test.use({hasTouch:width<761});
  test(`${width}: 같은 내용 자료 정리 — 미리 보기 → 정리(건너뜀 빼고) → 결과 한 줄 → 되돌리기`,async({page})=>{
    const {errors}=await bootLibrary(page,width,{folders:[libFolder(RECV,null,{name:'잡동사니'})],items:[],docs:[libDoc(u(11),null,{title:'가상 교섭안'})],group:'폴더',init:{viewPrefs:{library_two:false},receiveFolder:RECV}});
    const calls=await mockServer(page,{after:{ok:true,groups:[GROUPS[1]],totals:{groups:1,trash:0,skipped:1},more:false,partial:false}});
    await press(page,page.locator('#libraryTopMenuBtn'),width);
    await press(page,page.locator('#luTopMenu [data-lu-top="same-content"]'),width);
    const m=page.locator('#librarySameModal');
    await expect(m).toBeVisible();
    await expect(m.locator('#librarySameSub')).toHaveText('같은 내용 묶음 2개 · 휴지통으로 2개 · 건너뜀 1묶음(기록 연결을 옮길 수 없음)');
    await expect(m.locator('[data-sc-group]')).toHaveCount(2);
    const g1=m.locator('[data-sc-group]').nth(0);
    await expect(g1.locator('.lu-di-row').nth(0)).toContainText('남김');
    await expect(g1.locator('.lu-di-row').nth(0)).toContainText('가상 교섭');
    await expect(g1.locator('.lu-di-row').nth(1)).toContainText('휴지통');
    await expect(m.locator('[data-sc-group]').nth(1).locator('.lu-di-count')).toHaveText('건너뜀');
    expect(calls.map(c=>c.action)).toEqual(['same-content-scan']); // 열기만 하면 바꾸지 않음
    await m.locator('[data-sc-apply]').click();
    await expect(m.locator('#librarySameStatus')).toHaveText('휴지통 2 · 건너뜀 1');
    expect(calls.filter(c=>c.action==='same-content-apply')).toEqual([{action:'same-content-apply',groups:[{keep:u(11),drop:[u(12),u(13)]}]}]);
    await expect(m.locator('[data-sc-undo]')).toBeVisible();
    await m.locator('[data-sc-undo]').click();
    await expect(m.locator('#librarySameStatus')).toHaveText('되돌렸어요 · 2개를 원래 폴더로');
    expect(calls.filter(c=>c.action==='same-content-undo')).toEqual([{action:'same-content-undo',undo:UNDO}]);
    await expect(m.locator('[data-sc-undo]')).toBeHidden();
    await m.locator('[data-sc-close]').first().click();
    await expect(m).toBeHidden();
    expect(errors).toEqual([]);
  });
 });
}

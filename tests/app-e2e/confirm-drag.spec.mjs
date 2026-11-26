import { appOrigin } from './helpers/test-origin.mjs';
// S70-12 UI-확인창끌기(2026-11-25 09:47 사용자 "이 휴지통으로 옮길까요 경고창도 좌클릭 드래그해서 이동가능하게"):
// PC(1280)에서 누른 자리 옆에 뜬 작은 확인창(.kptu-ask, app/small-notice.js askPanel)은 빈 곳(글·여백)을 마우스 왼쪽 단추로 잡고 끌어 옮긴다.
// 끌기는 공용 부품(app/anchored-popup.js dragByTitle) 하나 — 이 부품을 쓰는 모든 확인창이 같다. 화면 밖으로 나가지 않고, 끈 뒤에도 단추·Esc는 그대로,
// 단추 위에서 끌면 창이 움직이지 않는다. 옮긴 자리는 그 창이 닫힐 때까지만(다시 열면 누른 자리 옆). 폴더 이름은 지어낸 것.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {libraryNode,libraryNodeHead,libraryTopMenu} from './helpers/library-tree.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {chooseBasketKind} from './helpers/basket-kind.mjs';
import {askBox,dragAsk,askTextSpot} from './helpers/confirm-drag.mjs';

const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const eq=(url,k)=>String(url.searchParams.get(k)||'').replace(/^eq\./,'');
const doc=(id,project_id)=>({id,workspace_id:'workspace-1',project_id,title:'자료 '+id,file_name:id+'.pdf',category:'정책자료',tags:[],document_date:'2026-10-01',created_at:'2026-10-01T00:00:00Z'});

async function bootLibrary(page){
  await page.setViewportSize({width:1280,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=baseState();s.docs=[doc('a-1','top-a'),doc('a-2','top-a')];
  s.folders=[{id:'fa',project_id:'top-a',name:'가상 A',sort_order:1024},{id:'fb',project_id:'top-a',name:'가상 B',sort_order:2048}].map(f=>({workspace_id:'workspace-1',parent_id:null,created_at:'2026-10-01T00:00:00Z',...f}));
  s.items=[];s.trash=[];s.writes=[];
  await mockApp(page,s);
  await page.route(`${SB}/rest/v1/app_library_folders*`,route=>{
    const req=route.request(),url=new URL(req.url()),m=req.method();
    if(m==='GET')return route.fulfill({json:s.folders});
    s.writes.push({method:m,id:eq(url,'id')});
    const f=s.folders.find(x=>x.id===eq(url,'id'));
    if(m==='DELETE'){s.trash.push({root:f.id,folder:f});s.folders=s.folders.filter(x=>x!==f);return route.fulfill({status:204,body:''})}
    return route.fulfill({status:500,json:{}});
  });
  await page.route(`${SB}/rest/v1/rpc/app_trash_*`,route=>{
    const fn=new URL(route.request().url()).pathname.split('/').pop();
    if(fn==='app_trash_list')return route.fulfill({json:s.trash.map(t=>({kind:'library_folder',id:t.root,workspace_id:'workspace-1',name:t.folder.name,project_id:t.folder.project_id,project_name:'',parent_id:null,deleted_at:'2026-10-25T05:00:00Z',child_count:0,file_count:0,parent_in_trash:false}))});
    return route.fulfill({status:500,json:{}});
  });
  await page.route(`${SB}/rest/v1/app_library_folder_items*`,route=>route.request().method()==='GET'?route.fulfill({json:s.items}):route.fulfill({status:500,json:{}}));
  await signIn(page,`${appOrigin}/app/?view=library`);
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('library'));
  await expect(libraryNode(page,'p:top-a')).toBeAttached();
  await libraryTopMenu(page,'expand');
  return {s,errors};
}
const box=askBox,dragFrom=dragAsk,textSpot=askTextSpot;
const openFolderDelete=async(page,id)=>{
  await libraryNodeHead(page,'f:'+id).locator('[data-lu-node-menu]').click();
  await page.locator('#luFolderMenu').getByRole('button',{name:'폴더 삭제',exact:true}).click();
  const ask=page.locator('.kptu-ask');await expect(ask).toBeVisible();await expect(ask).toContainText('폴더를 휴지통으로 옮길까요?');
  return ask;
};

test.describe('확인 창 끌어 옮기기 PC 1280',()=>{
  test('자료실 폴더 삭제 확인 창: 빈 곳을 잡고 끌면 옮겨지고, 화면 밖으로 안 나가고, 끈 뒤에도 [취소]·[휴지통으로]·Esc 그대로',async({page})=>{
    const {s,errors}=await bootLibrary(page);
    let ask=await openFolderDelete(page,'fb');
    const start=await box(ask);
    // 빈 곳(글)을 잡고 왼쪽 위로 끈다 → 그만큼 옮겨진다. 끄는 동안 글자가 골라지지 않는다.
    await dragFrom(page,ask,{at:await textSpot(ask),dx:-200,dy:-120});
    const moved=await box(ask);
    expect(Math.abs(moved.x-(start.x-200))).toBeLessThanOrEqual(2);expect(Math.abs(moved.y-(start.y-120))).toBeLessThanOrEqual(2);
    expect(await page.evaluate(()=>String(getSelection())) ).toBe('');
    await expect(page.locator('html')).not.toHaveClass(/anchored-drag-active/);
    // 화면 밖으로 끌어도 가장자리(8px) 안에 머문다.
    // (마우스는 창 안 맨 구석까지 — 잡은 점이 창 안쪽이라 그대로 두면 판이 화면 밖으로 나갈 자리)
    let a=await ask.boundingBox(),at=await textSpot(ask);
    await dragFrom(page,ask,{at,dx:1-(a.x+at.x),dy:1-(a.y+at.y)});
    let b=await box(ask);expect(b.x).toBe(8);expect(b.y).toBe(8);
    a=await ask.boundingBox();at={x:a.width-6,y:a.height-6}; // 오른쪽 아래 여백을 잡고 오른쪽 아래 구석까지
    await dragFrom(page,ask,{at,dx:1279-(a.x+at.x),dy:899-(a.y+at.y)});
    b=await box(ask);expect(Math.abs(b.x+b.w-(1280-8))).toBeLessThanOrEqual(1);expect(Math.abs(b.y+b.h-(900-8))).toBeLessThanOrEqual(1);
    // 화면이 스크롤돼도 놓은 자리 그대로(누른 칸을 따라가지 않음).
    const here=await box(ask);await page.mouse.wheel(0,200);await page.waitForTimeout(100);expect(await box(ask)).toEqual(here);
    // 단추 위에서 끌면 창이 움직이지 않는다(그 단추를 누른 것도 아니다: 단추 밖에서 놓아 클릭이 되지 않음).
    const yes=ask.getByRole('button',{name:'휴지통으로'}),yb=await yes.boundingBox(),ab=await ask.boundingBox();
    await dragFrom(page,ask,{at:{x:yb.x-ab.x+yb.width/2,y:yb.y-ab.y+yb.height/2},dx:-150,dy:-150});
    expect(await box(ask)).toEqual(here);await expect(ask).toBeVisible();expect(s.writes).toEqual([]);
    // 짧게 누르기(움직이지 않음)는 끌기가 아니다: 창은 그 자리, 닫히지 않는다.
    await dragFrom(page,ask,{at:await textSpot(ask),dx:1,dy:1});expect(await box(ask)).toEqual(here);await expect(ask).toBeVisible();
    // 끈 뒤에도 Esc = 취소(아무것도 안 바뀜).
    await page.keyboard.press('Escape');await expect(ask).toHaveCount(0);expect(s.writes).toEqual([]);
    // 다시 열면 원래 자리(누른 ⋯ 옆). 끈 뒤 [취소]도 그대로.
    ask=await openFolderDelete(page,'fb');expect(await box(ask)).toEqual(start);
    await dragFrom(page,ask,{at:await textSpot(ask),dx:-100,dy:60});
    await ask.getByRole('button',{name:'취소'}).click();await expect(ask).toHaveCount(0);expect(s.writes).toEqual([]);
    // 끈 뒤 [휴지통으로] = 휴지통으로 옮긴다.
    ask=await openFolderDelete(page,'fb');
    await dragFrom(page,ask,{at:await textSpot(ask),dx:-100,dy:60});
    await ask.getByRole('button',{name:'휴지통으로'}).click();await expect(ask).toHaveCount(0);
    await expect.poll(()=>s.writes).toEqual([{method:'DELETE',id:'fb'}]);
    await expect(libraryNode(page,'f:fb')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('같은 공용 확인 창을 쓰는 노트 폴더 삭제도 끌어 옮기고, 끈 뒤 [취소]가 그대로',async({page})=>{
    await page.setViewportSize({width:1280,height:900});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await openHome(page);
    const folders=[{id:'00000000-0000-4000-8000-000000000001',workspace_id:'w',parent_id:null,name:'가상 노트 폴더',sort_order:1024,created_at:'2026-10-01T00:00:00Z'}],writes=[];
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>r.request().method()==='GET'?r.fulfill({json:[]}):r.fulfill({status:500,json:{}}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>{if(r.request().method()==='GET')return r.fulfill({json:structuredClone(folders)});writes.push(r.request().method());return r.fulfill({status:500,json:{}})});
    await page.route(SB+'/rest/v1/app_record_links?**',r=>new URL(r.request().url()).searchParams.has('note_id')?r.fulfill({json:[]}):r.fallback());
    await page.evaluate(()=>window.KPTURouter.go('basket'));
    await chooseBasketKind(page,'note');
    const more=page.locator(`#noteRows [data-nx-folder-more="${folders[0].id}"], [data-nx-tree] [data-nx-folder-more="${folders[0].id}"]`).first();
    await expect(more).toBeVisible();await more.click();
    await page.locator('#noteDocMenu [data-nx-delete-folder]').click();
    const ask=page.locator('.kptu-ask');await expect(ask).toBeVisible();await expect(ask).toContainText('폴더를 삭제할까요?');
    const start=await box(ask);
    await dragFrom(page,ask,{at:await textSpot(ask),dx:120,dy:80});
    const moved=await box(ask);
    expect(Math.abs(moved.x-Math.min(start.x+120,1280-8-start.w))).toBeLessThanOrEqual(2);expect(Math.abs(moved.y-Math.min(start.y+80,900-8-start.h))).toBeLessThanOrEqual(2);
    expect(moved).not.toEqual(start);
    await ask.getByRole('button',{name:'취소'}).click();await expect(ask).toHaveCount(0);expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});

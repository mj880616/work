import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
import {installViewPrefsServer} from '../view-prefs-server.mjs';
// 사진(S70-57): 맨 위 칸 '사진에서 찾기' = 보이는 사진 칸을 그림 이름으로 거르기(화면 메모리만). 흉내 서버(onedrive-photos), 이름은 지어낸 것.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==','base64');
const OD=[
  {id:'O1',name:'가상 바다.jpg',day:'2026-10-03',taken_at:'2026-10-03T03:00:00.000Z'},
  {id:'O2',name:'가상 산길.jpg',day:'2026-10-02',taken_at:'2026-10-02T03:00:00.000Z'},
  {id:'O3',name:'가상 바다 노을.jpg',day:'2026-10-01',taken_at:'2026-10-01T03:00:00.000Z'},
].map(m=>({...m,approx:false,kind:'photo',screenshot:false,duration_ms:null,uploaded_at:m.taken_at,size_bytes:100}));
export default {
  name:'사진',label:'사진에서 찾기',query:'산길',before:3,after:1,
  rows:page=>page.locator('#photosRoot [data-photos-list] [data-photos-id]'),
  async open(page,width){
    await page.addInitScript(()=>{window.KPTUOdWarm={run:()=>null}});
    await installViewPrefsServer(page,{});
    await openHome(page,{beforeLoad:async()=>{
      await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_diary_stars',r=>r.fulfill({json:[]}));
      await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_photo_tags',r=>r.fulfill({json:[]}));
      await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_photo_tag_items',r=>r.fulfill({json:[]}));
      await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/onedrive-photos',async r=>{
        const body=r.request().postDataJSON();
        if(body.action==='photo')return r.fulfill({status:200,contentType:'image/png',body:PNG});
        if(body.action==='status')return r.fulfill({json:{configured:true,connected:true,folder:{name:'카메라'},can_delete:true,whole:true}});
        if(body.action==='sync')return r.fulfill({json:{more:false,indexing:false,changed:0}});
        if(body.action==='library')return r.fulfill({json:{items:body.folder_id?[]:OD,next_cursor:null,indexing:false}});
        if(body.action==='months')return r.fulfill({json:{months:{'2026-10':OD.length},total:OD.length}});
        return r.fulfill({status:400,json:{error:'action_invalid'}});
      });
    }});
    if(width<=760){
      if(await page.locator('.mobile-tabs [data-view="photos"]').isVisible())await page.locator('.mobile-tabs [data-view="photos"]').click();
      else{await page.locator('#mobileMenuTab').click();await page.locator('#mobileMenu nav').getByRole('button',{name:'사진',exact:true}).click()}
    }else await page.locator('#appView>.app-nav').getByRole('link',{name:'사진',exact:true}).click();
    await expect(page.locator('#photosView')).toBeVisible();
  },
};

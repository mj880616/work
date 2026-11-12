import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {clickView} from './helpers/shell-navigation.mjs';
// ORG-찾을이름칸삭제(S61-4): 조직 창 [주요 인물] 탭의 [+ 인물]·칩 우클릭 [수정] 창은 이름 칸 + [취소][저장]만.
// '찾을 이름' 칸(설명·직접 적기·[추가]·찾은 이름 단추)은 없다. 고쳐 저장해도 이미 저장된 찾을 이름은 비우지 않고 그대로 보낸다.
// 화면 사진: KPTU_SHOTS=1 이면 docs/design/screens/s61-4/ (PC 1280 · 폰 412, 폴드 720은 재기만). 이름은 모두 합성 값이다.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',stamp='2026-09-15T01:00:00Z',owner='home-test';
const SHOTS=process.env.KPTU_SHOTS;
const org={id:'ob',workspace_id:'w',name:'합성 나 지부',active:true,created_by:owner,updated_at:stamp};
async function fixture(page,width){
 await page.setViewportSize({width,height:900});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await openHome(page);
 let people=[{id:'k1',workspace_id:'w',organization_id:'ob',name:'합성인물 하나',match_names:['합성인물 하나','합성 위원장','하나 위원장'],sort_order:0,created_at:stamp}];
 const writes=[];
 const list=(route,rows)=>{const q=new URL(route.request().url()).searchParams;const o=Number(q.get('offset')||0);return route.fulfill({json:rows.slice(o,o+Number(q.get('limit')||rows.length||1))})};
 await page.route(SB+'/rest/v1/app_suborganizations?**',route=>{const id=new URL(route.request().url()).searchParams.get('id');return route.fulfill({json:id&&id!=='eq.ob'?[]:[org]})});
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',route=>{const q=new URL(route.request().url()).searchParams;return route.fulfill({json:q.get('user_id')?[{user_id:owner}]:[{organization_id:'ob',user_id:owner}]})});
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',route=>list(route,[]));
 await page.route(SB+'/rest/v1/app_documents?**',route=>list(route,[]));
 await page.route(SB+'/rest/v1/app_org_key_people_briefs?**',route=>route.fulfill({json:[]}));
 await page.route(SB+'/rest/v1/app_org_key_people**',async route=>{
  const req=route.request(),m=req.method();
  if(m==='GET')return route.fulfill({json:people});
  const body=req.postDataJSON();writes.push({method:m,body});
  if(m==='PATCH'){people=people.map(p=>p.id==='k1'?{...p,...body}:p);return route.fulfill({status:204,body:''})}
  if(m==='POST'){people=[...people,{id:'k'+(people.length+1),created_at:stamp,...body}];return route.fulfill({status:201,body:''})}
  return route.fulfill({status:204,body:''});
 });
 return {errors,writes,people:()=>people};
}
async function openOrg(page){
 await clickView(page,'team');
 await page.locator('#soOrganizationList [data-so-org="ob"]').click();
 const modal=page.locator('#wdModal');await expect(modal).toBeVisible();
 await modal.locator('[data-wd-tab="people"]').click();
 await expect(modal.locator('#wdPeople .okp-chip')).toHaveText(['모두','합성인물 하나']);
 return modal;
}
// 창 안에 보이는 것: 제목·✕·이름 칸·[취소][저장]뿐.
async function onlyNameField(page){
 const box=page.locator('#okpModal');await expect(box).toBeVisible();
 await expect(box.locator('input')).toHaveCount(1);
 await expect(box.locator('input#okpName')).toBeVisible();
 await expect(box.locator('.okp-field')).toHaveCount(1);
 await expect(box.locator('.modal-action-footer button')).toHaveText(['취소','저장']);
 await expect(box.locator('.modal-card button:visible')).toHaveCount(3); // ✕·취소·저장
 await expect(box).not.toContainText('찾을 이름');
 await expect(box).not.toContainText('찾은 이름');
 await expect(box).not.toContainText('직접 적기');
 await expect(box.locator('#okpMatches,#okpMatchInput,#okpSuggest,[data-okp-match-add],[data-okp-suggest]')).toHaveCount(0);
 return box;
}
const shot=async(page,name)=>{if(!SHOTS)return;await page.waitForTimeout(250);await page.screenshot({path:`docs/design/screens/s61-4/${name}.png`})};

for(const width of [1280,720,412])test(`${width}: [+ 인물]·[수정] 창은 이름 칸 + [취소][저장]만, 고쳐 저장해도 찾을 이름 보존`,async({page})=>{
 const {errors,writes,people}=await fixture(page,width);
 const modal=await openOrg(page);
 // [+ 인물] 추가 창.
 await modal.locator('#wdPeople [data-okp-add]').click();
 let box=await onlyNameField(page);
 await expect(box.locator('#okpTitle')).toHaveText('주요 인물 추가');
 await box.locator('#okpName').fill('합성인물 둘');
 if(width!==720)await shot(page,`${width}-add`);
 await box.locator('[data-okp-save]').click();
 await expect(box).toBeHidden();
 await expect(modal.locator('#wdPeople .okp-chip')).toHaveText(['모두','합성인물 하나','합성인물 둘']);
 expect(writes.at(-1)).toMatchObject({method:'POST',body:{name:'합성인물 둘',match_names:['합성인물 둘']}});
 // 칩 우클릭 → [수정] 창: 이름만, 저장하면 저장된 찾을 이름을 그대로(옛 이름 포함) 보낸다.
 await modal.locator('#wdPeople [data-okp-person="k1"]').click({button:'right'});
 await modal.locator('#wdPeople [data-okp-edit="k1"]').click();
 box=await onlyNameField(page);
 await expect(box.locator('#okpTitle')).toHaveText('주요 인물 수정');
 await expect(box.locator('#okpName')).toHaveValue('합성인물 하나');
 if(width!==720)await shot(page,`${width}-edit`);
 await box.locator('[data-okp-save]').click();
 await expect(box).toBeHidden();
 expect(writes.at(-1).method).toBe('PATCH');
 expect(writes.at(-1).body.match_names).toEqual(['합성인물 하나','합성 위원장','하나 위원장']);
 // 이름을 바꿔 저장해도 찾을 이름은 비지 않는다(옛 이름도 남음).
 await modal.locator('#wdPeople [data-okp-person="k1"]').click({button:'right'});
 await modal.locator('#wdPeople [data-okp-edit="k1"]').click();
 box=await onlyNameField(page);
 await box.locator('#okpName').fill('합성인물 하나둘');
 await box.locator('#okpName').press('Enter');
 await expect(box).toBeHidden();
 expect(writes.at(-1)).toMatchObject({method:'PATCH',body:{name:'합성인물 하나둘',match_names:['합성인물 하나둘','합성인물 하나','합성 위원장','하나 위원장']}});
 expect(people().find(p=>p.id==='k1').match_names).toContain('합성 위원장');
 await expect(modal.locator('#wdPeople .okp-chip')).toHaveText(['모두','합성인물 하나둘','합성인물 둘']);
 // 취소는 아무것도 보내지 않는다.
 const n=writes.length;
 await modal.locator('#wdPeople [data-okp-add]').click();
 box=await onlyNameField(page);
 await box.locator('[data-okp-close]').last().click();
 await expect(box).toBeHidden();
 expect(writes.length).toBe(n);
 expect(errors).toEqual([]);
});

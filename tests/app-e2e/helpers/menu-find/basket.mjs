import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
import {chooseBasketKind} from '../basket-kind.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 잊지 말기(S70-57): 맨 위 칸 '잊지 말기에서 찾기' = 한 목록(forget-list.js items())의 줄 글 거르기. 업데이트 줄은 메모 글 전체로 찾는다.
// 흉내 낸 업데이트 3개(분류 전). 글은 지어낸 것. 세 번째는 둘째 줄에만 찾는 글자가 있다.
const NOTES=[
  {id:'fm-a',raw_text:'가상 창고 점검 메모',occurred_at:'2026-10-05T03:00:00Z',ai_export_allowed:true,attachments:[]},
  {id:'fm-b',raw_text:'가상 회의 준비 메모',occurred_at:'2026-10-05T02:00:00Z',ai_export_allowed:true,attachments:[]},
  {id:'fm-c',raw_text:'가상 연락 메모\n둘째 줄 창고 열쇠',occurred_at:'2026-10-05T01:00:00Z',ai_export_allowed:true,attachments:[]},
];
export default {
  name:'잊지 말기',label:'잊지 말기에서 찾기',query:'창고',before:3,after:2,match:'가상 창고 점검 메모',
  rows:page=>page.locator('#basketRows [data-basket-row-item]'),
  async open(page){
    await openHome(page);
    await page.route(SB+'/rest/v1/app_notes**',r=>{
      const req=r.request(),u=new URL(req.url());
      if(req.method()!=='GET')return r.fulfill({status:500,json:{}});
      return r.fulfill({json:u.searchParams.get('kind')==='eq.note'?[]:NOTES});
    });
    await chooseBasketKind(page,'memo');
    await expect(page.locator('#basketRows [data-basket-row-item]').first()).toBeVisible();
  },
};

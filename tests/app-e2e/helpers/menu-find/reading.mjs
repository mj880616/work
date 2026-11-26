import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const id=n=>`a7057000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// 저장한 글(S70-57): 맨 위 칸 '저장한 글에서 찾기' = [전체] 탭 글 줄 제목·매체 거르기(reading.js drawList). 글·주소는 지어낸 것.
const ROWS=[['가상 철도 소식','example.com'],['예시 병원 이야기','example.org'],['예시 학교 이야기','example.net']].map(([title,site],i)=>({
  id:id(i+1),url:`https://${site}/${i+1}`,title,site,saved_at:`2026-11-2${i+1}T01:00:00Z`,read_at:'2026-11-24T02:00:00Z',body_state:'ok',body_at:'2026-11-21T01:00:10Z',business_area_id:null,updated_at:'2026-11-21T01:00:10Z'}));
export default {
  name:'저장한 글',label:'저장한 글에서 찾기',query:'철도',before:3,after:1,match:'가상 철도 소식',
  rows:page=>page.locator('#readingView [data-rd-list] .rd-row'),
  async open(page){
    await openHome(page);
    await page.route(SB+'/rest/v1/app_reading_items**',r=>{const one=(new URL(r.request().url()).searchParams.get('id')||'').replace(/^eq\./,'');return r.fulfill({json:one?ROWS.filter(x=>x.id===one):ROWS})});
    await page.evaluate(()=>window.KPTURouter.go('reading'));
    await expect(page.locator('#readingView')).toBeVisible();
  },
};

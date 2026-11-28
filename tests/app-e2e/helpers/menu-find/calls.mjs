import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 통화(S70-57): 맨 위 칸 '통화에서 찾기' = 업무 통화함 목록 거르기(call-feed.js listHtml — 제목·상대·핵심내용 글자).
// 흉내 낸 통화 3개(call-telegram-feed.spec.mjs와 같은 모양). 이름·내용은 지어낸 것.
const base={workspace_id:'w',source:'call',room_key:null,room_label:null,summary:null,speaker_split:false,raw_count:0,organization_id:null,project_id:null,drive_url:null,pinned_at:null,hidden_at:null,created_at:'2026-10-06T00:00:00Z',updated_at:'2026-10-06T00:00:00Z'};
const items=[
  {...base,id:'60000000-0000-4000-8000-000000000001',day:'2026-10-06',occurred_at:'2026-10-06T00:42:00Z',title:'가상 교섭 일정 다음 주로 조정',points:['가상 교섭 다음 주 화요일로 변경'],counterpart:'예시지부 홍길동 위원장'},
  {...base,id:'60000000-0000-4000-8000-000000000002',day:'2026-10-06',occurred_at:'2026-10-05T23:10:00Z',title:'가상 자료집 원고 마감 확인',points:['원고 금요일 마감'],counterpart:null},
  {...base,id:'60000000-0000-4000-8000-000000000003',day:'2026-10-04',occurred_at:'2026-10-04T05:00:00Z',title:'가상 공문 회신 기한 문의',points:[],counterpart:null},
];
export default {
  name:'통화',label:'통화에서 찾기',query:'원고',before:3,after:1,match:'가상 자료집 원고 마감 확인',
  rows:page=>page.locator('#cfList [data-cf-row]'),
  async open(page){
    await openHome(page);
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>{
      const q=new URL(r.request().url()).searchParams;
      if(Number(q.get('offset')||0)||q.get('source')!=='eq.call')return r.fulfill({json:[]});
      const fields=(q.get('select')||'').split(',');
      return r.fulfill({json:items.map(x=>Object.fromEntries(fields.map(f=>[f,x[f]??null])))});
    });
    for(const t of ['app_feed_days','app_call_personal','app_call_edits','app_suborganizations','app_suborganization_assignees'])
      await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+t,r=>r.fulfill({json:[]}));
    await page.evaluate(()=>window.KPTURouter.go('calls'));
    await expect(page.locator('#callsView')).toBeVisible();
  },
};

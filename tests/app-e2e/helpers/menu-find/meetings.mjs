import {expect} from '@playwright/test';
import {openHome} from '../home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 사업 관리(S70-57): 맨 위 칸 '사업 관리에서 찾기' = 사업 보고 줄 거르기(team.js reportRows·meetingColumnList — 그리기 전 자료 한 곳).
// 폭마다 그리는 모양이 다르다: 1200px~ 세 칸(종류 줄), 600~1199px 두 칸(보고 줄), ~599px 폰 줄. 회의명을 모두 다르게 두어 어느 모양이든 줄 수 = 보고 수.
// 흉내 낸 회의 보고 3건(openHome 기준 날 2026-10-06, 같은 주). 이름은 지어낸 것.
const meeting=(id,title,at,extra={})=>({id,workspace_id:'home-workspace',title,series_name:title,round_no:null,meeting_at:at,activity_kind:'meeting',created_by:'home-test',created_at:at,updated_at:at,...extra});
const MEETINGS=[
  meeting('fm-1','가상 물류 대표자 회의','2026-10-06T02:00:00Z'),
  meeting('fm-2','가상 병원 실무 회의','2026-10-05T02:00:00Z'),
  meeting('fm-3','가상 점검 회의','2026-10-07T02:00:00Z',{location:'물류 창고'}),
];
export default {
  name:'사업 관리',label:'사업 관리에서 찾기',query:'물류',before:3,after:2,
  rows:page=>page.locator('#meetingList :is(.mcol-kinds [data-meeting-kind], .mcol-two [data-meeting-round], .meeting-list-row)'),
  async open(page){
    await openHome(page);
    await page.route(SB+'/rest/v1/app_meetings?**',r=>{
      if(r.request().method()!=='GET')return r.fulfill({status:500,json:{}});
      const id=new URL(r.request().url()).searchParams.get('id')||'';
      return r.fulfill({json:!id||id.startsWith('in.(')?MEETINGS:MEETINGS.filter(m=>'eq.'+m.id===id)});
    });
    await page.evaluate(()=>window.KPTURouter.go('meetings'));
    await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
    await expect(page.locator('#meetingList :is([data-meeting-kind],[data-meeting-round],.meeting-list-row)').first()).toBeVisible();
  },
};

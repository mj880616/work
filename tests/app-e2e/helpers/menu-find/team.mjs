import {openHome} from '../home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
// 조직 관리(S70-54 ②): 맨 위 칸 '조직 관리에서 찾기' = 담당조직 이름 거르기(renderTeam).
export default {
  name:'조직 관리',label:'조직 관리에서 찾기',query:'철도',before:2,after:1,match:'가상 철도 지부',
  rows:page=>page.locator('#soOrganizationList [data-so-org]'),
  async open(page){
    const owner='home-test',stamp='2026-09-15T01:00:00Z';
    const orgs=[{id:'oa',workspace_id:'w',name:'가상 철도 지부',active:true,created_by:owner,updated_at:stamp},{id:'ob',workspace_id:'w',name:'가상 병원 지부',active:true,created_by:owner,updated_at:stamp}];
    await openHome(page,{features:[]});
    await page.route(SB+'/rest/v1/app_suborganizations?**',r=>{const id=new URL(r.request().url()).searchParams.get('id');return r.fulfill({json:id?orgs.filter(o=>'eq.'+o.id===id):orgs})});
    await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>{const q=new URL(r.request().url()).searchParams;return r.fulfill({json:q.get('user_id')?[{user_id:owner}]:orgs.map(o=>({organization_id:o.id,user_id:owner}))})});
    await page.evaluate(()=>window.KPTURouter.go('team'));
  },
};

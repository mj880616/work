import {test,expect} from '@playwright/test';
import {openFolds} from './helpers/area-org-picker.mjs';
import {openHome} from './helpers/home-entry.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
import {typeInto} from './helpers/note-editor.mjs';
// UPD-여러곳고르기(QUICK-입력정리 뒤: 큰 쓰기 창 ▾만 남음): "기록할 곳 선택" 창에서 담당조직·프로젝트를 여러 곳 고른다.
// 누르면 체크만 되고 창은 열린 채, 아래 'N곳 선택됨' + [취소] [저장], [저장]을 눌러야 닫히고 반영. 바구니(미분류)는 다른 곳과 함께
// 고를 수 없다. 여러 곳이면 입력창 버튼이 '첫 곳 이름 외 N'. 저장은 바구니 업데이트 1건 + 기존 [연결하기] 경로
// (app_basket_confirm_links)로 고른 곳 모두에 연결. 조직 한 곳은 기존 그대로 그 조직 기록, 사업영역 한 곳도 정리함 1건 + 연결(MTG-프로젝트합치기 3단계). 추가 뒤 바구니로 돌아가고 쓴 곳은 '최근' 맨 앞.
// 이름은 모두 가짜(합성) 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NAMES=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','서해선지부','공항철도지부'];
const ID=i=>`00000000-0000-4000-8000-00000000000${i}`;
const PID='00000000-0000-4000-8000-0000000000aa';
const dialog=page=>page.getByRole('dialog');
async function setup(page,width){
 await page.setViewportSize({width,height:width<761?844:800});await openHome(page);
 const f={notes:[],orgs:[],projects:[],links:[],linkReply:{ok:true,created:0,existing:0},errors:[]};
 page.on('pageerror',e=>f.errors.push(e.message));
 await page.route(SB+'/rest/v1/app_suborganizations?**',r=>r.fulfill({json:NAMES.map((name,i)=>({id:ID(i),name,active:true}))}));
 await page.route(SB+'/rest/v1/app_suborganization_assignees?**',r=>r.fulfill({json:NAMES.map((_,i)=>({organization_id:ID(i)}))}));
 await page.route(SB+'/rest/v1/app_suborganization_updates?**',r=>r.fulfill({json:[{organization_id:ID(1),occurred_at:'2026-10-06'}]}));
 await page.route(SB+'/rest/v1/app_spaces?**',r=>r.fulfill({json:[{id:PID,name:'합성 프로젝트',owner_id:'home-test',status:'active',metadata:{project_system:'v2'}}]}));
 await page.route(SB+'/rest/v1/app_suborganization_updates',r=>{f.orgs.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_project_progress_updates',r=>{f.projects.push(r.request().postDataJSON());return r.fulfill({json:[]});});
 await page.route(SB+'/rest/v1/app_notes**',r=>{if(r.request().method()!=='POST')return r.fallback();const body=r.request().postDataJSON();f.notes.push(body);return r.fulfill({status:201,json:[{id:'note-'+f.notes.length,kind:'basket',occurred_at:'2026-10-22T01:00:00Z',updated_at:'2026-10-22T01:00:00.123456Z',ai_export_allowed:true,archived_at:null,attachments:[],metadata:{},...body}]});});
 await page.route(SB+'/rest/v1/rpc/app_basket_confirm_links',r=>{f.links.push(r.request().postDataJSON());return r.fulfill({json:f.linkReply});});
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 return {f};
}
const org=(page,name)=>dialog(page).locator('[data-sheet-all]').getByRole('button',{name,exact:true});
const save=page=>dialog(page).getByRole('button',{name:'저장',exact:true});
const cancel=page=>dialog(page).getByRole('button',{name:'취소',exact:true});





// MTG-프로젝트합치기 3단계: 사업영역(프로젝트) 하나만 고르면 진행 기록이 아니라 여러 곳과 같은 길(정리함 1건 + 연결)로 간다.



test('빠른 추가 [업데이트]도 같은 창: 여러 곳 저장은 정리함 1건 + 연결',async({page})=>{
 const {f}=await setup(page,1280);
 await openWriteFromEntry(page,1280);const e=page.locator('#edWindow');await expect(e).toBeVisible();
 await typeInto(page,e.locator('.ed-window-body .ProseMirror'),'쓰기 여러 곳');
 await e.locator('[data-edw-place]').click();const sheet=page.locator('#edwPlaceSheet');await openFolds(sheet);
 await sheet.locator('[data-sheet-all]').getByRole('button',{name:'전국철도노동조합',exact:true}).click();
 await sheet.locator('[data-sheet-projects]').getByRole('button',{name:'합성 프로젝트',exact:true}).click();
 await sheet.getByRole('button',{name:'저장',exact:true}).click();
 await expect(e.locator('[data-edw-place]')).toContainText('전국철도노동조합 외 1');
 await e.locator('[data-edw-save]').click();await expect(e).toHaveCount(0);
 await expect(page.locator('#toast')).toContainText('전국철도노동조합 외 1 기록에 저장했어요.');
 expect(f.notes).toEqual([expect.objectContaining({raw_text:'쓰기 여러 곳'})]);expect(f.links[0].p_targets).toEqual([{kind:'organization',target_id:ID(0),reason:'직접 연결',origin:'record_input'},{kind:'project',target_id:PID,reason:'직접 연결',origin:'record_input'}]);
});

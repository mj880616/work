import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {openWriteFromEntry} from './helpers/write-opener.mjs';
import {typeInto} from './helpers/note-editor.mjs';
// UPD-여러곳고르기: 홈 [업데이트 ▾] "기록할 곳 선택" 창에서 담당조직·프로젝트를 여러 곳 고른다.
// 누르면 체크만 되고 창은 열린 채, 아래 'N곳 선택됨' + [취소] [저장], [저장]을 눌러야 닫히고 반영. 바구니(미분류)는 다른 곳과 함께
// 고를 수 없다. 여러 곳이면 입력창 버튼이 '첫 곳 이름 외 N'. 저장은 바구니 업데이트 1건 + 기존 [연결하기] 경로
// (app_basket_confirm_links)로 고른 곳 모두에 연결. 한 곳은 기존 그대로 그 곳 기록. 추가 뒤 바구니로 돌아가고 쓴 곳은 '최근' 맨 앞.
// 이름은 모두 가짜(합성) 값.
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const NAMES=['전국철도노동조합','서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','서해선지부','공항철도지부'];
const ID=i=>`00000000-0000-4000-8000-00000000000${i}`;
const PID='00000000-0000-4000-8000-0000000000aa';
const quick=page=>page.locator('#homeView [data-home-quick]');
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
 await page.reload();
 const q=quick(page);await q.locator('[data-quick-mode="update"]').click();await q.locator('[data-quick-input]').fill('합성 기록');
 return {q,f};
}
const org=(page,name)=>dialog(page).locator('[data-sheet-all]').getByRole('button',{name,exact:true});
const save=page=>dialog(page).getByRole('button',{name:'저장',exact:true});
const cancel=page=>dialog(page).getByRole('button',{name:'취소',exact:true});

for(const width of [390,1280])test(`여러 곳 고르기: 눌러도 창이 열린 채 체크, N곳 선택됨, [저장]으로 반영, 버튼 '첫 곳 외 N' ${width}`,async({page},info)=>{
 const {q,f}=await setup(page,width);
 await q.locator('[data-quick-org]').click();await expect(dialog(page)).toBeVisible();
 // ④ 최근 line stays on top: [바구니(미분류)] (chosen) then the recent organization.
 const labels=await dialog(page).locator('[data-sheet-content] .home-choice-label').allTextContents();expect(labels[0]).toBe('최근');
 await expect(dialog(page).locator('[data-sheet-basket] button')).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page).locator('[data-sheet-recent] [data-sheet-value]')).toHaveText(['서울교통공사노동조합']);
 await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('정리함(미분류) 선택됨');
 // ① groups as small headings, one organization per line with a check box.
 await expect(dialog(page).locator('[data-sheet-all] .home-choice-group-name')).toHaveText(['철도','지하철','민자철도']);
 // ② presses keep the sheet open and mark each place; the recent chip and its list row move together.
 await org(page,'부산지하철노동조합').click();await org(page,'서울교통공사노동조합').click();
 await dialog(page).locator('[data-sheet-projects]').getByRole('button',{name:'합성 프로젝트',exact:true}).click();
 await expect(dialog(page)).toBeVisible();
 await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('3곳 선택됨');
 await expect(dialog(page).locator('[data-sheet-basket] button')).toHaveAttribute('aria-pressed','false');
 await expect(dialog(page).locator('[data-sheet-recent] [data-sheet-value]')).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page).locator('[data-sheet-all] [aria-pressed="true"] .home-choice-name')).toHaveText(['서울교통공사노동조합','부산지하철노동조합']);
 // A second press unmarks.
 await org(page,'서울교통공사노동조합').click();await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('2곳 선택됨');
 await org(page,'서울교통공사노동조합').click();await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('3곳 선택됨');
 // ③ footer: count left, [취소] [저장] right, inside the sheet (phone: at its very bottom, the list scrolls above it).
 const d=await dialog(page).boundingBox(),c=await dialog(page).locator('[data-sheet-count]').boundingBox(),x=await cancel(page).boundingBox(),s=await save(page).boundingBox();
 expect(c.x).toBeLessThan(x.x);expect(x.x+x.width).toBeLessThanOrEqual(s.x);expect(s.x+s.width).toBeLessThanOrEqual(d.x+d.width);expect(s.y+s.height).toBeLessThanOrEqual(d.y+d.height);
 if(width<761){const content=await dialog(page).locator('[data-sheet-content]').boundingBox();expect(content.y+content.height).toBeLessThanOrEqual(s.y);expect(d.y+d.height-(s.y+s.height)).toBeLessThanOrEqual(20);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`multi-sheet-${width}.png`)});
 await save(page).click();await expect(dialog(page)).toBeHidden();
 // ⑥ the input's button says "첫 곳 이름 외 N" (in the order picked).
 await expect(q.locator('[data-quick-mode="update"]')).toHaveText('부산지하철노동조합 외 2');
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 부산지하철노동조합 외 2');
 await expect(q.locator('[data-quick-input]')).toHaveAttribute('placeholder','부산지하철노동조합 외 2 기록을 입력하세요');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`multi-button-${width}.png`)});
 // Save: one basket update, linked to all three at once through the basket's own [연결하기] path, in the order picked
 // (서울교통공사노동조합 was unmarked and marked again above, so it is last).
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(f.notes).toHaveLength(1);expect(f.notes[0]).toMatchObject({raw_text:'합성 기록'});expect(f.orgs).toEqual([]);expect(f.projects).toEqual([]);
 expect(f.links).toEqual([{p_note_id:'note-1',p_note_updated_at:'2026-10-22T01:00:00.123456Z',p_targets:[
  {kind:'organization',target_id:ID(2),reason:'직접 연결'},{kind:'project',target_id:PID,reason:'직접 연결'},{kind:'organization',target_id:ID(1),reason:'직접 연결'}]}]);
 await expect(page.locator('#toast')).toContainText('기록을 저장했습니다.');
 // ⑦ back to the basket; the places just used lead the 최근 line, none chosen.
 await expect(q).toHaveAttribute('data-mode','basket');await expect(q.locator('[data-quick-mode="update"]')).toHaveText('업데이트');
 await q.locator('[data-quick-org]').click();
 await expect(dialog(page).locator('[data-sheet-recent] [data-sheet-value]')).toHaveText(['부산지하철노동조합','합성 프로젝트','서울교통공사노동조합']);
 await expect(dialog(page).locator('[data-sheet-recent] [aria-pressed="true"]')).toHaveCount(0);
 await expect(dialog(page).locator('[data-sheet-basket] button')).toHaveAttribute('aria-pressed','true');
 expect(f.errors).toEqual([]);
});

test('[취소]·×·Esc는 고른 것을 버리고 이전 선택을 유지',async({page})=>{
 const {q}=await setup(page,1280);
 await q.locator('[data-quick-org]').click();await org(page,'서해선지부').click();await save(page).click();
 await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 서해선지부');
 for(const close of [()=>cancel(page).click(),()=>dialog(page).getByRole('button',{name:'선택판 닫기'}).click(),()=>page.keyboard.press('Escape')]){
  await q.locator('[data-quick-org]').click();await org(page,'공항철도지부').click();await org(page,'서해선지부').click();
  await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('1곳 선택됨');
  await close();await expect(dialog(page)).toBeHidden();
  await expect(q.locator('[data-quick-org]')).toHaveAccessibleName('기록할 곳 선택: 서해선지부');await expect(q.locator('[data-quick-mode="update"]')).toHaveText('업데이트');
  // Opening again shows the kept choice, not the dropped one.
  await q.locator('[data-quick-org]').click();await expect(dialog(page).locator('[data-sheet-all] [aria-pressed="true"]')).toHaveText(['서해선지부']);await cancel(page).click();
 }
});

test('정리함(미분류)는 다른 곳과 함께 고를 수 없음(정리함을 고르면 나머지 해제, 반대도)',async({page})=>{
 const {q,f}=await setup(page,1280);
 await q.locator('[data-quick-org]').click();const basket=dialog(page).locator('[data-sheet-basket] button');
 await org(page,'전국철도노동조합').click();await org(page,'공항철도지부').click();
 await expect(basket).toHaveAttribute('aria-pressed','false');await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('2곳 선택됨');
 await basket.click();await expect(basket).toHaveAttribute('aria-pressed','true');
 await expect(dialog(page).locator('[data-sheet-content] button[aria-pressed="true"]')).toHaveCount(1);await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('정리함(미분류) 선택됨');
 await org(page,'공항철도지부').click();await expect(basket).toHaveAttribute('aria-pressed','false');await expect(dialog(page).locator('[data-sheet-count]')).toHaveText('1곳 선택됨');
 await basket.click();await save(page).click();await expect(q).toHaveAttribute('data-mode','basket');
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(f.notes).toHaveLength(1);expect(f.links).toEqual([]);expect(f.orgs).toEqual([]);
});

test('한 곳만 고르면 기존 그대로 그 곳 기록(연결 없음)',async({page})=>{
 const {q,f}=await setup(page,1280);
 await q.locator('[data-quick-org]').click();await org(page,'공항철도지부').click();await save(page).click();
 await expect(q.locator('[data-quick-mode="update"]')).toHaveText('업데이트');
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 expect(f.orgs).toEqual([{organization_id:ID(5),raw_text:'합성 기록',created_by:'home-test'}]);expect(f.notes).toEqual([]);expect(f.links).toEqual([]);
});

test('연결이 거절되면 업데이트는 정리함에 남고 안내(두 번 저장하지 않음)',async({page})=>{
 const {q,f}=await setup(page,1280);f.linkReply={ok:false,error:'TARGET_UNSELECTABLE',created:0,existing:0};
 await q.locator('[data-quick-org]').click();await org(page,'공항철도지부').click();await org(page,'서해선지부').click();await save(page).click();
 await q.locator('[data-quick-save]').click();await expect(q.locator('[data-quick-input]')).toHaveValue('');
 await expect(q.locator('[data-quick-status]')).toHaveText('업데이트는 정리함에 저장했지만 고른 곳에 연결하지 못했어요. 정리함에서 [연결하기]로 다시 연결해 주세요.');
 await expect(page.locator('#toast')).toContainText('정리함에 저장했습니다.');
 expect(f.notes).toHaveLength(1);expect(f.links).toHaveLength(1);await expect(q).toHaveAttribute('data-mode','basket');
});

test('큰 창(쓰기)의 ▾도 같은 여러 곳 고르기, 저장하면 한 번에 연결',async({page})=>{
 const {q,f}=await setup(page,1280);
 await q.locator('[data-quick-big]').click();const e=page.locator('#edWindow');await expect(e).toBeVisible();
 await e.locator('[data-edw-place]').click();const sheet=page.locator('#edwPlaceSheet');await expect(sheet).toBeVisible();
 await sheet.locator('[data-sheet-all]').getByRole('button',{name:'대구교통공사노동조합',exact:true}).click();
 await sheet.locator('[data-sheet-all]').getByRole('button',{name:'공항철도지부',exact:true}).click();
 await expect(sheet).toBeVisible();await expect(sheet.locator('[data-sheet-count]')).toHaveText('2곳 선택됨');
 await sheet.getByRole('button',{name:'저장',exact:true}).click();await expect(sheet).toBeHidden();
 await expect(e.locator('[data-edw-place]')).toContainText('대구교통공사노동조합 외 1');
 // The home input follows the window's choice.
 await expect(q.locator('[data-quick-mode="update"]')).toHaveText('대구교통공사노동조합 외 1');
 await e.locator('[data-edw-save]').click();await expect(e).toHaveCount(0);
 // ED③ 업데이트: with two or more places the basket update keeps the saved form with its letters.
 expect(f.notes).toHaveLength(1);expect(f.notes[0].doc).toMatchObject({v:'ed1'});expect(f.links).toHaveLength(1);expect(f.links[0].p_targets.map(t=>t.target_id)).toEqual([ID(3),ID(5)]);
 await expect(q).toHaveAttribute('data-mode','basket');
});

test('빠른 추가 [업데이트]도 같은 창: 여러 곳 저장은 정리함 1건 + 연결',async({page})=>{
 const {f}=await setup(page,1280);
 await openWriteFromEntry(page,1280);const e=page.locator('#edWindow');await expect(e).toBeVisible();
 await typeInto(page,e.locator('.ed-window-body .ProseMirror'),'쓰기 여러 곳');
 await e.locator('[data-edw-place]').click();const sheet=page.locator('#edwPlaceSheet');
 await sheet.locator('[data-sheet-all]').getByRole('button',{name:'전국철도노동조합',exact:true}).click();
 await sheet.locator('[data-sheet-projects]').getByRole('button',{name:'합성 프로젝트',exact:true}).click();
 await sheet.getByRole('button',{name:'저장',exact:true}).click();
 await expect(e.locator('[data-edw-place]')).toContainText('전국철도노동조합 외 1');
 await e.locator('[data-edw-save]').click();await expect(e).toHaveCount(0);
 await expect(page.locator('#toast')).toContainText('전국철도노동조합 외 1 기록에 저장했어요.');
 expect(f.notes).toEqual([expect.objectContaining({raw_text:'쓰기 여러 곳'})]);expect(f.links[0].p_targets).toEqual([{kind:'organization',target_id:ID(0),reason:'직접 연결'},{kind:'project',target_id:PID,reason:'직접 연결'}]);
});

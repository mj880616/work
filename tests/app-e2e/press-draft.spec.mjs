import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// FEAT-1029묶음 ④ 성명·보도자료 초안 창(app/press-draft.js). 사업 보고 목록·ai-assist kind=press_draft·노트 저장·폴더·연결은 모두 가짜 응답.
// 폰 412·884는 고르기 → 미리보기 한 칸씩(뒤로 = 고르기), PC 1440은 두 칸. 서버로는 고른 ID만 가고, [노트로 저장] 전에는 아무것도 저장되지 않는다.
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const M1='e0000000-0000-4000-8000-000000000001',M2='e0000000-0000-4000-8000-000000000002',M3='e0000000-0000-4000-8000-000000000003';
const NOTE='f0000000-0000-4000-8000-000000000001',FOLDER='f1000000-0000-4000-8000-000000000001';
const resourceNoise=text=>/Failed to load resource|net::ERR_FAILED/.test(text);
const ANSWER={ok:true,kind:'press_draft',type:'statement',title:'가상철도는 단협 해지 통보를 즉각 철회하라',subtitle:'명절 앞 일방 통보',
  paragraphs:[{text:'가상철도가 10월 2일 단체협약 해지를 통보했다.',refs:[1]},{text:'노조는 기자회견을 열 예정이다.',refs:[2,1]}],
  demands:[{text:'해지 통보를 즉각 철회하라.',refs:[1]}],checks:['통보 날짜 확인','발신 이름 [확인 필요: 발신]'],partial:false,
  sources:[{ref:1,meeting_id:M1,title:'가상지부 임단협 3차',day:'2026-10-02'},{ref:2,meeting_id:M2,title:'가상 대책회의',day:'2026-10-03'}]};

async function fixture(page,{width,ai=()=>({json:ANSWER})}){
 await page.setViewportSize({width,height:900});
 const errors=[],calls={ai:[],notes:[],links:[],folders:[],meetings:[]};
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!resourceNoise(m.text()))errors.push(m.text());});
 await openHome(page,{beforeLoad:async()=>{
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_meetings',route=>{
   calls.meetings.push(new URL(route.request().url()).search);
   return route.fulfill({json:[
    {id:M1,title:'3차 교섭',series_name:'가상지부 임단협',round_no:3,meeting_at:'2026-10-02T05:00:00Z',activity_kind:null},
    {id:M2,title:'가상 대책회의',series_name:null,round_no:null,meeting_at:'2026-10-03T05:00:00Z',activity_kind:null},
    {id:M3,title:'가상 정례 회의',series_name:null,round_no:null,meeting_at:'2026-10-01T05:00:00Z',activity_kind:null}]});
  });
  await page.route(SB+'/functions/v1/ai-assist',route=>{
   if(route.request().method()!=='POST')return route.fulfill({status:204});
   const body=route.request().postDataJSON();if(body.kind!=='press_draft')return route.fallback();
   calls.ai.push(body);return route.fulfill(ai(body));
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',route=>{
   const method=route.request().method(),q=new URL(route.request().url()).searchParams;
   // the folder write after the save: read the new note's metadata, then one guarded PATCH (basket-data.js setNoteFolderRef)
   if(q.get('id')===`eq.${NOTE}`&&method==='GET')return route.fulfill({json:[{id:NOTE,updated_at:'2026-10-06T01:00:00Z',metadata:{}}]});
   if(q.get('id')===`eq.${NOTE}`&&method==='PATCH'){const body=route.request().postDataJSON();calls.folders.push(body);return route.fulfill({json:[{id:NOTE,updated_at:'2026-10-06T01:00:00Z',metadata:body.metadata}]});}
   if(method!=='POST')return route.fallback();
   const body=route.request().postDataJSON();calls.notes.push(body);
   return route.fulfill({status:201,json:[{id:NOTE,kind:'note',...body,created_at:'2026-10-06T01:00:00Z',updated_at:'2026-10-06T01:00:00Z',metadata:{}}]});
  });
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',route=>route.fulfill({json:[{id:FOLDER,parent_id:null,name:'성명 초안',sort_order:0,created_at:'2026-10-01T00:00:00Z'}]}));
  await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',route=>{
   if(route.request().method()!=='POST')return route.fallback();
   calls.links.push(route.request().postDataJSON());return route.fulfill({status:201,json:[]});
  });
 }});
 return {errors,calls};
}
const dlg=page=>page.locator('#pressDraftDialog');
async function press(page,locator,width){await expect(locator).toBeVisible();if(width<761)await locator.tap();else await locator.click();}
const noWideScroll=page=>page.evaluate(()=>{const d=document.querySelector('#pressDraftDialog');return document.documentElement.scrollWidth<=innerWidth&&(!d||d.scrollWidth<=d.clientWidth+1);});

for(const width of [412,884,1440])test(`press draft: pick 근거, preview only, then save as a note (AI excluded, folder, links) ${width}`,async({page})=>{
 const f=await fixture(page,{width});
 await page.evaluate(()=>import('./press-draft.js').then(m=>m.openPressDraft({preselect:'e0000000-0000-4000-8000-000000000001'})));
 const d=dlg(page);await expect(d).toBeVisible();
 await expect(d.locator('h2')).toHaveText('성명·보도자료 초안');
 await expect(d.locator('[data-pd-pick]')).toHaveCount(3);
 await expect(d.locator(`[data-pd-pick="${M1}"]`)).toBeChecked();
 await expect(d.locator('.pd-pick').first()).toContainText('가상지부 임단협 3차');
 await expect(d.locator('[data-pd-count]')).toHaveText('1');
 // UI-고른것접기: 미리 고른 보고는 위에 늘 보이고, 나머지는 접힌 '최근 사업 보고 2' 안(맨 위 찾기 칸)
 const others=d.locator('[data-pick-others]');
 await expect(others).not.toHaveAttribute('open','');
 await expect(others.locator('summary')).toHaveText('최근 사업 보고 2');
 await press(page,others.locator('summary'),width);
 await expect(others.locator('[data-pick-search]')).toBeVisible();
 await press(page,d.locator(`[data-pd-pick="${M2}"]`),width);
 await expect(d.locator('[data-pd-count]')).toHaveText('2');
 await expect(d.locator('[data-pick-others]')).toHaveAttribute('open','');
 await expect(d.locator('.pick-picked [data-pd-pick]')).toHaveCount(2);
 await press(page,d.getByRole('button',{name:'보도자료'}),width);
 await expect(d.getByRole('button',{name:'보도자료'})).toHaveAttribute('aria-pressed','true');
 await press(page,d.getByRole('button',{name:'성명',exact:true}),width);
 await d.locator('[data-pd-direction]').fill('단협 해지 철회 촉구');
 expect(await noWideScroll(page)).toBe(true);
 await press(page,d.locator('[data-pd-make]'),width);
 await expect(d.locator('[data-pd-doc-title]')).toHaveText(ANSWER.title);
 expect(f.calls.ai).toEqual([{kind:'press_draft',type:'statement',meeting_ids:[M1,M2],direction:'단협 해지 철회 촉구'}]);
 await expect(d.locator('.pd-doc p').filter({hasText:'통보했다'})).toContainText('[근거 1]');
 await expect(d.locator('.pd-checks')).toContainText('확인할 것 2');
 await expect(d.locator('.pd-sources')).toContainText('가상지부 임단협 3차 · 10.2');
 await expect(d.locator('.pd-preview-head')).toContainText('AI 초안 · 근거 2건 · 사실 확인 전');
 expect(f.calls.notes).toEqual([]);expect(f.calls.links).toEqual([]);
 if(width>=761)await expect(d.locator('.pd-pick-pane')).toBeVisible();
 else await expect(d.locator('.pd-pick-pane')).toHaveCount(0);
 expect(await noWideScroll(page)).toBe(true);
 await press(page,d.getByRole('button',{name:'노트로 저장'}),width);
 await expect(d.locator('[data-pd-status]')).toContainText('노트로 저장했어요.');
 await expect(d.locator('[data-pd-status]')).toContainText("'성명 초안' 폴더에 넣었어요.");
 expect(f.calls.notes.length).toBe(1);
 expect(f.calls.folders).toEqual([{metadata:{folder_id:FOLDER,folder:'성명 초안'}}]);
 const note=f.calls.notes[0];
 expect(note).toMatchObject({kind:'note',title:ANSWER.title,ai_export_allowed:false});
 expect(note.raw_text).toContain('[성명 초안 · AI 초안 · 사실 확인 전]');
 expect(note.raw_text).toContain('가상철도가 10월 2일 단체협약 해지를 통보했다. [근거 1]');
 expect(note.raw_text).toContain('1. 사업 보고 · 가상지부 임단협 3차 · 10.2');
 expect(f.calls.links.map(l=>l.meeting_id)).toEqual([M1,M2]);
 expect(f.calls.links.every(l=>l.note_id===NOTE&&l.status==='confirmed')).toBe(true);
 await expect(d.getByRole('button',{name:'저장함'})).toBeDisabled();
 await expect(d.getByRole('button',{name:'노트 열기'})).toBeVisible();
 expect(f.errors).toEqual([]);
});

test('press draft (phone): back from the preview returns to the picks, back again closes; nothing saved',async({page})=>{
 const f=await fixture(page,{width:412});
 await page.evaluate(()=>import('./press-draft.js').then(m=>m.openPressDraft()));
 const d=dlg(page);
 await press(page,d.locator(`[data-pd-pick="${M3}"]`),412);
 await press(page,d.locator('[data-pd-make]'),412);
 await expect(d.locator('[data-pd-doc-title]')).toBeVisible();
 await page.goBack();
 await expect(d.locator('[data-pd-make]')).toHaveText('다시 만들기');
 await expect(d.locator(`[data-pd-pick="${M3}"]`)).toBeChecked();
 await page.goBack();
 await expect(d).toBeHidden();
 expect(f.calls.notes).toEqual([]);
 expect(f.errors).toEqual([]);
});

test('press draft: server not deployed yet or no text shows one plain line; at most 5 picks',async({page})=>{
 let reply={status:400,json:{ok:false,error:'invalid_request'}};
 const f=await fixture(page,{width:1440,ai:()=>reply});
 await page.evaluate(()=>import('./press-draft.js').then(m=>m.openPressDraft()));
 const d=dlg(page);
 await expect(d.locator('[data-pd-make]')).toBeDisabled();
 await d.locator(`[data-pd-pick="${M1}"]`).click();
 await d.locator('[data-pd-make]').click();
 await expect(d.locator('[data-pd-status]')).toHaveText('성명·보도자료 초안은 아직 준비 중이에요.');
 reply={status:422,json:{ok:false,error:'press_no_source'}};
 await d.locator('[data-pd-make]').click();
 await expect(d.locator('[data-pd-status]')).toHaveText('고른 기록에 초안에 쓸 글이 없어요.');
 await expect(d.getByRole('button',{name:'노트로 저장'})).toHaveCount(0);
 expect(f.calls.notes).toEqual([]);
 expect(f.errors).toEqual([]);
});

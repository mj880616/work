// FAMILY-기억알림(요청함 11/12 10:40, 시안 docs/design/mockups/family-note-remind.html, 명진 10:47 "나"): '잊지 말기' 화면 맨 위 '가족 · 기억할 것' 3줄.
// - 날마다 3줄(오래 못 본 줄 먼저), [↻ 다른 줄], 본 기록은 서버(노트 metadata.remind — 글자는 저장하지 않고 짧은 열쇠만).
// - 줄 ⋯ [노트에서 보기] [과거 기록으로] → 같은 폴더 '과거 기록' 노트(AI 제외, 처음 한 번 만듦) 끝에 '날짜 · 줄', 되돌리기는 제자리.
// - 노트 화면(가족 노트 ⋯ [줄 정리])도 같은 메뉴. 가족 노트가 없으면 칸 없음.
// 서버는 흉내(PATCH는 id·updated_at·ai_export_allowed·family_list·family_past 조건을 지킴), 글은 모두 지어낸 것. 폰 412 · PC 1280.
import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const FAM='a0000000-0000-4000-8000-000000000002',WORK='a0000000-0000-4000-8000-000000000001';
const N=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const P=text=>({type:'paragraph',attrs:{style:'body2'},content:text?[{type:'text',text}]:[]});
const DOC=(...lines)=>({v:'ed1',doc:{type:'doc',content:lines.map(P)}});
const LINES=['☐ 예시: 병원 예약 날짜 다시 확인 (통화 10/1)','☐ 예시: 주말에 서류 챙기기 (텔레그램 10/2)','☐ 예시: 접종 날 오전에 같이 가기','☐ 예시: 생일 선물 미리 고르기','☐ 예시: 화분 물 주기 당번 바꾸기'];
const note=(n,over)=>({id:N(n),workspace_id:'w',kind:'note',title:`가짜 노트 ${n}`,attachments:[],created_at:'2026-10-01T00:00:00Z',archived_at:null,...over});
const LIST=(lines=LINES)=>note(2,{title:'잊지 말기',raw_text:lines.join('\n'),doc:DOC(...lines),updated_at:'2026-10-04T00:00:00Z',ai_export_allowed:false,metadata:{family_list:true,folder_id:FAM,folder:'가족'}});
const WORKNOTE=()=>note(1,{title:'가짜 업무 노트',raw_text:'업무 줄',doc:DOC('업무 줄'),updated_at:'2026-10-05T00:00:00Z',ai_export_allowed:true,metadata:{folder_id:WORK,folder:'01. 업무메모'}});
const FOLDERS=()=>[{id:WORK,parent_id:null,name:'01. 업무메모',sort_order:0,created_at:'2026-10-01T00:00:00Z'},{id:FAM,parent_id:null,name:'가족',sort_order:1,created_at:'2026-10-01T00:00:00Z'}];
const eqv=v=>v?.replace(/^eq\./,'');
const textOf=row=>(row?.doc?.doc?.content||[]).map(p=>(p.content||[]).map(c=>c.text).join(''));
const SHOTS='docs/design/screens/s60-19';

async function fixture(page,{width=412,rows=[WORKNOTE(),LIST()]}={}){
  await page.setViewportSize({width,height:860});
  const f={rows,remind:[],docPatches:[],posts:[]};
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&['/rest/v1/app_todo_candidates','/rest/v1/app_feed_items','/rest/v1/app_journal_memorable','/rest/v1/app_record_links','/rest/v1/app_note_comments'].includes(u.pathname),r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>r.fulfill({json:{ok:true,skipped:'fresh'}}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>r.fulfill({json:FOLDERS()}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      const hit=row=>(!q.get('kind')||row.kind===eqv(q.get('kind')))&&(!q.get('id')||row.id===eqv(q.get('id')))&&(!q.get('updated_at')||row.updated_at===eqv(q.get('updated_at')))
        &&(!q.get('ai_export_allowed')||String(row.ai_export_allowed)===q.get('ai_export_allowed').replace(/^is\./,''))
        &&(!q.get('metadata->>family_list')||row.metadata?.family_list===true)&&(!q.get('metadata->>family_past')||row.metadata?.family_past===true);
      if(req.method()==='POST'){const body=req.postDataJSON(),row={id:N(90+f.posts.length),attachments:[],archived_at:null,metadata:{},ai_export_allowed:true,...body,updated_at:'2026-10-06T01:00:00Z'};f.posts.push(body);rows.push(row);return r.fulfill({status:201,json:[row]});}
      if(req.method()==='PATCH'){
        const body=req.postDataJSON(),list=rows.filter(hit);
        if(body.metadata&&!('doc' in body))f.remind.push({query:Object.fromEntries(q),body});else f.docPatches.push({query:Object.fromEntries(q),body});
        list.forEach(row=>Object.assign(row,body,'doc' in body?{updated_at:`2026-10-06T01:0${f.docPatches.length}:00Z`}:{}));return r.fulfill({json:list});
      }
      const out=rows.filter(hit).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));
      return r.fulfill({json:q.get('limit')?out.slice(0,Number(q.get('limit'))):out});
    });
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  return f;
}
const box=page=>page.locator('#basketView [data-fam-remind]');
const shown=async page=>(await box(page).locator('.fam-remind-text').allTextContents());
// 화면 사진(docs/design/screens/s60-19)은 KPTU_SHOTS=1일 때만 다시 찍는다(CI는 찍지 않음).
const shot=async(page,name)=>{if(!process.env.KPTU_SHOTS)return;mkdirSync(SHOTS,{recursive:true});await page.screenshot({path:`${SHOTS}/${name}.png`});};

for(const width of [412,1280])test(`'가족 · 기억할 것' 3줄이 맨 위에, 본 기록은 서버(노트 metadata.remind), [↻ 다른 줄]은 다음 줄 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await expect(box(page)).toBeVisible();
  await expect(box(page).locator('.nbx-head')).toContainText('가족 · 기억할 것');
  await expect(box(page).locator('.nbx-head')).toContainText('3/5');
  expect(await shown(page)).toEqual(LINES.slice(0,3));
  // 칸은 잊지 말기 목록 위(맨 위), 화면 밖으로 넘치지 않음.
  const at=await page.evaluate(()=>({b:document.querySelector('#basketView [data-fam-remind]').getBoundingClientRect().bottom,l:document.querySelector('#basketView [data-forget-section]').getBoundingClientRect().top,sw:document.documentElement.scrollWidth,w:innerWidth}));
  expect(at.b).toBeLessThanOrEqual(at.l+1);expect(at.sw).toBeLessThanOrEqual(at.w);
  await expect.poll(()=>f.remind.length).toBe(1);
  const first=f.remind[0];
  expect(first.query).toMatchObject({id:`eq.${N(2)}`,kind:'eq.note'});
  expect(first.body.metadata).toMatchObject({family_list:true,folder_id:FAM,remind:{day:'2026-10-06'}});
  expect(first.body.metadata.remind.picks).toHaveLength(3);
  expect(Object.values(first.body.metadata.remind.seen)).toEqual(['2026-10-06','2026-10-06','2026-10-06']);
  expect(JSON.stringify(first.body.metadata.remind)).not.toContain('예시'); // 글은 저장하지 않고 열쇠만
  await shot(page,`home-${width}`);
  // 다시 들어와도 같은 날에는 같은 3줄(새로 쓰지 않음).
  await page.evaluate(()=>window.KPTURouter.go('home'));await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(box(page).locator('.fam-remind-text').first()).toHaveText(LINES[0]);
  expect(await shown(page)).toEqual(LINES.slice(0,3));
  await page.waitForTimeout(300);expect(f.remind.length).toBe(1);
  await box(page).locator('[data-fam-other]').click();
  await expect.poll(()=>shown(page)).toEqual([LINES[0],LINES[3],LINES[4]]);
  await expect.poll(()=>f.remind.length).toBe(2);
});

for(const width of [412,1280])test(`줄 ⋯ [과거 기록으로]: 같은 가족 폴더 '과거 기록' 노트(AI 제외)를 처음 만들고 '날짜 · 줄', 되돌리기는 제자리 ${width}`,async({page})=>{
  const f=await fixture(page,{width});
  await expect(box(page).locator('.fam-remind-text')).toHaveCount(3);
  // PC는 줄 우클릭도 같은 메뉴(공통 context-menu.js가 그 줄 ⋯을 연다), 폰은 ⋯.
  if(width>=761)await box(page).locator('.fam-remind-text').nth(1).click({button:'right'});
  else await box(page).locator('[data-fam-more]').nth(1).click();
  const menu=page.locator('#familyRemindMenu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('button')).toHaveText(['노트에서 보기','과거 기록으로']);
  await shot(page,`menu-${width}`);
  await menu.locator('[data-fam-menu="past"]').click();
  await expect.poll(()=>f.posts.length).toBe(1);
  expect(f.posts[0]).toMatchObject({kind:'note',title:'과거 기록',ai_export_allowed:false,metadata:{family_past:true,folder_id:FAM,folder:'가족'},raw_text:`10/6 · ${LINES[1]}`});
  expect(f.posts[0].metadata.family_list).toBeUndefined();
  // 잊지 말기 노트에서는 그 줄만 빠짐(가족 노트에만 쓰는 조건).
  expect(f.docPatches[0].query).toMatchObject({id:`eq.${N(2)}`,ai_export_allowed:'is.false',updated_at:'eq.2026-10-04T00:00:00Z'});
  expect(textOf(f.docPatches[0].body)).toEqual([LINES[0],...LINES.slice(2)]);
  const undo=page.locator('[data-undo-notice]');
  await expect(undo).toContainText('과거 기록으로 옮겼어요');
  await expect(box(page).locator('.nbx-head')).toContainText('/4');
  await expect(box(page).locator('.fam-remind-text',{hasText:LINES[1]})).toHaveCount(0);
  await shot(page,`moved-${width}`);
  await undo.locator('[data-undo-action]').click();
  await expect(undo).toContainText('되돌렸어요');
  const list=f.rows.find(r=>r.id===N(2)),past=f.rows.find(r=>r.id===N(90));
  expect(textOf(list)).toEqual(LINES);
  expect(textOf(past).filter(Boolean)).toEqual([]);
  expect(f.docPatches.every(p=>p.query.ai_export_allowed==='is.false')).toBe(true);
  await expect(box(page).locator('.nbx-head')).toContainText('/5');
});

test('이미 있는 같은 폴더 과거 기록 노트에는 끝에 더한다(새로 만들지 않음). 다른 폴더의 과거 기록 노트는 쓰지 않는다',async({page})=>{
  const other=note(7,{title:'과거 기록',raw_text:'',doc:DOC('예전 다른 폴더 줄'),updated_at:'2026-10-05T03:00:00Z',ai_export_allowed:false,metadata:{family_past:true,folder_id:WORK,folder:'01. 업무메모'}});
  const past=note(8,{title:'과거 기록',raw_text:'',doc:DOC('9/1 · 예전 옮긴 줄'),updated_at:'2026-10-03T00:00:00Z',ai_export_allowed:false,metadata:{family_past:true,folder_id:FAM,folder:'가족'}});
  const f=await fixture(page,{rows:[WORKNOTE(),LIST(),other,past]});
  await box(page).locator('[data-fam-more]').first().click();
  await page.locator('#familyRemindMenu [data-fam-menu="past"]').click();
  await expect(page.locator('[data-undo-notice]')).toContainText('과거 기록으로 옮겼어요');
  expect(f.posts).toEqual([]);
  const toPast=f.docPatches.find(p=>p.query.id===`eq.${N(8)}`);
  expect(toPast.query.ai_export_allowed).toBe('is.false');
  expect(textOf(toPast.body)).toEqual(['9/1 · 예전 옮긴 줄',`10/6 · ${LINES[0]}`]);
  expect(f.docPatches.some(p=>p.query.id===`eq.${N(7)}`)).toBe(false);
});

test('가족 노트가 없거나 비면 칸이 없다',async({page})=>{
  const f=await fixture(page,{rows:[WORKNOTE()]});
  await page.waitForTimeout(400);
  await expect(box(page)).toBeHidden();
  expect(f.remind).toEqual([]);
});

test('노트 화면: 가족 노트 ⋯ [줄 정리] → 줄 고르기 → 같은 메뉴 [과거 기록으로] (업무 노트 ⋯에는 없음)',async({page})=>{
  const f=await fixture(page,{width:1280});
  await box(page).locator('[data-fam-open]').click();
  const more=page.locator('#basketView [data-note-more]');
  await expect(more).toBeVisible();
  await more.click();
  await expect(page.locator('#noteDocMenu [data-note-remind-lines]')).toHaveText('줄 정리');
  await page.locator('#noteDocMenu [data-note-remind-lines]').click();
  const pick=page.locator('#familyRemindLines');
  await expect(pick.locator('[data-fam-pick]')).toHaveCount(5);
  await shot(page,'note-lines-1280');
  await pick.locator('[data-fam-pick]').nth(4).click();
  const menu=page.locator('#familyRemindMenu');
  await expect(menu.locator('button')).toHaveText(['과거 기록으로']);
  await menu.locator('[data-fam-menu="past"]').click();
  await expect(page.locator('[data-undo-notice]')).toContainText('과거 기록으로 옮겼어요');
  expect(textOf(f.rows.find(r=>r.id===N(2)))).toEqual(LINES.slice(0,4));
  expect(f.posts[0]).toMatchObject({title:'과거 기록',ai_export_allowed:false});
});

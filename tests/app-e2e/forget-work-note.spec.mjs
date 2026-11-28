// FORGET-업무노트(2026-11-28 사용자 결정 "가족 노트를 업무용으로 하나 더 만드는 거임" · "아예 업무 노트로·가정 노트로 나눠 달라"):
// - 잊지 말기 줄의 [노트로] 자리가 [업무 노트에]·[가족 노트에]. 고르기 창 없이 그 노트 맨 아래 '☐ 내용 (출처 날짜)' 한 줄, 그 줄은 목록에서 빠지고 되돌리기는 노트 줄까지.
// - 업무 노트가 아직 없으면 처음 한 번만 폴더를 고른다('업무 노트', metadata.work_list — 일반 노트, AI 설정을 보내지 않음). 그 뒤로는 고르지 않는다.
// - 맨 위 '업무 · 기억할 것' 3줄(가족 칸과 같은 부품) · [↻ 다른 줄] · 줄 ⋯ [과거 기록으로](같은 폴더 '과거 기록' 업무 노트, metadata.work_past) · 되돌리기.
// - 가족 기능이 없는 계정에는 [가족 노트에]가 없고 가족 표를 부르지 않는다. 가족 줄은 [가족 노트에]만(업무 노트로 보내지 않음, AI 제외 노트에만 씀).
// 서버는 흉내(PATCH는 id·updated_at·ai_export_allowed·family_list·work_list 조건을 지킴), 글·이름은 모두 지어낸 것. 폰 412 · PC 1280.
import {test,expect} from '@playwright/test';
import {folderSheet,pickInSheet} from './helpers/folder-sheet.mjs';
import {openHome} from './helpers/home-entry.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const famId='f0000000-0000-4000-8000-000000000001';
const WORK='a0000000-0000-4000-8000-000000000001',FAM='a0000000-0000-4000-8000-000000000002';
const N=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const P=text=>({type:'paragraph',attrs:{style:'body2'},content:text?[{type:'text',text}]:[]});
const DOC=(...lines)=>({v:'ed1',doc:{type:'doc',content:lines.map(P)}});
const note=(n,over)=>({id:N(n),workspace_id:'w',kind:'note',title:`가짜 노트 ${n}`,attachments:[],created_at:'2026-10-01T00:00:00Z',archived_at:null,...over});
const OTHER=()=>note(1,{title:'가짜 회의 정리',raw_text:'예전 줄',doc:DOC('예전 줄'),updated_at:'2026-10-05T00:00:00Z',ai_export_allowed:true,metadata:{folder_id:WORK,folder:'01. 업무메모'}});
const FAMLIST=()=>note(2,{title:'잊지 말기',raw_text:'☐ 지어낸 예전 가족 줄',doc:DOC('☐ 지어낸 예전 가족 줄'),updated_at:'2026-10-04T00:00:00Z',ai_export_allowed:false,metadata:{family_list:true,folder_id:FAM,folder:'가족'}});
const WLINES=['☐ 예시: 회의 자료 미리 보내기','☐ 예시: 견적 다시 받기','☐ 예시: 방문 일정 확인','☐ 예시: 서류 도장 받기','☐ 예시: 보고서 초안 돌리기'];
const WORKLIST=(lines=WLINES)=>note(3,{title:'업무 노트',raw_text:lines.join('\n'),doc:DOC(...lines),updated_at:'2026-10-03T00:00:00Z',ai_export_allowed:true,metadata:{work_list:true,folder_id:WORK,folder:'01. 업무메모'}});
const FOLDERS=()=>[{id:WORK,parent_id:null,name:'01. 업무메모',sort_order:0,created_at:'2026-10-01T00:00:00Z'},{id:FAM,parent_id:null,name:'가족',sort_order:1,created_at:'2026-10-01T00:00:00Z'}];
const cand=n=>({id:cid(n),kind:'request',summary:`가짜 요청 ${n}`,due:null,source_kind:'telegram',source_id:`d0000000-0000-4000-8000-00000000000${n}`,source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,task_due:null,created_at:`2026-10-06T0${n}:00:00Z`,decided_at:null});
const family=()=>[{id:famId,kind:'plan',body:'지어낸 약속 한 줄',said_when:null,firmness:'planned',origin:'telegram',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T00:30:00Z'}];
const eqv=v=>v?.replace(/^eq\./,'');
const textOf=row=>(row?.doc?.doc?.content||[]).map(p=>(p.content||[]).map(c=>c.text).join(''));

async function fixture(page,{width=412,features=['telegram'],rows=[OTHER()],cands=[cand(1),cand(2)]}={}){
  await page.setViewportSize({width,height:860});
  const fams=family(),f={rows,cands,famCalls:0,famPatches:[],candPatches:[],posts:[],docPatches:[],remind:[]};
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:features}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='PATCH'){const id=eqv(q.get('id')),body=req.postDataJSON(),row=cands.find(c=>c.id===id);f.candPatches.push({id,body});if(!row)return r.fulfill({json:[]});Object.assign(row,body);return r.fulfill({json:[{id,status:row.status,task_id:null,decided_at:row.decided_at}]});}
      return r.fulfill({json:q.get('status')==='eq.open'?cands.filter(c=>c.status==='open'):cands.filter(c=>c.status!=='open')});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_feedback',r=>r.request().method()==='POST'?r.fulfill({status:201,json:[{id:'e0000000-0000-4000-8000-000000000001'}]}):r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&['/rest/v1/app_feed_items','/rest/v1/app_journal_memorable','/rest/v1/app_record_links','/rest/v1/app_note_comments'].includes(u.pathname),r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>r.fulfill({json:{ok:true,skipped:'fresh'}}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',r=>{
      f.famCalls++;
      const req=r.request();
      if(req.method()==='PATCH'){const id=eqv(new URL(req.url()).searchParams.get('id')),body=req.postDataJSON();f.famPatches.push({id,body});Object.assign(fams.find(n=>n.id===id)||{},body);return r.fulfill({json:[{id}]});}
      return r.fulfill({json:fams.filter(n=>n.status==='new')});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',r=>r.fulfill({json:FOLDERS()}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      const hit=row=>(!q.get('kind')||row.kind===eqv(q.get('kind')))&&(!q.get('id')||row.id===eqv(q.get('id')))&&(!q.get('updated_at')||row.updated_at===eqv(q.get('updated_at')))
        &&(!q.get('ai_export_allowed')||String(row.ai_export_allowed)===q.get('ai_export_allowed').replace(/^is\./,''))
        &&['family_list','family_past','work_list','work_past'].every(k=>!q.get(`metadata->>${k}`)||row.metadata?.[k]===true);
      if(req.method()==='POST'){const body=req.postDataJSON(),row={id:N(90+f.posts.length),attachments:[],archived_at:null,metadata:{},ai_export_allowed:true,...body,updated_at:`2026-10-06T0${f.posts.length+1}:00:00Z`};f.posts.push(body);rows.push(row);return r.fulfill({status:201,json:[row]});}
      if(req.method()==='PATCH'){
        const body=req.postDataJSON(),list=rows.filter(hit);
        if(body.metadata&&!('doc' in body))f.remind.push({query:Object.fromEntries(q),body});else f.docPatches.push({query:Object.fromEntries(q),body});
        list.forEach(row=>Object.assign(row,body,'doc' in body?{updated_at:`2026-10-07T0${f.docPatches.length}:00:00Z`}:{}));return r.fulfill({json:list});
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
const line=(page,id)=>page.locator(`#basketView [data-nbx-row="${id}"]`);
const workBox=page=>page.locator('#basketView [data-work-remind]');
const undo=page=>page.locator('[data-undo-notice]');
// 화면 사진(docs/design/screens/forget-work-note)은 KPTU_SHOTS=1일 때만 찍는다(CI는 찍지 않음).
const shot=async(page,name)=>{if(!process.env.KPTU_SHOTS)return;const {mkdirSync}=await import('node:fs');mkdirSync('docs/design/screens/forget-work-note',{recursive:true});await page.screenshot({path:`docs/design/screens/forget-work-note/${name}.png`});};

for(const width of [412,1280])test(`가족 기능 없는 계정: [업무 노트에]만, 처음 한 번 폴더 고르기로 '업무 노트'를 만들고, 다음 줄은 고르기 없이 맨 아래에 · 되돌리기 ${width}`,async({page})=>{
  const f=await fixture(page,{width,features:[]});
  const row=line(page,`c:${cid(2)}`);
  await expect(row).toBeVisible();
  // 폰에서도 줄에 바로 보인다(⋯ 안에 접지 않음). 가족 쪽 버튼·가족 표 읽기는 없다.
  await expect(row.locator('[data-nbx-act="note-work"]')).toBeVisible();
  await expect(row.locator('[data-nbx-act="note-work"]')).toHaveText('업무 노트에');
  await expect(page.locator('#basketView [data-nbx-act="note-family"]')).toHaveCount(0);
  await expect(page.locator('#basketView [data-nbx-act="note"]')).toHaveCount(0);
  if(width<761)await expect(row.locator('.nbx-acts > button:visible')).toHaveText(['할 일로','업무 노트에','이미 함','⋯']);
  expect(f.famCalls).toBe(0);
  await expect(workBox(page)).toBeHidden(); // 업무 노트가 아직 없으면 칸 없음
  const sw=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);expect(sw).toBe(true);
  await row.locator('[data-nbx-act="note-work"]').click();
  await expect(folderSheet(page)).toBeVisible();
  await pickInSheet(page,['01. 업무메모']);
  await expect.poll(()=>f.posts.length).toBe(1);
  expect(f.posts[0]).toMatchObject({kind:'note',title:'업무 노트',raw_text:'☐ 가짜 요청 2 (텔레그램 · 10/6)',metadata:{work_list:true,folder_id:WORK,folder:'01. 업무메모'}});
  expect('ai_export_allowed' in f.posts[0]).toBe(false); // 일반 노트(AI 설정을 건드리지 않음)
  expect(f.posts[0].metadata.family_list).toBeUndefined();
  await expect(undo(page)).toContainText('업무 노트에 넣었어요');
  await expect(row).toHaveCount(0);
  await expect.poll(()=>f.candPatches.length).toBe(1);
  expect(f.candPatches[0]).toMatchObject({id:cid(2),body:{status:'done'}});
  // 맨 위 '업무 · 기억할 것' 칸에 그 줄.
  await expect(workBox(page)).toBeVisible();
  await expect(workBox(page).locator('.nbx-head')).toContainText('업무 · 기억할 것');
  await expect(workBox(page).locator('.fam-remind-text')).toHaveText(['☐ 가짜 요청 2 (텔레그램 · 10/6)']);
  // 두 번째 줄: 고르기 창 없이 같은 노트 맨 아래(가족 노트 조건 없이).
  await line(page,`c:${cid(1)}`).locator('[data-nbx-act="note-work"]').click();
  await expect.poll(()=>f.docPatches.length).toBe(1);
  await expect(folderSheet(page)).toHaveCount(0);
  expect(f.posts).toHaveLength(1);
  expect(f.docPatches[0].query).toMatchObject({id:`eq.${N(90)}`,kind:'eq.note'});
  expect(f.docPatches[0].query.ai_export_allowed).toBeUndefined();
  expect(textOf(f.rows.find(r=>r.id===N(90)))).toEqual(['☐ 가짜 요청 2 (텔레그램 · 10/6)','☐ 가짜 요청 1 (텔레그램 · 10/6)']);
  // 되돌리기: 줄이 목록에 돌아오고 노트의 그 줄만 빠진다.
  await undo(page).locator('[data-undo-action]').click();
  await expect(undo(page)).toContainText('노트에서 빼고 다시 보이게 했어요');
  await expect(line(page,`c:${cid(1)}`)).toBeVisible();
  expect(textOf(f.rows.find(r=>r.id===N(90)))).toEqual(['☐ 가짜 요청 2 (텔레그램 · 10/6)']);
});

test('폴더 고르기를 닫으면 아무것도 쓰지 않고 줄은 그대로',async({page})=>{
  const f=await fixture(page,{features:[]});
  await line(page,`c:${cid(1)}`).locator('[data-nbx-act="note-work"]').click();
  await expect(folderSheet(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(folderSheet(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(f.posts).toHaveLength(0);expect(f.candPatches).toHaveLength(0);
  await expect(line(page,`c:${cid(1)}`)).toBeVisible();
  await expect(line(page,`c:${cid(1)}`).locator('[data-nbx-act="note-work"]')).toBeEnabled();
});

for(const width of [412,1280])test(`가족 기능 계정: 가족 줄은 [가족 노트에]만 — 가족 '잊지 말기' 노트 맨 아래(AI 제외 노트에만), 업무 줄은 두 갈래 ${width}`,async({page})=>{
  const f=await fixture(page,{width,features:['telegram','family'],rows:[OTHER(),FAMLIST(),WORKLIST()]});
  const fam=line(page,`f:${famId}`);
  await expect(fam).toBeVisible();
  await expect(fam.locator('[data-nbx-act="note-work"]')).toHaveCount(0);
  await expect(fam.locator('[data-nbx-act="note-family"]')).toBeVisible();
  await expect(line(page,`c:${cid(1)}`).locator('[data-nbx-act="note-work"],[data-nbx-act="note-family"]')).toHaveText(['업무 노트에','가족 노트에']);
  if(width<761)await expect(fam.locator('.nbx-acts > button:visible')).toHaveText(['할 일로','가족 노트에','이미 함','⋯']);
  if(width>=761)await line(page,`c:${cid(1)}`).locator('.nbx-body').hover();
  await shot(page,`rows-${width}`);
  await fam.locator('[data-nbx-act="note-family"]').click();
  await expect.poll(()=>f.docPatches.length).toBe(1);
  expect(f.docPatches[0].query).toMatchObject({id:`eq.${N(2)}`,ai_export_allowed:'is.false'});
  expect(textOf(f.rows.find(r=>r.id===N(2)))).toEqual(['☐ 지어낸 예전 가족 줄','☐ 지어낸 약속 한 줄 (텔레그램 10/5)']);
  await expect.poll(()=>f.famPatches.length).toBe(1);
  expect(f.famPatches[0]).toMatchObject({id:famId,body:{status:'kept'}});
  await expect(undo(page)).toContainText('가족 노트에 넣었어요');
  await expect(fam).toHaveCount(0);
  // 업무 줄 [가족 노트에]도 같은 가족 노트 맨 아래.
  await line(page,`c:${cid(1)}`).locator('[data-nbx-act="note-family"]').click();
  await expect.poll(()=>f.docPatches.length).toBe(2);
  expect(f.docPatches[1].query).toMatchObject({id:`eq.${N(2)}`,ai_export_allowed:'is.false'});
  expect(f.posts).toHaveLength(0);
  // 두 칸이 함께: 가족 위, 업무 아래. 업무 칸은 3/5.
  await expect(page.locator('#basketView [data-fam-remind] .nbx-head')).toContainText('가족 · 기억할 것');
  await expect(workBox(page).locator('.nbx-head')).toContainText('3/5');
  await shot(page,`two-boxes-${width}`);
});

for(const width of [412,1280])test(`'업무 · 기억할 것' 3줄 · [↻ 다른 줄] · ⋯ [과거 기록으로]는 같은 폴더 업무 '과거 기록' 노트(일반 노트), 되돌리기는 제자리 ${width}`,async({page})=>{
  const f=await fixture(page,{width,features:[],rows:[OTHER(),WORKLIST()]});
  await expect(workBox(page).locator('.fam-remind-text')).toHaveText(WLINES.slice(0,3));
  await expect(workBox(page).locator('.nbx-head')).toContainText('3/5');
  await expect.poll(()=>f.remind.length).toBe(1);
  expect(f.remind[0].body.metadata).toMatchObject({work_list:true,remind:{day:'2026-10-06'}});
  expect(f.remind[0].query.ai_export_allowed).toBeUndefined();
  await workBox(page).locator('[data-fam-other]').click();
  await expect.poll(()=>workBox(page).locator('.fam-remind-text').allTextContents()).toEqual([WLINES[0],WLINES[3],WLINES[4]]);
  await workBox(page).locator('[data-fam-more]').nth(1).click();
  const menu=page.locator('#familyRemindMenu');
  await expect(menu.locator('button')).toHaveText(['노트에서 보기','과거 기록으로']);
  await menu.locator('[data-fam-menu="past"]').click();
  await expect.poll(()=>f.posts.length).toBe(1);
  expect(f.posts[0]).toMatchObject({kind:'note',title:'과거 기록',metadata:{work_past:true,folder_id:WORK,folder:'01. 업무메모'},raw_text:`10/6 · ${WLINES[3]}`});
  expect('ai_export_allowed' in f.posts[0]).toBe(false);
  expect(f.posts[0].metadata.family_past).toBeUndefined();
  expect(f.docPatches[0].query).toMatchObject({id:`eq.${N(3)}`});
  expect(f.docPatches[0].query.ai_export_allowed).toBeUndefined();
  await expect(undo(page)).toContainText('과거 기록으로 옮겼어요');
  await expect(workBox(page).locator('.nbx-head')).toContainText('/4');
  await undo(page).locator('[data-undo-action]').click();
  await expect(undo(page)).toContainText('되돌렸어요');
  expect(textOf(f.rows.find(r=>r.id===N(3)))).toEqual(WLINES);
  await expect(workBox(page).locator('.nbx-head')).toContainText('/5');
  // 가족 칸은 없다(가족 노트 없음).
  await expect(page.locator('#basketView [data-fam-remind]')).toBeHidden();
});

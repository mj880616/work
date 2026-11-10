// FAMILY-잊지말기 4단계 + S51-26 FAMILY-노트로 → S52-20 HOME-잊지말기한목록 ②(시안 docs/design/mockups/forget-one-list.html):
// 가족 '잊지 말기' 제안은 홈 칸이 아니라 정리함(잊지 말기) 한 목록의 같은 줄(꼬리표 '가족')이다. 홈에는 '잊지 말기' 한 줄 + 숫자만.
// - 운영자 기능 family가 있을 때만 읽고 보인다(서버 app_my_features). 줄마다 [할 일로][일정으로][노트로][이미 함] ×. [기억만]·[기억] 없음.
// - S51-30 [이미 함]: 창 없이 '잊지 말기' 노트에 '☑ 내용 (출처 날짜)' 한 줄을 더하고 제안에서 뺀다(할 일·일정 없음). 되돌리면 제안이 돌아오고 그 줄도 빠진다.
// - [노트로] → 노트 창(FORGET-노트고르기: 처음 '잊지 말기 ▾'·'가족 ▾', 다른 가족 노트나 새 노트도 고름) → [저장]해야 노트에 '☐ 내용 (출처 날짜)' 한 줄이 생기고 제안에서 빠진다.
// - 상태 칸(status·decided_at·updated_at)만 고친다. 노트는 기존 노트 저장 길(app_notes). 서버는 흉내, 글은 모두 지어낸 것.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {pressRowAct} from './helpers/nbx-act.mjs';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const id=n=>`f0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const FOLDER='a0000000-0000-4000-8000-000000000001',LIST='b0000000-0000-4000-8000-000000000001';
const NOTES=()=>[
  {id:id(1),kind:'plan',body:'토요일 저녁에 동네 산책 가자고 함',said_when:'토요일 저녁',firmness:'planned',origin:'telegram',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T00:10:00Z'},
  {id:id(2),kind:'like',body:'<b>새로 생긴 빵집</b> 소금빵이 맛있었다고 함',said_when:null,firmness:'firm',origin:'call',origin_day:'2026-10-05',status:'new',created_at:'2026-10-06T00:05:00Z'},
];
const LIST_DOC={v:'ed1',doc:{type:'doc',content:[{type:'paragraph',attrs:{style:'body2'},content:[{type:'text',text:'☐ 예전 줄 (통화 10/1)'}]}]}};

async function fixture(page,{features=['calls','telegram','family'],notes=NOTES(),width=390,folders=[{id:FOLDER,parent_id:null,name:'가족',sort_order:0,created_at:'2026-10-01T00:00:00Z'}],lists=[]}={}){
  await page.setViewportSize({width,height:860});
  const patches=[],reads=[],notePosts=[],notePatches=[],folderPosts=[];
  const noteRows=new Map(lists.map(l=>[l.id,{...l}]));
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:features}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='PATCH'){
        const nid=q.get('id').replace(/^eq\./,''),body=req.postDataJSON();patches.push({id:nid,body});
        const row=notes.find(n=>n.id===nid);Object.assign(row,body);return r.fulfill({json:[{id:nid}]});
      }
      reads.push(Object.fromEntries(q));
      return r.fulfill({json:notes.filter(n=>n.status==='new')});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_note_folders',async r=>{
      const req=r.request();
      if(req.method()==='POST'){const body=req.postDataJSON();folderPosts.push(body);const row={id:'a0000000-0000-4000-8000-000000000009',...body,created_at:'2026-10-06T01:00:00Z'};folders.push(row);return r.fulfill({status:201,json:[row]});}
      return r.fulfill({json:folders});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',async r=>{
      const req=r.request(),q=new URL(req.url()).searchParams;
      if(req.method()==='POST'){const body=req.postDataJSON();notePosts.push(body);return r.fulfill({status:201,json:[{id:'c0000000-0000-4000-8000-000000000001',...body,updated_at:'2026-10-06T01:00:00Z'}]});}
      if(req.method()==='PATCH'){
        const nid=q.get('id').replace(/^eq\./,''),body=req.postDataJSON();notePatches.push({id:nid,query:Object.fromEntries(q),body});
        const row=noteRows.get(nid);Object.assign(row,body);return r.fulfill({json:[row]});
      }
      if(q.get('metadata->>family_list')==='eq.true')return r.fulfill({json:[...noteRows.values()].map(({id,updated_at,metadata})=>({id,updated_at,metadata}))});
      const nid=(q.get('id')||'').replace(/^eq\./,'');
      if(nid)return r.fulfill({json:noteRows.has(nid)?[noteRows.get(nid)]:[]});
      return r.fulfill({json:[]});
    });
  }});
  await expect(page.locator('#homeView [data-home-summary]')).toBeVisible();
  await page.evaluate(()=>window.KPTURouter.go('basket'));
  await expect(page.locator('#basketView [data-forget-section]')).toBeVisible();
  return {patches,reads,notes,notePosts,notePatches,folderPosts};
}
const box=page=>page.locator('#basketView [data-forget-section]');
const undo=page=>page.locator('[data-undo-notice] [data-undo-action]');
const win=page=>page.locator('#edWindow');

test('운영자 기능 family가 없으면 가족 줄도 표 읽기도 없다',async({page})=>{
  const {reads}=await fixture(page,{features:['calls','telegram']});
  await page.waitForTimeout(300);
  await expect(box(page).locator('[data-forget-src="family"]')).toHaveCount(0);
  expect(reads).toEqual([]);
});

test('한 목록의 가족 줄: [할 일로][일정으로][노트로][이미 함] ×, 예정만 작은 글자, [기억만]·[기억] 없음, 글은 글자로만',async({page})=>{
  const {reads}=await fixture(page);
  await expect(box(page).locator('[data-forget-src="family"]')).toHaveCount(2);
  expect(reads[0]).toMatchObject({status:'eq.new',select:'id,kind,body,said_when,firmness,origin,origin_day,status,created_at'});
  await expect(box(page).locator('details,summary,[data-nbx-act="kept"]')).toHaveCount(0);
  await expect(box(page)).not.toContainText('기억만');
  const first=box(page).locator(`[data-nbx-row="f:${id(1)}"]`);
  await expect(first.locator('.nbx-tag')).toHaveText('예정');
  await expect(first.locator('.nbx-meta')).toHaveText('가족말한 때: 토요일 저녁 · 텔레그램 · 10/5');
  await expect(first.locator('.nbx-acts button')).toHaveText(['할 일로','일정으로','노트로','이미 함','×','⋯']);
  // UI-잊지말기줄단추: 폰은 [할 일로][이미 함] ⋯ 만 보이고, 나머지는 ⋯ 메뉴 안에 같은 이름(가족 줄은 조직·사업 없음).
  await expect(first.locator('.nbx-acts button:visible')).toHaveText(['할 일로','이미 함','⋯']);
  const second=box(page).locator(`[data-nbx-row="f:${id(2)}"]`);
  await expect(second.locator('.nbx-tag')).toHaveCount(0);
  await expect(second.locator('b')).toHaveCount(0);
  await expect(second).toContainText('<b>새로 생긴 빵집</b>');
  // 폰 폭: 버튼은 작은 줄 오른쪽 한 줄, 가로 넘침 없음.
  const mids=await first.locator('.nbx-acts button:visible').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return r.top+r.height/2;}));
  expect(Math.max(...mids)-Math.min(...mids)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('접은 폰 폭(344): 버튼 다섯 개가 한 줄(공용 줄 버튼), 가로 넘침 없음',async({page})=>{
  await fixture(page,{width:344});
  const first=box(page).locator(`[data-nbx-row="f:${id(1)}"]`);
  await expect(first.locator('.nbx-acts button')).toHaveCount(5);
  const mids=await first.locator('.nbx-acts button:visible').evaluateAll(bs=>bs.map(b=>{const r=b.getBoundingClientRect();return r.top+r.height/2;}));
  expect(Math.max(...mids)-Math.min(...mids)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('제안이 없으면 가족 줄이 없다(빈 칸·안내 없음)',async({page})=>{
  await fixture(page,{notes:[]});
  await expect(box(page)).toBeVisible();
  await expect(box(page).locator('[data-forget-src="family"]')).toHaveCount(0);
});

test('[×](5초 되돌리기): 상태 칸만 수정한다',async({page})=>{
  const {patches}=await fixture(page);
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${id(1)}"]`),'dismissed');
  await expect.poll(()=>patches.length).toBe(1);
  expect(Object.keys(patches[0].body).sort()).toEqual(['decided_at','status','updated_at']);
  expect(patches[0]).toMatchObject({id:id(1),body:{status:'dismissed'}});
  await expect(box(page).locator(`[data-nbx-row="f:${id(1)}"]`)).toHaveCount(0);
  await undo(page).click();
  await expect.poll(()=>patches.length).toBe(2);
  expect(patches[1]).toMatchObject({id:id(1),body:{status:'new',decided_at:null}});
  await expect(box(page).locator(`[data-nbx-row="f:${id(1)}"]`)).toBeVisible();
});

test('[할 일로]: 할 일 창에 제목만 채워 열고, 저장 전에는 상태를 바꾸지 않는다',async({page})=>{
  const {patches}=await fixture(page,{width:1280});
  await box(page).locator(`[data-nbx-row="f:${id(1)}"] [data-nbx-act="task"]`).click();
  await expect(page.locator('#gtTaskModal')).toBeVisible();
  await expect(page.locator('#gtEditTitle')).toHaveValue('토요일 저녁에 동네 산책 가자고 함');
  await expect(page.locator('#gtEditNotes')).toHaveValue('말한 때: 토요일 저녁');
  await page.waitForTimeout(200);
  expect(patches).toEqual([]);
});

// FORGET-노트고르기(요청함 11/09 13:34): [노트로]는 업무 줄과 같은 노트 창(옛 작은 '노트로 보내기' 창은 없앰). '잊지 말기 ▾'·'가족 ▾'가 골라진 채 열리고 [저장] 한 번이면 지금과 같다.
test('[노트로]: 가족 폴더의 잊지 말기 노트에 체크 한 줄을 더하고(읽은 판·가족 노트일 때만), 제안에서 뺀다. 닫으면 아무것도 안 쓴다',async({page})=>{
  const lists=[{id:LIST,title:'잊지 말기',doc:LIST_DOC,raw_text:'☐ 예전 줄 (통화 10/1)',updated_at:'2026-10-05T00:00:00Z',ai_export_allowed:false,metadata:{family_list:true,folder_id:FOLDER,folder:'가족'}}];
  const {patches,notePatches,notePosts}=await fixture(page,{lists});
  // 먼저 열었다 닫기: 쓰기 없음.
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${id(2)}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await expect(win(page)).toBeVisible();
  // 줄 글이 미리 채워진 새 글 창이라 닫을 때 한 번 묻는다(기존 노트 창 규칙 그대로) → '저장하지 않고 닫기'.
  await win(page).locator('[data-edw-cancel]').click();
  await page.getByRole('button',{name:'저장하지 않고 닫기'}).click();
  await expect(win(page)).toHaveCount(0);
  expect(notePatches.length+notePosts.length+patches.length).toBe(0);
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${id(2)}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await expect(win(page).locator('.ProseMirror')).toHaveText('☐ <b>새로 생긴 빵집</b> 소금빵이 맛있었다고 함 (통화 10/5)');
  await expect(win(page).locator('[data-edw-target]')).toHaveText('잊지 말기 ▾');
  await expect(win(page).locator('[data-edw-folder]')).toHaveText('가족 ▾');
  await win(page).locator('[data-edw-save]').click();
  await expect(win(page)).toHaveCount(0);
  await expect.poll(()=>patches.length).toBe(1);
  expect(patches[0]).toMatchObject({id:id(2),body:{status:'kept'}});
  expect(notePosts).toEqual([]);
  expect(notePatches).toHaveLength(1);
  expect(notePatches[0].query).toMatchObject({updated_at:'eq.2026-10-05T00:00:00Z',kind:'eq.note',ai_export_allowed:'is.false'});
  const texts=notePatches[0].body.doc.doc.content.map(p=>p.content?.[0]?.text);
  expect(texts).toEqual(['☐ 예전 줄 (통화 10/1)','☐ <b>새로 생긴 빵집</b> 소금빵이 맛있었다고 함 (통화 10/5)']);
  expect(notePatches[0].body.raw_text).toBe('☐ 예전 줄 (통화 10/1)\n\n☐ <b>새로 생긴 빵집</b> 소금빵이 맛있었다고 함 (통화 10/5)');
  expect(Object.keys(notePatches[0].body).sort()).toEqual(['doc','raw_text','title','updated_at']);
  await expect(box(page).locator(`[data-nbx-row="f:${id(2)}"]`)).toHaveCount(0);
  await expect(page.locator('#basketView [data-forget-status]')).toContainText("'가족' 폴더 노트에 넣었어요");
});

test('[노트로]: 가족 폴더·잊지 말기 노트가 없으면 만들어 넣는다. [＋ 새 노트로]는 표시 없이 그 줄 제목으로',async({page})=>{
  const {patches,notePosts,folderPosts}=await fixture(page,{folders:[]});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${id(1)}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await expect(win(page).locator('[data-edw-folder]')).toHaveText('가족 ▾');
  await win(page).locator('[data-edw-save]').click();
  await expect.poll(()=>patches.length).toBe(1);
  expect(folderPosts).toHaveLength(1);
  expect(folderPosts[0]).toMatchObject({name:'가족',parent_id:null});
  expect(notePosts).toHaveLength(1);
  expect(notePosts[0]).toMatchObject({kind:'note',title:'잊지 말기',ai_export_allowed:false,raw_text:'☐ 토요일 저녁에 동네 산책 가자고 함 (텔레그램 10/5 · 말한 때: 토요일 저녁)',
    metadata:{family_list:true,folder:'가족',folder_id:'a0000000-0000-4000-8000-000000000009'}});
  await pressRowAct(page,box(page).locator(`[data-nbx-row="f:${id(2)}"]`),'note');
  await page.locator("[data-nq-big]").click(); // FORGET-노트작은창: 작은 창에서 [크게 수정 ↗]로 큰 창
  await expect(win(page).locator('[data-edw-folder]')).toHaveText('가족 ▾');
  await win(page).locator('[data-edw-target]').click();
  await page.locator('[data-note-pick] [data-np-new]').click();
  await expect(win(page).locator('[data-edw-target]')).toHaveText('새 노트 ▾');
  await win(page).locator('[data-edw-save]').click();
  await expect.poll(()=>notePosts.length).toBe(2);
  expect(notePosts[1]).toMatchObject({title:'<b>새로 생긴 빵집</b> 소금빵이 맛있었다고 함',ai_export_allowed:false});
  expect(notePosts[1].metadata.family_list).toBeUndefined();
  expect(folderPosts).toHaveLength(1);
});

test('[이미 함]: 창 없이 잊지 말기 노트에 체크된 줄(☑)을 더하고 제안에서 뺀다. 할 일·일정은 안 만든다. 되돌리면 그 줄도 뺀다',async({page})=>{
  const lists=[{id:LIST,title:'잊지 말기',doc:LIST_DOC,raw_text:'☐ 예전 줄 (통화 10/1)',updated_at:'2026-10-05T00:00:00Z',ai_export_allowed:false,metadata:{family_list:true,folder_id:FOLDER,folder:'가족'}}];
  const {patches,notePatches,notePosts}=await fixture(page,{lists});
  await box(page).locator(`[data-nbx-row="f:${id(2)}"] [data-nbx-act="done"]`).click();
  await expect.poll(()=>patches.length).toBe(1);
  expect(patches[0]).toMatchObject({id:id(2),body:{status:'kept'}});
  await expect(win(page)).toHaveCount(0);
  await expect(page.locator('#gtTaskModal')).toBeHidden();
  expect(notePosts).toEqual([]);
  expect(notePatches).toHaveLength(1);
  expect(notePatches[0].query).toMatchObject({updated_at:'eq.2026-10-05T00:00:00Z',kind:'eq.note'});
  const texts=notePatches[0].body.doc.doc.content.map(p=>p.content?.[0]?.text);
  expect(texts).toEqual(['☐ 예전 줄 (통화 10/1)','☑ <b>새로 생긴 빵집</b> 소금빵이 맛있었다고 함 (통화 10/5)']);
  await expect(box(page).locator(`[data-nbx-row="f:${id(2)}"]`)).toHaveCount(0);
  await expect(page.locator('[data-undo-notice]')).toContainText('이미 한 일로 표시함');
  // 되돌리기: 제안이 돌아오고, 노트에 더한 그 줄 하나만 빠진다(읽은 판일 때만).
  await undo(page).click();
  await expect.poll(()=>notePatches.length).toBe(2);
  expect(patches[1]).toMatchObject({id:id(2),body:{status:'new',decided_at:null}});
  expect(notePatches[1].body.doc.doc.content.map(p=>p.content?.[0]?.text)).toEqual(['☐ 예전 줄 (통화 10/1)']);
  await expect(box(page).locator(`[data-nbx-row="f:${id(2)}"]`)).toBeVisible();
  await expect(page.locator('[data-undo-notice]')).toContainText('되돌렸어요');
});

test('[이미 함]: 잊지 말기 노트가 없으면 가족 폴더에 만들어 체크된 줄로 넣는다',async({page})=>{
  const {patches,notePosts}=await fixture(page);
  await box(page).locator(`[data-nbx-row="f:${id(1)}"] [data-nbx-act="done"]`).click();
  await expect.poll(()=>patches.length).toBe(1);
  expect(notePosts).toHaveLength(1);
  expect(notePosts[0]).toMatchObject({kind:'note',title:'잊지 말기',ai_export_allowed:false,raw_text:'☑ 토요일 저녁에 동네 산책 가자고 함 (텔레그램 10/5 · 말한 때: 토요일 저녁)',
    metadata:{family_list:true,folder:'가족',folder_id:FOLDER}});
});

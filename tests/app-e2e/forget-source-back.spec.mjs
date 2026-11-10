// S56-10 FORGET-원문열기·뒤로가기: 잊지 말기(정리함) 소식 줄 → 근거 원문(통화) → 뒤로가기 한 번 → 잊지 말기 같은 보기·거르기·스크롤 자리.
// 폰은 통화 상세가 router layer라 예전에는 뒤로가기를 두 번 눌러야 했다(목록 → 잊지 말기). 라우터 openFrom 한 길로 한 번에 돌아온다.
// 서버는 모두 흉내이고 이름·글은 지어낸 것이다.
import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test.use({hasTouch:true});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const callId=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const nid=n=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const N=24;
const pad=n=>String(n).padStart(2,'0');
const calls=()=>Array.from({length:N},(_,i)=>({workspace_id:'w',drive_url:null,pinned_at:null,hidden_at:null,archived_at:null,project_id:null,updated_at:'2026-10-06T00:00:00Z',
  id:callId(i+1),source:'call',day:'2026-10-06',occurred_at:`2026-10-05T${pad(Math.floor(i/2))}:${pad((i%2)*30)}:00Z`,room_key:null,room_label:null,title:`가상 통화 ${i+1}`,summary:null,
  points:[`가상 내용 ${i+1}`],counterpart:null,speaker_split:false,raw_count:0,organization_id:null,raw_text:`가상 전사 ${i+1}`}));
const news=()=>Array.from({length:N},(_,i)=>({id:nid(i+1),day:'2026-10-06',source:'call',feed_item_id:callId(i+1),org_name:null,line:`가상 소식 ${i+1}`,status:'suggested',final_line:null,
  picked_at:`2026-10-06T00:${pad(i)}:00Z`,decided_at:null,app_journal_memorable_picks:{kind:'task',reason:'할 일'}}));

async function fixture(page,{width}){
  await page.setViewportSize({width,height:800});
  const items=calls(),rows=news();
  await openHome(page,{beforeLoad:async()=>{
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_my_features',r=>r.fulfill({json:['calls','telegram']}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_candidates',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_todo_feedback',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_family_notes',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_notes',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_record_links',r=>r.fulfill({json:[]}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_journal_memorable',r=>r.fulfill({json:rows}));
    await page.route(u=>u.origin===SB&&u.pathname==='/functions/v1/ai-assist',r=>r.fulfill({json:{ok:true,kind:'journal_memorable',skipped:'fresh'}}));
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/app_feed_items',r=>{
      const q=new URL(r.request().url()).searchParams,eq=k=>q.get(k)?.startsWith('eq.')?decodeURIComponent(q.get(k).slice(3)):null;
      if(Number(q.get('offset')||0))return r.fulfill({json:[]});
      let out=items;
      if(eq('id'))out=out.filter(x=>x.id===eq('id'));
      if(eq('source'))out=out.filter(x=>x.source===eq('source'));
      const fields=(q.get('select')||'').split(',');
      return r.fulfill({json:out.map(x=>Object.fromEntries(fields.map(f=>[f,x[f]])))});
    });
    await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/rpc/app_feed_room_day_lines',r=>r.fulfill({json:[]}));
    for(const t of ['app_call_personal','app_call_edits','app_feed_days','app_suborganizations','app_suborganization_assignees','app_suborganization_updates'])
      await page.route(u=>u.origin===SB&&u.pathname==='/rest/v1/'+t,r=>r.fulfill({json:[]}));
  }});
  await page.evaluate(()=>window.KPTURouter.go('basket',{source:'delegated'}));
  await expect(page.locator('#basketView [data-nbx-row]').first()).toBeVisible();
}
const row=(page,n)=>page.locator(`#basketView [data-nbx-row="n:${nid(n)}"]`);
async function pickSource(page,label){
  await page.locator('#basketView [data-forget-view-open]').click();
  await page.locator('#forgetViewMenu').getByRole('menuitemradio',{name:label,exact:true}).click();
}
// 뒤로가기: 폰은 안드로이드 앱과 같은 KPTURouter.back(), PC는 브라우저 뒤로.
const back=(page,width)=>width<761?page.evaluate(()=>window.KPTURouter.back()):page.goBack();

for(const width of [412,1280]){
  test(`${width}: 소식 줄 출처 › → 통화 원문, 뒤로가기 한 번 → 잊지 말기 같은 거르기·같은 자리`,async({page})=>{
    await fixture(page,{width});
    await pickSource(page,'소식');
    await expect(page.locator('#basketView [data-forget-view-open]')).toHaveText('처리 전 · 소식 ▾');
    // 원문이 있는 줄은 출처 꼬리표 줄 끝에 작은 ›(눌러도 열림).
    const target=row(page,4); // 새 것이 위라 4번째는 목록 아래쪽
    await expect(target.locator('.nbx-meta-open')).toHaveText(/^소식 · 통화.*›$/);
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(()=>window.scrollBy(0,-120));
    const y=await page.evaluate(()=>Math.round(scrollY));
    expect(y).toBeGreaterThan(100);
    if(width<761)await target.locator('.nbx-meta-open').tap();else await target.locator('.nbx-meta-open').click();
    await expect(page.locator('#callsView')).toBeVisible();
    await expect(page.locator(`#cfDetail [data-cf-detail="${callId(4)}"]`)).toBeVisible();
    // 원문 줄은 잠깐 밝게 표시된다(record-flash.js).
    await expect(page.locator(`#cfDetail [data-cf-detail="${callId(4)}"][data-journal-flash]`)).toHaveCount(1);
    await back(page,width);
    await expect(page.locator('#basketView')).toBeVisible();
    await expect(page.locator('#callsView')).toBeHidden();
    await expect(page.locator('#basketView [data-forget-view-open]')).toHaveText('처리 전 · 소식 ▾');
    await expect.poll(()=>page.evaluate(()=>Math.round(scrollY))).toBe(y);
    await expect(target).toBeInViewport();
  });
}

test('412: 원문 화면의 ‹(화면 뒤로)도 한 번에 잊지 말기로',async({page})=>{
  await fixture(page,{width:412});
  const at=await page.evaluate(()=>navigation.currentEntry.index);
  await row(page,3).locator('.nbx-body-btn').tap();
  await expect(page.locator(`#cfDetail [data-cf-detail="${callId(3)}"]`)).toBeVisible();
  await page.locator('#cfDetail [data-cf-back]').tap();
  await expect(page.locator('#basketView')).toBeVisible();
  await expect(row(page,3)).toBeVisible();
  // 잊지 말기의 기록 칸 그대로(원문 쪽 기록 칸은 하나뿐이었다).
  await expect.poll(()=>page.evaluate(()=>navigation.currentEntry.index)).toBe(at);
});

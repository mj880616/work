import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
import {basketKindButton,basketPaneButton} from './helpers/basket-kind.mjs';

// INBOX-상대약속: 정리함 [챙길 것] shows the counterpart promise the radar's finding returned, with [원장으로] (same text as the PC home card's
// [원장으로 복사]). It is not counted in [챙길 것 n] and nothing is written. Supabase REST and ai-assist are the only synthetic parts.
test.use({hasTouch:true,permissions:['clipboard-read','clipboard-write']});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co',SRC='c0000000-0000-4000-8000-000000000101';
const cand={id:'c0000000-0000-4000-8000-000000000001',kind:'request',summary:'합성 챙길 것 하나',due:null,source_kind:'basket',source_id:SRC,source_day:'2026-10-06',evidence:'근거',project_id:null,organization_id:null,status:'open',task_id:null,decided_at:null,created_at:'2026-10-06T01:00:00Z'};
const promise={summary:'상대 측 자료 송부 약속',due:'2026-10-10',evidence:'보내기로 함',source_kind:'meeting',source_id:'c0000000-0000-4000-8000-000000000050',source_day:'2026-10-05'};

for(const width of [390,1280])test(`상대 약속 줄 and [원장으로] in 정리함 [챙길 것] ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await openHome(page);
 const errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error'&&!/Failed to load resource|net::ERR_FAILED/.test(e.text()))errors.push(e.text());});
 await page.route(SB+'/rest/v1/app_todo_candidates*',async route=>{
  const m=route.request().method();
  if(m==='GET'){const st=new URL(route.request().url()).searchParams.get('status')||'';return route.fulfill({json:st.startsWith('in.')?[]:[cand]});}
  writes.push(m);return route.fulfill({status:403,json:{message:'시험에서 막음'}});
 });
 await page.route(SB+'/functions/v1/ai-assist',async route=>{
  if(route.request().method()!=='POST')return route.fulfill({status:204});
  return route.fulfill({json:{ok:true,kind:'todo_radar',added:0,found:0,partial:false,checked_at:'2026-10-06T01:00:00Z',promises:[promise]}});
 });
 await page.reload();await expect(page.locator('#appView')).toHaveClass(/kptu-ui-ready/,{timeout:20000});
 await basketKindButton(page,'memo').click();
 await expect(page.locator('#basketView')).toBeVisible();
 await basketPaneButton(page,'todo').click();
 const row=page.locator('#basketView [data-inbox-promise]');
 await expect(row).toHaveCount(1);
 await expect(row).toContainText('상대 약속');await expect(row).toContainText('상대 측 자료 송부 약속');
 await expect(row.getByRole('button',{name:'할 일로'})).toHaveCount(0);
 // Not counted: one candidate, one promise, the number is 1.
 await expect(basketPaneButton(page,'todo')).toContainText('1');
 await expect(page.locator('#basketView [data-inbox-chip="open"]')).toContainText('1');
 await row.getByRole('button',{name:'원장으로'}).click();
 await expect(page.locator('#basketView [data-inbox-todo-line]')).toHaveText('원장에 넣을 약속 문구를 복사했어요.');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toMatch(/^쓰기요청\n- 종류: 약속\(상대·제3자\)\n- 내용: 상대 측 자료 송부 약속\n- 기한: 2026-10-10/);
 // The other chips do not show promises.
 await page.locator('#basketView [data-inbox-chip="tasked"]').click();
 await expect(row).toHaveCount(0);
 expect(writes).toEqual([]);expect(errors).toEqual([]);
});

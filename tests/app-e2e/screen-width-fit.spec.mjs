// UI-화면폭넘침: 긴 제목·긴 주소가 있어도, 칸·탭·필터를 눌러도 화면 폭이 폰 폭 그대로다(가로로 넘침 없음).
// 폰 접은 화면(344·412)과 펼친 화면(882)에서 주요 화면을 열고, 화면 안의 칸·탭(radio·tab)을 하나씩 눌러 본 뒤마다
// document.documentElement.scrollWidth <= innerWidth 를 확인한다. 넘치면 어느 화면·어느 칸에서 어떤 요소가 삐져나갔는지 이름을 보고한다. 모든 이름은 합성 값.
import {test,expect} from '@playwright/test';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';
import {testOrigin} from './helpers/test-origin.mjs';

test.use({timezoneId:'Asia/Seoul'});
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const LONG='10.26. 메트로9호선노조 조합원 결의대회, 서울시청 앞 광장 전국철도노동조합 합동 집회 개화차량기지.';
const URLISH='https://example.org/'+'abcdefghij'.repeat(14);
const KINDS=['meeting','policy','negotiation','press','assembly','struggle','education','other'];
const VIEWS=['home','basket','calendar','tasks','projects','meetings','library','pages','team','calls','telegram','ledger','diary','journal'];

function wideState(){
  const s=baseState();s.meetingWrites=[];
  s.meetings=KINDS.flatMap((k,i)=>[
    {id:'m-'+k+'-a',workspace_id:'workspace-1',title:LONG,series_name:LONG,round_no:i+1,meeting_at:`2026-10-${String(20+(i%6)).padStart(2,'0')}T01:00:00Z`,activity_kind:k,transcript_text:LONG,created_by:'user-1'},
    {id:'m-'+k+'-b',workspace_id:'workspace-1',title:URLISH,series_name:URLISH,round_no:null,meeting_at:`2026-10-${String(10+(i%6)).padStart(2,'0')}T01:00:00Z`,activity_kind:k,transcript_text:'합성',created_by:'user-1'}
  ]);
  s.spaces=s.spaces.map((x,i)=>i%2?{...x,name:LONG+' '+x.name}:{...x,name:URLISH});
  s.docs=s.docs.map((d,i)=>({...d,title:i%2?LONG:URLISH,source:URLISH,file_name:URLISH+'.pdf',mime_type:'application/pdf',file_id:'f'+i,document_date:'2026-10-2'+i}));
  return s;
}
async function extraRoutes(page){
  const ok=(route,data)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  await page.route(`${SB}/rest/v1/app_suborganizations**`,route=>ok(route,['a','b','c'].map((x,i)=>({id:'org-'+x,workspace_id:'workspace-1',name:i%2?LONG:URLISH,active:true,created_by:'user-1'}))));
  await page.route(`${SB}/rest/v1/app_notes**`,route=>{const q=new URL(route.request().url()).searchParams;if(q.get('metadata'))return ok(route,[]);return ok(route,[{id:'10000000-0000-4000-8000-000000000001',workspace_id:'workspace-1',occurred_at:'2026-10-20T01:00:00Z',updated_at:'2026-10-20T01:00:00Z',created_at:'2026-10-20T01:00:00Z',raw_text:LONG+' '+URLISH,ai_export_allowed:true,archived_at:null,attachments:[],metadata:{}}])});
}
// 넘침 보고: 오른쪽 끝이 화면 폭을 넘는 요소 몇 개의 이름.
const overflow=page=>page.evaluate(()=>{
  const w=innerWidth,root=document.documentElement;
  if(root.scrollWidth<=w)return null;
  const name=e=>e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\s+/).slice(0,2).join('.'):'');
  const wide=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>w+1&&getComputedStyle(e).position!=='fixed'}).slice(0,4).map(name);
  return `scrollWidth ${root.scrollWidth} > ${w}; ${wide.join(', ')}`;
});
async function openView(page,view){
  const opened=await page.evaluate(async v=>{try{await window.KPTUViewLoader?.load?.(v);window.KPTURouter.go(v);return true}catch{return false}},view);
  if(!opened)return false;
  const box=page.locator(`#${view}View`).first();
  if(await box.count())await box.waitFor({state:'visible',timeout:8000}).catch(()=>{});
  await page.waitForTimeout(300);
  return true;
}

for(const width of [344,412,882])test(`칸·탭을 눌러도 화면 폭이 그대로 ${width}`,async({page})=>{
  test.setTimeout(240000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const s=wideState();
  await page.setViewportSize({width,height:width<761?844:900});
  await mockApp(page,s);await extraRoutes(page);
  await signIn(page,testOrigin+'/app/?view=reports');
  await page.waitForFunction(()=>window.KPTUViewLoader?.isLoaded('meetings'));
  const bad=[],checked=[],clicks={};
  const check=async label=>{const o=await overflow(page);checked.push(label);if(o)bad.push(`${label}: ${o}`)};
  for(const view of VIEWS){
    if(!await openView(page,view)){checked.push(view+' (열 수 없어 건너뜀)');continue}
    await check(`${view} 처음`);
    const sel=`#${view}View :is([role=radio],[role=tab],[aria-pressed],[data-filter-value],.quick-pill-button,.filter-chips button,.feed-chiprow button,[data-tg-folder],[data-tg-shelf]):visible`;
    const total=Math.min(await page.locator(sel).count(),40);
    clicks[view]=total;
    for(let i=0;i<total;i++){
      const item=page.locator(sel).nth(i);
      if(!await item.count())break;
      const text=((await item.textContent())||'').trim().slice(0,12);
      await item.click({timeout:3000,force:true}).catch(()=>{});
      await page.waitForTimeout(120);
      await check(`${view} 칸 ${i+1}(${text})`);
      await page.keyboard.press('Escape');
    }
  }
  test.info().annotations.push({type:'checked',description:checked.join(' | ')});
  expect(bad,bad.join('\n')).toEqual([]);
  expect('목록',JSON.stringify(clicks)+' // '+checked.filter(x=>!x.includes('칸 ')).join(' | ')).toBe('실험용 일부러 실패');
  // 시험이 빈손으로 지나가지 않게: 사업 보고(칸 9·보기 3 등)·자료실·프로젝트 화면은 반드시 열려 칸을 눌러 봤어야 한다.
  expect(clicks.meetings,JSON.stringify(clicks)).toBeGreaterThanOrEqual(10);
  expect(clicks.library,JSON.stringify(clicks)).toBeGreaterThanOrEqual(3);
  expect(checked.filter(x=>x.includes('건너뜀')).length,checked.join(' | ')).toBeLessThanOrEqual(6);
  expect(errors).toEqual([]);
});

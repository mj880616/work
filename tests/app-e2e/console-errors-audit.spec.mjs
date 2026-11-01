// QA-미완점검(S47-54): 메뉴 18곳 × 세 폭(폰 412·폴드 펼침 870·PC 1280)을 차례로 열며 브라우저가 내는 오류를 실제로 모은다.
// 모으는 것: console.error, 잡히지 않은 오류(pageerror), 실패한 요청(requestfailed), 4xx·5xx 응답.
// 가짜 서버(filter-chip-fixture)만 쓰고 운영 서버는 부르지 않는다. 가짜 서버는 모르는 경로에 빈 값([]·{})을 주므로
// 모양이 맞지 않아 생기는 오류는 운영에서도 나는지 따로 가려야 한다(결과는 기록만 하고, 판정은 아래 한 가지만).
// 판정: 잡히지 않은 오류(pageerror)는 0건이어야 한다 — 화면 코드가 빈 자료에도 깨지지 않아야 한다.
// 결과 표는 test-results/console-audit/<폭>.json 과 GitHub 알림(::notice)으로 남는다.
import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {baseState,mockApp,signIn} from './helpers/filter-chip-fixture.mjs';

const WIDTHS=[[412,915],[870,1000],[1280,900]];
// 메뉴 15칸(app/menu-model.mjs) + 메뉴 안 화면 3곳(할 일·일기·사업영역 관리) = 18곳. 노트는 정리함의 노트 쪽(note)이다.
const MENU_VIEWS=['home','basket','note','calendar','tasks','diary','meetings','projects','library','pages','team','hwp','ledger','photos','outside','calls','telegram','arsenal'];
const DIR='test-results/console-audit';
const short=text=>String(text||'').replace(/\s+/g,' ').replace(/https?:\/\/[^\s)]+/g,u=>{try{const x=new URL(u);return x.pathname}catch{return u}}).slice(0,160);

async function openView(page,view){
  if(view==='note'){
    // 메뉴 [노트]와 같은 길(topbar-actions.js): 노트 쪽을 고른 뒤 정리함을 연다(?view=basket&pane=note).
    await page.evaluate(async()=>{const {requestBasketKind}=await import('/app/basket-note-tasks.js');requestBasketKind('note');window.KPTURouter?.go?.('basket',{source:'delegated',sub:'note'})});
    return;
  }
  await page.evaluate(v=>window.KPTURouter?.go?.(v),view);
}

for(const [width,height] of WIDTHS){
  test(`콘솔 오류 수집 ${width}px`,async({page})=>{
    test.setTimeout(300000);
    mkdirSync(DIR,{recursive:true});
    await page.setViewportSize({width,height});
    const state=baseState();state.meetings=[];state.meetingWrites=[];state.downloads=[];state.deletes=[];
    await mockApp(page,state);
    let at='login';
    const rows=[];
    const push=(kind,text)=>rows.push({view:at,kind,text:short(text)});
    page.on('console',m=>{if(m.type()==='error')push('console',m.text())});
    page.on('pageerror',e=>push('pageerror',(e.name||'Error')+': '+e.message));
    page.on('requestfailed',r=>{const f=r.failure()?.errorText||'';if(/ERR_ABORTED/.test(f))return;push('requestfailed',r.method()+' '+r.url()+' '+f)});
    page.on('response',r=>{if(r.status()>=400)push('http'+r.status(),r.request().method()+' '+r.url())});
    await signIn(page);
    await page.waitForTimeout(800);
    for(const view of MENU_VIEWS){
      at=view;
      try{await openView(page,view);await page.waitForTimeout(1500)}
      catch(error){push('open-failed',error?.message)}
      if(view==='projects')await page.evaluate(()=>window.KPTUAreaWindow?.close?.({silent:true}));
    }
    const summary=MENU_VIEWS.map(view=>{const r=rows.filter(x=>x.view===view);return `${view}: ${r.length?r.map(x=>x.kind+' '+x.text).join(' | '):'0'}`});
    const before=rows.filter(x=>x.view==='login');if(before.length)summary.unshift('login: '+before.map(x=>x.kind+' '+x.text).join(' | '));
    writeFileSync(`${DIR}/${width}.json`,JSON.stringify({width,views:MENU_VIEWS,rows},null,1));
    const esc=t=>t.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A');
    process.stdout.write(`::notice title=console-audit ${width}::${esc(summary.join('\n'))}\n`);
    expect(rows.filter(x=>x.kind==='pageerror')).toEqual([]);
  });
}

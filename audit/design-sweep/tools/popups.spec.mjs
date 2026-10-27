import {test} from '@playwright/test';
import {install} from './fake.mjs';
import {measure,openView} from './capture.spec.mjs';
import {enterLogin} from '../../../tests/app-e2e/helpers/login-entry.mjs';
import {signInWithSession} from '../../../tests/app-e2e/helpers/session-login.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
const OUT=process.env.SWEEP_OUT;const O='http://127.0.0.1:8123';
test.use({timezoneId:'Asia/Seoul',locale:'ko-KR'});
const WIDTHS=(process.env.SWEEP_W||'1280,390').split(',').map(Number);
const popupMeasure=()=>{
  const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
  const dlg=[...document.querySelectorAll('.modal:not(.hidden),[role=dialog]:not([hidden]),.account-panel:not([hidden]),[role=menu]:not([hidden]),#mobileMenu:not([hidden]),.choice-sheet:not([hidden]),details[open]>.ps3-more-panel')].filter(vis);
  const nav=document.querySelector('.mobile-bottom-nav,#mobileTabs,nav.mobile-nav,.mobile-tabbar');
  const navR=[...document.querySelectorAll('body *')].filter(e=>{const s=getComputedStyle(e);const r=e.getBoundingClientRect();return s.position==='fixed'&&r.bottom>=innerHeight-2&&r.height<90&&r.width>innerWidth*0.8&&vis(e)}).map(e=>({n:e.id||e.className,top:Math.round(e.getBoundingClientRect().top)}));
  return dlg.map(d=>{const r=d.getBoundingClientRect();const card=d.querySelector('.modal-card')||d;const cr=card.getBoundingClientRect();
    const btns=[...d.querySelectorAll('button,input:not([type=hidden]):not([type=checkbox]),select,textarea')].filter(vis).map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return {t:(e.textContent||e.placeholder||e.getAttribute('aria-label')||e.type||'').trim().slice(0,16),tag:e.tagName,type:e.type,h:Math.round(b.height),w:Math.round(b.width),fs:s.fontSize,y:Math.round(b.y),bottom:Math.round(b.bottom)}});
    return {id:d.id||d.className,card:{x:Math.round(cr.x),y:Math.round(cr.y),w:Math.round(cr.width),h:Math.round(cr.height),bottom:Math.round(cr.bottom)},btns,navs:navR,H:innerHeight}});
};
async function signIn(page,target){
  await install(page);await page.goto(target);await enterLogin(page);await signInWithSession(page,'owner@example.org');
  await page.waitForFunction(()=>document.querySelector('#appView')?.classList.contains('kptu-ui-ready'),null,{timeout:15000});
}
const tryClick=async(page,sels)=>{for(const s of sels){const l=page.locator(s).first();if(await l.count()&&await l.isVisible().catch(()=>false)){await l.click({timeout:3000}).catch(()=>{});return s}}return null};
const STEPS=[
 ['acct',async p=>{await openView(p,'home');await p.waitForTimeout(600);return tryClick(p,['[data-account-open]:visible','#mobileMenuTab'])}],
 ['addmenu',async p=>{await p.keyboard.press('Escape');await openView(p,'home');await p.waitForTimeout(400);return tryClick(p,['[data-quick-add]:visible'])}],
 ['mobilemenu',async p=>{await p.keyboard.press('Escape');return tryClick(p,['#mobileMenuTab:visible'])}],
 ['theme',async p=>{await p.keyboard.press('Escape');await openView(p,'home');await p.waitForTimeout(400);await p.evaluate(()=>{const m=document.querySelector('#themeModal');const b=document.querySelector('[aria-controls=themeModal]');b?.click()});return 'theme'}],
 ['eventmodal',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>{const m=document.querySelector('#themeModal');m?.classList.add('hidden')});await openView(p,'calendar');await p.waitForTimeout(1200);return tryClick(p,['#newEventBtn:visible','.calendar-fab:visible','[data-fab]:visible','button[aria-label*="일정 등록"]:visible'])}],
 ['taskmodal',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'tasks');await p.waitForTimeout(1200);await p.evaluate(()=>window.KPTUGoogleTasks?.openEditor?.());return 'gt'}],
 ['taskrowmenu',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'tasks');await p.waitForTimeout(800);return tryClick(p,['.gt-menu-trigger:visible'])}],
 ['basketrowmenu',async p=>{await p.keyboard.press('Escape');await openView(p,'basket');await p.waitForTimeout(1000);return tryClick(p,['#basketView [aria-haspopup]:visible','#basketView .icon-btn:visible'])}],
 ['basketmore',async p=>{await p.keyboard.press('Escape');await openView(p,'basket');await p.waitForTimeout(500);return tryClick(p,['#basketView .basket-head button:visible','#basketView button:has-text("더보기"):visible'])}],
 ['projectnew',async p=>{await p.keyboard.press('Escape');await openView(p,'projects');await p.waitForTimeout(1000);return tryClick(p,['#newProjectBtn:visible','#projectsView .fab:visible','#projectsView button[aria-label*="프로젝트"]:visible'])}],
 ['projectdetail',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'projects');await p.waitForTimeout(800);return tryClick(p,['#projectsView .kptu-list-row:visible','#projectsView [data-ps3-open]:visible','#projectsView .ps3-prow-main:visible'])}],
 ['projectarchive',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'projects');await p.waitForTimeout(600);return tryClick(p,['#ps3ArchiveBtn:visible','#projectsView summary.icon-btn:visible'])}],
 ['meetingnew',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'meetings');await p.waitForTimeout(1000);return tryClick(p,['#newMeetingBtn:visible','#meetingsView .fab:visible','#meetingsView button[aria-label*="추가"]:visible'])}],
 ['meetingopen',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'meetings');await p.waitForTimeout(800);return tryClick(p,['#meetingsView .meeting-list-row:visible','#meetingsView article:visible','#meetingsView li button:visible'])}],
 ['librarynew',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'library');await p.waitForTimeout(1000);return tryClick(p,['#newDocumentBtn:visible','#libraryView .fab:visible'])}],
 ['libraryopen',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'library');await p.waitForTimeout(800);await tryClick(p,['#libraryView .lu-node-head:visible','#libraryView summary:visible']);await p.waitForTimeout(500);return 'expanded'}],
 ['teamdetail',async p=>{await p.keyboard.press('Escape');await openView(p,'team');await p.waitForTimeout(800);return tryClick(p,['#teamView .kptu-list-row:visible','#teamView li button:visible'])}],
 ['pageedit',async p=>{await p.keyboard.press('Escape');await p.evaluate(()=>document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden')));await openView(p,'pages');await p.waitForTimeout(800);return tryClick(p,['#pagesView .sp-row:visible','#pagesView [data-sp-open]:visible','#pagesView li button:visible','#pagesView button:has-text("가상 민자철도")'])}],
 ['ledgercond',async p=>{await p.keyboard.press('Escape');await openView(p,'ledger');await p.waitForTimeout(800);return tryClick(p,['#ledgerView button:has-text("조건"):visible'])}],
 ['ledgeradd',async p=>{await p.keyboard.press('Escape');await openView(p,'ledger');await p.waitForTimeout(600);return tryClick(p,['#ledgerView button:has-text("기록하기"):visible'])}],
 ['callopen',async p=>{await p.keyboard.press('Escape');await openView(p,'calls');await p.waitForTimeout(800);return tryClick(p,['#callsView li:visible','#callsView [data-cf-id]:visible','#callsView button:has-text("가상 교섭"):visible'])}],
 ['journalweek',async p=>{await p.keyboard.press('Escape');await openView(p,'journal');await p.waitForTimeout(800);return tryClick(p,['[data-journal-mode=week]:visible'])}],
 ['diaryday',async p=>{await p.keyboard.press('Escape');await openView(p,'diary');await p.waitForTimeout(800);return tryClick(p,['[data-diary-day]:visible >> nth=26','[data-diary-day]:visible'])}],
 ['profile',async p=>{await p.keyboard.press('Escape');await p.evaluate(async()=>{await window.KPTUViewLoader?.load?.('profile');window.KPTURouter.go('profile')});await p.waitForTimeout(1200);return 'profile'}],
 ['notes',async p=>{await p.keyboard.press('Escape');await openView(p,'basket');await p.waitForTimeout(500);return tryClick(p,['[data-basket-kind-nav="note"]:visible','#mobileMenuTab'])}],
 ['search',async p=>{await p.keyboard.press('Escape');await openView(p,'home');await p.waitForTimeout(500);const s=await tryClick(p,['.global-search input:visible','[data-global-search]:visible','input[placeholder="전체 검색"]:visible','button[aria-label*="검색"]:visible']);await p.keyboard.type('교섭');await p.waitForTimeout(800);return s}],
];
for(const width of WIDTHS)test('popups '+width,async({page})=>{
  test.setTimeout(600000);
  const H=width===390?844:width===1920?1080:800;
  await page.setViewportSize({width,height:H});
  await signIn(page,O+'/app/?view=home');
  mkdirSync(OUT,{recursive:true});
  const res={};
  for(const [name,fn] of STEPS){
    let r;try{r=await fn(page)}catch(e){r='ERR '+String(e).slice(0,100)}
    await page.waitForTimeout(900);
    const pm=await page.evaluate(popupMeasure).catch(e=>String(e));
    const vm=await page.evaluate(measure).catch(e=>String(e));
    res[name]={clicked:r,popup:pm,view:{view:vm.view,sw:vm.sw,buttons:vm.buttons,fs:vm.fs,headings:vm.headings,fixed:vm.fixed,ov:vm.ov}};
    await page.screenshot({path:`${OUT}/p-${name}-${width}.png`});
  }
  writeFileSync(`${OUT}/popups-${width}.json`,JSON.stringify(res,null,1));
});

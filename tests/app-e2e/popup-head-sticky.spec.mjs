import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
// UI-팝업머리고정: in every popup (.modal-card) the title line and its close (×) stay at the top while the body scrolls (phone
// and PC, base-ui.css one rule). Popups whose save sat at the end of the content now keep it in the bottom row
// (.modal-action-footer), so save is visible from the start; popups that already had that row keep it as it was.
const views=['team','library','meetings','projects','calendar'];
async function installAll(page){
 for(const v of views){await page.evaluate(v=>window.KPTURouter.go(v),v);await expect.poll(()=>page.evaluate(v=>window.KPTUViewLoader.isLoaded(v),v)).toBe(true);}
}
// Shows one installed popup template with long content (like modal-typography's template walk), without going through its
// opener (no history entry, no data load), and returns how it looks before and after scrolling the card to the end.
async function measure(page,id,{edit=false}={}){
 return page.evaluate(({id,edit})=>{
  const m=document.getElementById(id);if(!m)return null;
  m.classList.remove('hidden');m.setAttribute('aria-hidden','false');
  if(edit){document.querySelector('#mrdView')?.classList.add('hidden');document.querySelector('#mrdEditor')?.classList.remove('hidden');}
  const card=m.querySelector('.modal-card'),head=card.querySelector(':scope>.modal-head'),close=head.querySelector('button.icon-btn,[data-gt-close],[aria-label="닫기"]');
  const filler=document.createElement('div');filler.style.height='2400px';filler.dataset.testFiller='';
  // The visible bottom row only (회의 결과 keeps its edit form, with its row, hidden while reading).
  const footer=[...card.querySelectorAll('.modal-action-footer')].find(f=>f.getClientRects().length);
  (footer?footer.before(filler):card.append(filler));
  const visible=el=>{const r=el.getBoundingClientRect(),c=card.getBoundingClientRect();if(r.top<c.top-1||r.bottom>c.bottom+1||!r.width)return false;const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(hit===el||el.contains(hit));};
  const save=footer?.querySelector('button.primary');
  const before={save:save?visible(save):null};
  card.scrollTop=card.scrollHeight;
  const title=head.querySelector('h2'),after={head:visible(title.getBoundingClientRect().height?title:head),close:visible(close),save:save?visible(save):null,headTop:Math.round(head.getBoundingClientRect().top-card.getBoundingClientRect().top),scrolled:card.scrollTop>0};
  filler.remove();card.scrollTop=0;
  if(edit){document.querySelector('#mrdView')?.classList.remove('hidden');document.querySelector('#mrdEditor')?.classList.add('hidden');}
  m.classList.add('hidden');m.setAttribute('aria-hidden','true');
  return {before,after,hasFooter:!!footer};
 },{id,edit});
}
// The PR #766 list of popups whose save sat at the end of the content (no bottom row), plus ones that already had the row.
const NEEDS_ROW=[['libraryEditModal'],['soEditModal'],['soAssignModal'],['wdAffModal'],['wdTimeModal'],['warDraftModal'],['meetingRoundDetailModal',{edit:true}]];
const HAD_ROW=[['eventModal'],['taskModal'],['ps3CreateModal'],['ps3MilestoneModal']];
// Popups with no save button of their own (reading or list popups): only the title line is checked.
const READ_ONLY=[['libraryManageModal'],['wdModal'],['calendarDayModal'],['ps3DetailModal'],['meetingRoundDetailModal']];

for(const width of [390,1280])test(`title line and × stay visible after scrolling a long popup; save is visible from the start ${width}`,async({page})=>{
 await page.setViewportSize({width,height:700});await openHome(page);await installAll(page);
 // Popups that are installed only when first opened.
 await page.evaluate(async()=>{
  if(!document.getElementById('calendarDayModal'))document.body.insertAdjacentHTML('beforeend','<div id="calendarDayModal" class="modal hidden"><div class="modal-card small-card kptu-day-card"><div class="modal-head"><div><h2>일정</h2></div><button class="icon-btn" type="button" aria-label="닫기">×</button></div><div class="kptu-day-list"></div></div></div>');
 });
 const checked=[];
 for(const [id,opt] of [...NEEDS_ROW,...HAD_ROW,...READ_ONLY]){
  const r=await measure(page,id,opt);if(!r)continue;checked.push(id);
  expect(r.after.scrolled,id+' scrolls').toBe(true);
  expect(r.after.head,id+' title visible after scroll').toBe(true);
  expect(r.after.close,id+' × visible after scroll').toBe(true);
  // Stuck within the card's top padding (project detail keeps its own head rule that sticks at the very top).
 expect(r.after.headTop,id+' title line at the top').toBeGreaterThanOrEqual(0);expect(r.after.headTop,id+' title line at the top').toBeLessThanOrEqual(width<761?17:25);
  if(NEEDS_ROW.some(([x,o])=>x===id&&o===opt)||HAD_ROW.some(([x])=>x===id)){
   expect(r.hasFooter,id+' save in the bottom row').toBe(true);
   expect(r.before.save,id+' save visible from the start').toBe(true);
   expect(r.after.save,id+' save visible after scroll').toBe(true);
  }
 }
 for(const [id] of NEEDS_ROW)expect(checked,id+' installed').toContain(id);
});

// The PC task detail pane (#766) keeps its own head (save beside ×), now under the same sticky rule: no change in what it shows.
test('PC task pane keeps save in the title line and the shared head rule does not add the popup cover',async({page})=>{
 await page.setViewportSize({width:1280,height:800});await openHome(page);
 await page.evaluate(()=>window.KPTURouter.go('tasks'));await expect.poll(()=>page.evaluate(()=>window.KPTUViewLoader.isLoaded('tasks'))).toBe(true);
 const head=page.locator('#gtTaskModal .modal-head');
 await expect(head).toHaveCount(1);
 const s=await head.evaluate(el=>{const pane=document.querySelector('#gtDetailPane'),m=document.querySelector('#gtTaskModal');pane?.append(m);m.classList.add('gt-docked');const c=getComputedStyle(el);const out=[c.position,c.boxShadow];m.classList.remove('gt-docked');document.body.append(m);return out;});
 expect(s).toEqual(['sticky','none']);
});

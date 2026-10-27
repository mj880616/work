import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test('0 debug layout',async({page})=>{
 await page.setViewportSize({width:1280,height:1000});
 const errs=[];page.on('pageerror',e=>errs.push(String(e.message).slice(0,160)));page.on('console',m=>{if(m.type()==='error')errs.push('c:'+m.text().slice(0,160))});
 await openHome(page);
 await page.waitForTimeout(1500);
 const row=page.locator('#appView>.app-nav [data-quick-links]');
 const snap=()=>page.evaluate(()=>{const n=document.querySelector('#appView>.app-nav'),r=document.querySelector('#appView>.app-nav [data-quick-links]').getBoundingClientRect(),p=document.querySelector('#quickLinksPanel');const pr=p&&!p.hidden?p.getBoundingClientRect():null;return {rowB:r.bottom,pB:pr&&pr.bottom,pT:pr&&pr.top,ih:innerHeight,sy:scrollY,nav:[n.getBoundingClientRect().top,n.scrollHeight,n.clientHeight,n.scrollTop]}});
 const cards=await page.evaluate(()=>[...document.querySelectorAll('#homeView [data-home-card]')].map(c=>c.dataset.homeCard+(c.hidden?'(h)':'')+'@'+c.parentElement.dataset.homeColumn).join(','));
 const a=await snap();await row.click();const c=await snap();await page.waitForTimeout(1500);const d=await snap();
 expect(JSON.stringify({cards,a,c,d,errs}),'DEBUGQL').toBe('');
});

import {test,expect} from '@playwright/test';
import {openHome} from './helpers/home-entry.mjs';
test('zz debug quick-links layout',async({page})=>{
 await page.setViewportSize({width:1280,height:1000});
 await openHome(page);
 const row=page.locator('#appView>.app-nav [data-quick-links]'),panel=page.locator('#quickLinksPanel');
 await expect(row).toBeVisible();
 const snap=()=>page.evaluate(()=>{const n=document.querySelector('#appView>.app-nav'),r=document.querySelector('#appView>.app-nav [data-quick-links]').getBoundingClientRect(),p=document.querySelector('#quickLinksPanel');const pr=p&&!p.hidden?p.getBoundingClientRect():null;return {rowBottom:r.bottom,rowTop:r.top,nav:[n.getBoundingClientRect().top,n.scrollHeight,n.clientHeight,n.scrollTop],scrollY,innerHeight,pBottom:pr&&pr.bottom,pTop:pr&&pr.top,items:[...n.children].map(c=>(c.dataset.view||c.className||c.tagName).toString().slice(0,18)+':'+Math.round(c.getBoundingClientRect().height)).join(',')}});
 const a=await snap();await page.waitForTimeout(1500);const b=await snap();
 await row.click();await page.waitForTimeout(100);const c=await snap();await page.waitForTimeout(1500);const d=await snap();
 expect(JSON.stringify({a,b,c,d}),'DEBUGQL').toBe('');
});

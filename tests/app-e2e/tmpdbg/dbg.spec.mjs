import { test } from '@playwright/test';
import { openHome } from '../helpers/home-entry.mjs';
test('dbg',async({page})=>{const errs=[];page.on('pageerror',e=>errs.push(e.message+'\n'+e.stack));page.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text())});await openHome(page);await page.evaluate(()=>window.KPTURouter.go('basket'));await page.waitForTimeout(3000);console.log('ERRS',JSON.stringify(errs,null,1));});

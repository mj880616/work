import {test,expect} from '@playwright/test';

const BASE='http://127.0.0.1:8123';
const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve});return {promise,release}};

// Keep one document alive to exercise the module's own session epoch. The full-shell
// public-workspace-auth tests separately verify the loader's reload/login boundary.
// Session, cache, API single-flight, router and Google Tasks code are all real.
async function start(page,phase){
  const requests={previous:0,current:0},gates={previous:gate(),current:gate()};
  await page.route(`${SB}/**`,async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname!=='/functions/v1/google-tasks'||url.searchParams.get('action')!=='overview'){
      return route.fulfill({status:500,json:{error:'unexpected fixture request'}});
    }
    const owner=request.headers().authorization==='Bearer fixture-previous'?'previous':'current';
    requests[owner]++;
    await gates[owner].promise;
    const due=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)+'T00:00:00.000Z';
    await route.fulfill({json:{connected:true,authorized:true,tasks:[{
      id:owner,title:'fixture',taskListId:'fixture-list',due,status:'needsAction',notes:''
    }]}});
  });
  await page.goto(`${BASE}/tests/app-e2e/runtime-client-fixture.html`);
  await page.evaluate(phase=>{
    document.body.innerHTML='<style>.hidden{display:none!important}</style><main id="appView" class="kptu-ui-ready"><section id="calendarView" class="view-panel"></section><section id="tasksView" class="view-panel hidden"><button id="newTaskBtn">Add</button><div id="taskList"></div></section></main>';
    const rt=window.KPTURuntime;
    window.__race={ensures:0,apiCalls:0,settled:0,staleRows:0,documentId:Math.random()};
    window.__setOwner=(owner,id=owner)=>{
      rt.session.write(owner?{access_token:'fixture-'+owner,refresh_token:'fixture',expires_at:4102444800,user:{id}}:null);
      if(owner)rt.context.set({user:{id},workspace:{id:'fixture-workspace'}});
    };
    window.__setOwner('previous');
    const ensure=rt.session.ensure;
    let release;
    const readiness=new Promise(resolve=>{release=resolve});
    window.__releaseReadiness=release;
    rt.session.ensure=async()=>{
      const call=++window.__race.ensures;
      if(phase==='readiness'&&call===1)await readiness;
      return ensure();
    };
    const api=rt.api;
    rt.api=async(...args)=>{
      window.__race.apiCalls++;
      try{return await api(...args)}finally{window.__race.settled++}
    };
    // Observe transient insertions too, rather than checking only the final DOM.
    new MutationObserver(records=>{
      for(const record of records)for(const node of record.addedNodes){
        if(node.nodeType!==1)continue;
        window.__race.staleRows+=Number(node.matches('[data-google-task="previous"]'))+node.querySelectorAll('[data-google-task="previous"]').length;
      }
    }).observe(document.querySelector('#tasksView'),{subtree:true,childList:true});
  },phase);
  await page.addScriptTag({url:`${BASE}/app/app-router.js`});
  await page.addScriptTag({url:`${BASE}/app/google-tasks.js`});
  const documentId=await page.evaluate(()=>window.__race.documentId);
  await page.evaluate(()=>window.KPTURouter.go('tasks'));
  if(phase==='overview')await expect.poll(()=>requests.previous).toBe(1);
  else await expect.poll(()=>page.evaluate(()=>window.__race.ensures)).toBe(1);
  return {requests,gates,documentId};
}

const drain=page=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,0)));
const reenter=page=>page.evaluate(()=>{window.KPTURouter.go('calendar');window.KPTURouter.go('tasks')});
const stats=page=>page.evaluate(()=>({...window.__race}));

for(const phase of ['readiness','overview'])for(const transition of ['switch','logout'])for(const finish of ['previous first','current first']){
  test(`Google Tasks ${transition} during ${phase}: ${finish} preserves the new session load`,async({page})=>{
    const {requests,gates,documentId}=await start(page,phase);
    const releasePrevious=async()=>{
      if(phase==='readiness')await page.evaluate(()=>window.__releaseReadiness());
      else{
        gates.previous.release();
        await expect.poll(async()=>(await stats(page)).settled).toBe(finish==='current first'?2:1);
      }
      await drain(page);
    };
    if(transition==='logout'){
      await page.evaluate(()=>window.__setOwner(null));
      await expect(page.locator('#gtTaskSection')).toHaveCount(0);
      if(finish==='previous first'){
        await releasePrevious();
        await expect(page.locator('#gtTaskSection')).toHaveCount(0);
        expect(await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('kptu_owner_cache:')).length)).toBe(0);
      }
    }
    // Relogin to the same owner also needs a fresh epoch, even though the id repeats.
    const expectedOwner=transition==='logout'?'previous':'current';
    await page.evaluate(owner=>window.__setOwner('current',owner),expectedOwner);
    await expect.poll(()=>requests.current).toBe(1);
    const expectedCalls=phase==='overview'?2:1;
    if(transition==='switch'&&finish==='previous first')await releasePrevious();
    await reenter(page);
    await drain(page);
    // Counting the module's ensure/API calls prevents runtime deduplication from
    // hiding an old finally block that incorrectly clears the new owner's lock.
    expect((await stats(page)).ensures).toBe(2);
    expect((await stats(page)).apiCalls).toBe(expectedCalls);
    expect(requests.current).toBe(1);
    gates.current.release();
    await expect(page.locator('[data-google-task="current"]')).toHaveCount(1);
    if(finish==='current first')await releasePrevious();
    await expect(page.locator('[data-google-task="previous"]')).toHaveCount(0);
    await expect(page.locator('[data-google-task="current"]')).toHaveCount(1);
    const final=await stats(page);
    expect(final.staleRows).toBe(0);
    expect(final.documentId).toBe(documentId);
    expect(final.ensures).toBe(2);
    expect(final.apiCalls).toBe(expectedCalls);
    expect(requests).toEqual({previous:phase==='overview'?1:0,current:1});
    expect(await page.evaluate(owner=>{
      const keys=Object.keys(localStorage).filter(key=>key.startsWith('kptu_owner_cache:'));
      return keys.length===1&&keys[0].endsWith(':'+owner)&&JSON.parse(localStorage.getItem(keys[0])).tasks.every(task=>task.id==='current');
    },expectedOwner)).toBe(true);
    // Completed loads must release the current epoch as well.
    await reenter(page);
    await expect.poll(()=>requests.current).toBe(2);
  });
}

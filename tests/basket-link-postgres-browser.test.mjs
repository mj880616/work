// Local proof only: real isolated PostgreSQL + Chromium. Dependencies are required,
// never installed/skipped here; the ordinary app-e2e workflow stays unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer as createSocket} from 'node:net';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {fixture,OWNER,STRANGER,WS_A,PROJECT_A,ORG_A} from './auth-handoff/basket4-fixture.mjs';

const requirePostgres=createRequire(new URL('./auth-handoff/package.json',import.meta.url));
const EmbeddedPostgres=requirePostgres('embedded-postgres').default;
const {Pool}=requirePostgres('pg');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFile(join(root,path),'utf8');
const listen=server=>new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
const close=server=>new Promise((accept,reject)=>server.close(error=>error?reject(error):accept()));

test('local Chromium + PostgreSQL: NULL CAS conflict requires review and preserves archived note and exact text',{timeout:90000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'basket-link-browser-pg-'));
  const socket=createSocket();await listen(socket);const port=socket.address().port;await close(socket);
  const password=randomBytes(24).toString('hex');
  const cluster=new EmbeddedPostgres({databaseDir:directory,user:'postgres',password,port,persistent:false,createPostgresUser:false,
    initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-h','127.0.0.1','-c','log_statement=none','-c','log_min_error_statement=panic'],onLog:()=>{},onError:()=>{}});
  let pool,browser,server;const clientEnds=[],rpcCalls=[],errors=[];
  try{
    await cluster.initialise();await cluster.start();
    pool=new Pool({host:'127.0.0.1',port,user:'postgres',password,database:'postgres',ssl:false});
    pool.on('connect',client=>clientEnds.push(new Promise(done=>client.once('end',done))));
    await pool.query(fixture);
    for(const file of ['20260927103344_task_impl2_notes_record_links.sql','20260928123601_task_meeting_followup_record_links.sql'])await pool.query(await read('supabase/migrations/'+file));
    // Exact prerequisite setup used by auth-handoff/basket-link-view.test.mjs.
    await pool.query(`create table public.app_documents(id uuid primary key, workspace_id uuid);
      alter table public.app_spaces add column owner_id uuid default '${OWNER}',add column name text,add column parent_id uuid,add column status text default 'active',add column metadata jsonb default '{"project_system":"v2"}';
      grant select on public.app_spaces to authenticated;alter table public.app_spaces enable row level security;
      create policy spaces_owner on public.app_spaces for all to authenticated using(private.app_is_workspace_owner(workspace_id)) with check(private.app_is_workspace_owner(workspace_id));
      grant update on public.app_spaces to authenticated;`);
    for(const file of ['20261010120000_basket1_notes_links.sql','20261011180000_basket4a_confirm_links.sql','20261012100000_basket_link_view_db.sql'])await pool.query(await read('supabase/migrations/'+file));
    async function asOwner(fn,sub=OWNER){
      const client=await pool.connect();
      try{await client.query('begin');await client.query("select set_config('request.jwt.claim.sub',$1,true)",[sub]);await client.query('set local role authenticated');
        const result=await fn(client);await client.query('commit');return result;
      }catch(error){await client.query('rollback');throw error;}finally{client.release();}
    }
    const stamp='2026-10-11T01:02:03.123456Z';
    const note=(await pool.query('insert into public.app_notes(workspace_id,raw_text,updated_at)values($1,$2,$3) returning id',[WS_A,'  합성 원문\n<그대로>\n',stamp])).rows[0];
    const confirmed=await asOwner(async client=>(await client.query('select public.app_basket_confirm_links($1,$2,$3::jsonb) result',
      [note.id,stamp,JSON.stringify([{kind:'organization',target_id:ORG_A,reason:'합성 기록'},{kind:'project',target_id:PROJECT_A,reason:'합성 기록'}])])).rows[0].result);
    assert.deepEqual(confirmed,{ok:true,created:2,existing:0});
    const link=(await asOwner(async client=>(await client.query('select id,summary from public.app_record_links where note_id=$1 and organization_id=$2',[note.id,ORG_A])).rows[0]));
    assert.equal(link.summary,null);
    await pool.query('update public.app_notes set archived_at=now(),ai_export_allowed=false where id=$1',[note.id]);
    const sourceBefore=(await pool.query('select * from public.app_notes where id=$1',[note.id])).rows[0];
    assert.equal((await pool.query("select prosecdef from pg_proc where oid='public.app_basket_update_link_summary(uuid,text,text)'::regprocedure")).rows[0].prosecdef,false);
    assert.deepEqual(await asOwner(async client=>(await client.query('select id from public.app_record_links where id=$1',[link.id])).rows,STRANGER),[]);

    const runtimeApi=async(path,options={})=>{
      const url=new URL(path,'http://127.0.0.1');
      if(url.pathname==='/rest/v1/rpc/app_basket_update_link_summary'){
        assert.equal(options.method,'POST');const b=options.body;assert.equal(b.p_link_id,link.id);
        const result=await asOwner(async client=>(await client.query('select public.app_basket_update_link_summary($1,$2,$3) result',[b.p_link_id,b.p_expected_summary,b.p_summary])).rows[0].result);
        rpcCalls.push({expected:b.p_expected_summary,result});return result;
      }
      assert.equal(url.pathname,'/rest/v1/app_record_links');assert.equal(url.searchParams.get('workspace_id'),'eq.'+WS_A);
      assert.equal(url.searchParams.get('note.workspace_id'),'eq.'+WS_A);assert.equal(url.searchParams.get('status'),'eq.confirmed');
      assert.equal(url.searchParams.get('note_id'),'not.is.null');assert.ok(url.searchParams.get('select').includes('note:app_notes!inner'));
      const filter=url.searchParams.get('id');if(filter)assert.equal(filter,'eq.'+link.id);
      return asOwner(async client=>(await client.query(`select l.id,l.workspace_id,l.summary,l.note_id,l.organization_id,l.project_id,l.status,
        json_build_object('id',n.id,'workspace_id',n.workspace_id,'occurred_at',n.occurred_at,'raw_text',n.raw_text) note
        from public.app_record_links l join public.app_notes n on n.id=l.note_id
        where l.workspace_id=$1 and n.workspace_id=$1 and l.status='confirmed' and l.note_id is not null
          and (l.organization_id is not null or l.project_id is not null) and l.id=$2
        order by l.id limit $3 offset $4`,[WS_A,link.id,Number(url.searchParams.get('limit')),Number(url.searchParams.get('offset'))])).rows);
    };
    const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>로컬 요약 CAS 검증</title><div id="records"></div><script type="module">
      import {readLinkRecords,linkRecordHtml,mountLinkSummaryEditor} from '/app/basket-link-records.js';
      window.__pendingRequests=0;
      const rt={context:{read:()=>(${JSON.stringify({user:{id:OWNER},workspace:{id:WS_A}})})},api:async(...args)=>{
        window.__pendingRequests++;try{return await window.realRuntimeApi(...args);}finally{window.__pendingRequests--;}
      }};
      const host=document.getElementById('records'),rows=await readLinkRecords({linkId:${JSON.stringify(link.id)}},rt);
      host.innerHTML=rows.map(linkRecordHtml).join('');
      mountLinkSummaryEditor(host,{getRecord:id=>rows.find(row=>row.id===id),onUpdated:fresh=>{
        const row=rows.find(row=>row.id===fresh.id);Object.assign(row,fresh);host.querySelector('[data-link-summary-text]').textContent=fresh.summary;
      }},rt);window.__ready=true;
      </script></html>`;
    server=createServer(async(req,res)=>{
      try{
        const path=new URL(req.url,'http://127.0.0.1').pathname;
        if(path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;}
        assert.ok(/^\/app\/[a-z0-9-]+\.js$/.test(path));let source=await read(path.slice(1));
        // Opt-in negative control only modifies the ephemeral served test copy.
        if(process.env.BASKET_CAS_NEGATIVE_CONTROL==='1'&&path==='/app/basket-link-records.js')source=source.replace('if(state.needsReview){await latest(state,form,run,owner);return;}','');
        res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(source);
      }catch{res.writeHead(404);res.end();}
    });await listen(server);
    browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const pages=[];
    for(let i=0;i<2;i++){
      const context=await browser.newContext(),page=await context.newPage();page.on('pageerror',()=>errors.push('browser module error'));
      await page.exposeFunction('realRuntimeApi',runtimeApi);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.__ready);
      await page.getByRole('button',{name:'요약 수정',exact:true}).click();assert.equal(await page.locator('textarea').inputValue(),'');pages.push(page);
    }
    const [first,second]=pages;
    const firstSummary='  합성 10/20 10:00 예정, 참석 30명\n<검토> 😀 \u00a0';
    const draft='\u3000두 번째 합성 초안\n예정 유지 <원문> 😀  ';
    const stored=async()=>(await asOwner(async client=>(await client.query('select summary from public.app_record_links where id=$1',[link.id])).rows[0].summary));
    await first.locator('textarea').fill(firstSummary);await first.getByRole('button',{name:'저장',exact:true}).click();
    await first.locator('[data-link-summary-form]').waitFor({state:'detached'});assert.equal(await stored(),firstSummary);
    await second.locator('textarea').fill(draft);await second.getByRole('button',{name:'저장',exact:true}).click();
    await second.getByRole('button',{name:'최신 요약 확인',exact:true}).waitFor({state:'visible'});
    assert.equal(rpcCalls.length,2);assert.equal(rpcCalls[0].expected,null);assert.equal(rpcCalls[1].expected,null);
    assert.deepEqual(rpcCalls[1].result,{ok:false,error:'SUMMARY_CHANGED'});
    assert.equal(await second.locator('textarea').inputValue(),draft);
    assert.ok((await second.locator('[data-link-summary-status]').textContent()).includes('다른 곳에서 요약이 바뀌었어요'));
    assert.equal(await second.locator('[data-link-summary-latest]').textContent(),'최신 요약: '+firstSummary);
    assert.equal(await stored(),firstSummary);
    await second.getByRole('button',{name:'저장',exact:true}).click();
    await second.waitForFunction(()=>window.__pendingRequests===0&&!document.querySelector('textarea').disabled);
    assert.equal(rpcCalls.length,2,'saving before explicit latest-summary review must not retry the RPC');
    assert.equal(await stored(),firstSummary);assert.equal(await second.locator('textarea').inputValue(),draft);
    await second.getByRole('button',{name:'최신 요약 확인',exact:true}).click();
    assert.equal(rpcCalls.length,2);assert.equal(await stored(),firstSummary);assert.equal(await second.locator('textarea').inputValue(),draft);
    await second.getByRole('button',{name:'저장',exact:true}).click();await second.locator('[data-link-summary-form]').waitFor({state:'detached'});
    assert.equal(rpcCalls.length,3);assert.equal(rpcCalls[2].expected,firstSummary);assert.deepEqual(rpcCalls[2].result,{ok:true});assert.equal(await stored(),draft);
    assert.deepEqual((await pool.query('select * from public.app_notes where id=$1',[note.id])).rows[0],sourceBefore);
    assert.deepEqual(errors,[]);
  }finally{
    if(browser)await browser.close();if(server)await close(server);
    if(pool){await pool.end();await Promise.all(clientEnds);}await cluster.stop();await rm(directory,{recursive:true,force:true});
  }
});

import {test,expect,devices} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
const {defaultBrowserType,...phone}=devices['Pixel 7'];
// UI-올리기진행표시 ②(S52-26, 요청함 11/07 11:40 ⑤ 전수): 자료실 올리기 창·끌어 놓기도 공용 부품(upload-progress.js)으로
// 막대와 %가 실제로 보낸 양(XMLHttpRequest upload.onprogress)만큼 차오르고, ✕는 다 보내기 전만 멈추며(서버에 자료가 생기지 않음),
// 다 보낸 뒤 답을 기다리면 '마무리 중…'. 느린 흉내 서버(127.0.0.1)가 받은 만큼만 브라우저의 보낸 양이 오른다. 합성 데이터만.
let api,assets,origin,apiOrigin,state;
const user={id:'up-owner',user_metadata:{display_name:'모의 소유자'}};
const project={id:'up-project',workspace_id:'up-workspace',owner_id:user.id,name:'모의 사업영역',status:'active',visibility:'private',metadata:{project_system:'v2',management_version:2}};
const MB=1048576;
const fixture=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/styles.css"><link rel="stylesheet" href="/app/ui-standard.css"><body>
<section id="libraryView"><input id="documentSearch"><div id="documentProject"></div><div id="documentList"></div></section>
<div id="documentModal"><div class="modal-card"><label>자료명<input id="docTitle"></label><input id="docCategory"><input id="docSource"><input id="docDate"><input id="docTags"><select id="docProject"></select><textarea id="docDescription"></textarea><button id="saveDocumentBtn" type="button">저장</button><div id="documentStatus"></div></div></div>
<script src="/app/runtime-client.js"></script>
<script>KPTURuntime.session.write({access_token:'mock-access',refresh_token:'mock-refresh',expires_at:9999999999,user:{id:'up-owner'}});</script>
<script type="module" src="/app/project-catalog.js"></script><script type="module" src="/app/library-upload.js"></script></body></html>`;

test.beforeAll(async()=>{
 api=createServer((req,res)=>{
  const path=new URL(req.url,apiOrigin).pathname;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers','authorization, x-client-info, apikey, content-type, prefer');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
  if(req.method==='OPTIONS'){res.end('ok');return}
  const chunks=[];let n=0;
  // 자료 올리기만 느리게 읽는다: 조각마다 쉬어 브라우저의 보낸 양이 조금씩 오른다.
  const slow=path==='/functions/v1/library-files';
  req.on('data',chunk=>{chunks.push(chunk);n+=chunk.length;if(slow){req.pause();setTimeout(()=>req.resume(),state.pauseMs)}});
  req.on('aborted',()=>{state.aborted++});
  req.on('end',async()=>{
   let data=[];
   if(path==='/auth/v1/user')data=user;
   if(path==='/rest/v1/app_workspace_members')data=[{workspace_id:project.workspace_id,role:'owner'}];
   if(path==='/rest/v1/app_spaces')data=[project];
   if(path==='/rest/v1/app_documents')data=state.documents;
   if(slow){
    await new Promise(r=>setTimeout(r,state.holdMs));
    const raw=Buffer.concat(chunks).toString('latin1'),name=Buffer.from(raw.match(/filename="([^"]*)"/)?.[1]||'','latin1').toString('utf8');
    state.received.push({name,bytes:n});
    const document={id:'up-doc-'+state.received.length,workspace_id:project.workspace_id,project_id:null,title:name,tags:[]};state.documents.push(document);data={ok:true,document};
   }
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));
  });
 });
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));apiOrigin=`http://127.0.0.1:${api.address().port}`;
 assets=createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  try{
   let source=path==='/fixture'?fixture:readFileSync('.'+path);
   if(path.endsWith('.js')||path.endsWith('.mjs'))source=String(source).replaceAll('https://xmlkxfjeagycwttklxjw.supabase.co',apiOrigin);
   res.setHeader('Content-Type',/\.m?js$/.test(path)?'text/javascript':path.endsWith('.css')?'text/css':'text/html');res.end(source);
  }catch{res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>assets.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${assets.address().port}`;
});
test.afterAll(async()=>{for(const server of [api,assets]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}});

async function open(page){
 state={pauseMs:40,holdMs:0,aborted:0,received:[],documents:[]};
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/fixture');
 await expect.poll(()=>page.evaluate(()=>window.__KPTU_LIBRARY_UPLOAD_READY__)).toBe(true);
 return errors;
}
async function percents(locator,ms){
 const seen=[],end=Date.now()+ms;
 while(Date.now()<end){const t=await locator.first().textContent().catch(()=>'');const m=/(\d+)%/.exec(t||'');if(m){const v=Number(m[1]);if(seen.at(-1)!==v)seen.push(v)}await new Promise(r=>setTimeout(r,100))}
 return seen;
}
const big=(name,mb)=>({name,mimeType:'application/pdf',buffer:Buffer.concat([Buffer.from('%PDF-1.4\n'),Buffer.alloc(mb*MB,7)])});

for(const width of [390,1280])test.describe(`자료실 올리기 ${width}px`,()=>{
 test.use(width===390?{...phone,viewport:{width,height:900}}:{viewport:{width,height:900}});
 test(`[저장] 뒤 고른 파일 줄 안 막대·%가 실제 보낸 양으로 오르고, 다 보내면 마무리 중…, 끝나면 창이 닫힌다 ${width}px`,async({page})=>{
  test.setTimeout(90000);
  const errors=await open(page);
  await page.locator('#libraryFileInput').setInputFiles(big('모의 자료.pdf',16));
  state.holdMs=1500;state.pauseMs=60;
  await page.locator('#saveDocumentBtn').click();
  const row=page.locator('[data-lu-upload-file]').first(),pc=row.locator('.up-inline .up-pc');
  await expect(row.locator('.up-inline [role="progressbar"]')).toBeVisible();
  // 위 합계 줄: '올리는 중 1개 · 보낸 양/전체 · %'(공용 부품 그대로).
  await expect(page.locator('[data-lu-upload-progress] .up-sum')).toContainText(/올리는 중 1개 · .+ \/ 16\.0MB/);
  const seen=await percents(pc,4000);
  expect(seen.length,`본 %: ${seen}`).toBeGreaterThan(2);
  expect(seen.every((v,i)=>!i||v>=seen[i-1])).toBe(true);
  expect(seen.at(-1)).toBeLessThan(100);
  await expect(pc).toHaveText('마무리 중…',{timeout:30000});
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/,{timeout:15000});
  expect(state.received.map(r=>r.name)).toEqual(['모의 자료.pdf']);
  expect(errors).toEqual([]);
 });
 test(`보내는 중 ✕(올리기 취소)는 그 파일만 멈추고 서버에 자료가 생기지 않으며 줄은 '취소함', 다음 파일은 이어 올린다 ${width}px`,async({page})=>{
  test.setTimeout(90000);
  const errors=await open(page);
  state.pauseMs=80;
  await page.locator('#libraryFileInput').setInputFiles([big('멈출 자료.pdf',8),big('다음 자료.pdf',1)]);
  await page.locator('#saveDocumentBtn').click();
  const first=page.locator('[data-lu-upload-file="0"]');
  await expect(first.locator('.up-inline .up-pc')).toHaveText(/\d+%/);
  await first.getByRole('button',{name:'멈출 자료.pdf 올리기 취소'}).click();
  await expect(first.locator('[data-lu-upload-state]')).toContainText('취소함');
  await expect.poll(()=>state.received.map(r=>r.name),{timeout:30000}).toEqual(['다음 자료.pdf']);
  await expect(page.locator('[data-lu-upload-file="1"] [data-lu-upload-state]')).toHaveText('완료');
  // 다시 [저장]하면 취소한 파일만 올린다.
  state.pauseMs=5;
  await page.locator('#saveDocumentBtn').click();
  await expect(page.locator('#documentModal')).toHaveClass(/hidden/,{timeout:30000});
  expect(state.received.map(r=>r.name)).toEqual(['다음 자료.pdf','멈출 자료.pdf']);
  expect(errors).toEqual([]);
 });
});

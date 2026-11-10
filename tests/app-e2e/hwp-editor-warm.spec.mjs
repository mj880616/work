import {test,expect,chromium} from '@playwright/test';
import {mkdtempSync,rmSync,readFileSync,statSync,createReadStream} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname,sep} from 'node:path';
import {createServer} from 'node:http';
import {editorHashedAsset} from '../../cloudflare/bokdoong-router.mjs';
// LIB-편집열기느림(S55-15) 단계별 실측과 미리 받기: 운영처럼 답하는 작은 서버(hwp-editor-cache.spec.mjs와 같은 규칙 — 번호 없는 파일은 매번 확인,
// 이름에 해시가 든 편집기 부품은 오래 보관, ACAO *)를 띄우고, 디스크 캐시가 있는 브라우저(launchPersistentContext)에서
// ① 파일 받기 ② 편집기 준비 ③ 펼치기를 잰다. 편집기 부품·시험 파일은 정해진 회선 속도로만 보낸다(PC 3MB/s, 폰 1MB/s 흉내, 압축 없음).
// 비교: 미리 받기 없이 첫 [편집] / 자료실이 미리 받기(hwp-warm.js)를 끝낸 뒤 첫 [편집]. page.route는 HTTP 캐시를 끄므로 쓰지 않는다.
const ROOT=resolve(new URL('../..',import.meta.url).pathname);
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png','.hwpx':'application/octet-stream'};
const FILE='/tests/fixtures/hwp-lab/sample.hwpx';

function server(log,rate){
  return createServer((req,res)=>{
    const path=decodeURIComponent(new URL(req.url,'http://x').pathname);
    const file=resolve(ROOT,'.'+path);
    if(!file.startsWith(ROOT+sep)){res.writeHead(403).end();return}
    let stat;try{stat=statSync(file);if(!stat.isFile())throw 0}catch{res.writeHead(404).end();return}
    const etag=`"1-${stat.size.toString(16)}"`;
    const keep=editorHashedAsset('bokdoong.com',new URL('https://bokdoong.com/work'+path));
    const headers={'content-type':TYPES[extname(file)]||'application/octet-stream','access-control-allow-origin':'*','cache-control':keep?'public, max-age=31536000, immutable':'no-cache, must-revalidate',etag};
    const slow=path.startsWith('/app/hwp-lab/rhwp-')||path===FILE;
    if(req.headers['if-none-match']===etag){res.writeHead(304,headers).end();return}
    res.writeHead(200,{...headers,'content-length':stat.size});
    if(slow)log.push({path,bytes:stat.size,by:req.headers.origin==='null'?'frame':'page'});
    if(!slow){createReadStream(file).pipe(res);return}
    const stream=createReadStream(file,{highWaterMark:64*1024}),started=Date.now();let sent=0;
    stream.on('data',chunk=>{sent+=chunk.length;res.write(chunk);const wait=sent/rate*1000-(Date.now()-started);if(wait>0){stream.pause();setTimeout(()=>stream.resume(),wait)}});
    stream.on('end',()=>res.end());stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());
  });
}
const mib=n=>(n/1048576).toFixed(1)+'MiB';
const editorBytes=rows=>rows.filter(r=>r.path.startsWith('/app/hwp-lab/rhwp-')).reduce((n,r)=>n+r.bytes,0);

async function run(rate,warm){
  const log=[],srv=server(log,rate);
  await new Promise(done=>srv.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${srv.address().port}`,dir=mkdtempSync(join(tmpdir(),'hwp-warm-'));
  const context=await chromium.launchPersistentContext(dir,{headless:true});
  try{
    let warmed=null;
    if(warm){
      // 자료실을 연 창에서 미리 받기를 끝낸다(그 창을 닫고 나중에 [편집]을 눌러도 같은 브라우저 캐시).
      const page=await context.newPage();await page.goto(origin+'/tests/app-e2e/hwp-warm-fixture.html');
      await page.waitForFunction(()=>window.fixtureReady===true);
      warmed={...await page.evaluate(()=>window.warmOnce()),bytes:editorBytes(log)};
      await page.close();
    }
    log.length=0;
    const page=await context.newPage();await page.goto(origin+'/tests/app-e2e/hwp-warm-fixture.html');
    await page.waitForFunction(()=>window.fixtureReady===true);
    const lap=await page.evaluate(f=>window.openStages(f),FILE);
    expect(lap.pages).toBeGreaterThan(0);
    return {...lap,bytes:editorBytes(log),warmed};
  }finally{
    await context.close();rmSync(dir,{recursive:true,force:true});
    srv.closeAllConnections();await new Promise(done=>srv.close(done));
  }
}

for(const [name,rate] of [['PC 3MB/s',3*1024*1024],['폰 1MB/s',1024*1024]])
test(`${name}: 미리 받기를 끝낸 뒤 첫 [편집]은 편집기 부품을 받지 않고 바로 준비된다(단계별 ms 기록)`,async()=>{
  test.setTimeout(240000);
  const before=await run(rate,false),after=await run(rate,true);
  for(const [label,r] of [['미리 받기 없음',before],['미리 받기 뒤',after]]){
    const line=`[LIB-편집열기느림 단계] ${name} ${label}: ① 파일 ${r.fileMs}ms ② 편집기 준비 ${r.editorMs}ms ③ 펼치기 ${r.loadMs}ms · 전체 ${r.totalMs}ms · 편집기 부품 받은 양 ${mib(r.bytes)}`+(r.warmed?` (미리 받기 ${r.warmed.result} ${r.warmed.warmMs}ms · ${mib(r.warmed.bytes)})`:'');
    console.log(`::notice title=LIB-편집열기느림 단계::${line}`);
    test.info().annotations.push({type:'measure',description:line});
  }
  expect(before.bytes).toBeGreaterThan(10*1048576);
  expect(after.warmed.result).toBe('done');
  expect(after.warmed.bytes).toBeGreaterThan(10*1048576);
  // 미리 받은 부품은 편집기 frame이 다시 받지 않는다(같은 캐시 칸). 남는 것은 해시 없는 작은 파일뿐.
  expect(after.bytes).toBeLessThan(1048576);
  expect(after.editorMs).toBeLessThan(before.editorMs);
});

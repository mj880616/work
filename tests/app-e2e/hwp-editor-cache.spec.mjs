import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {readFileSync,statSync,createReadStream} from 'node:fs';
import {resolve,extname,sep} from 'node:path';
// LIB-편집열기느림 실측: 자료실 [편집]이 여는 칸막이 편집기(hwp-frame.js)를 같은 브라우저에서 두 번(앱을 다시 연 것처럼) 띄우고,
// 편집기 부품을 서버에서 몇 바이트 받았는지와 걸린 시간을 잰다.
// - GitHub Pages처럼 답하는 작은 서버를 이 시험 안에서 띄운다(Access-Control-Allow-Origin: *, Cache-Control: max-age=600, ETag·304).
//   page.route는 브라우저 HTTP 캐시를 끄므로 쓰지 않는다(캐시가 실제로 쓰이는지가 이 시험의 대상이다).
// - 편집기 부품(app/hwp-lab/)은 초당 RATE 바이트로만 보낸다(폰·PC 보통 회선 흉내). 압축은 하지 않는다.
const ROOT=resolve(new URL('../..',import.meta.url).pathname);
const RATE=3*1024*1024;
const TYPES={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.woff2':'font/woff2','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon','.png':'image/png'};
const HWPX=readFileSync(new URL('../fixtures/hwp-lab/sample.hwpx',import.meta.url)).toString('base64');

function pagesLikeServer(log){
  return createServer((req,res)=>{
    const path=decodeURIComponent(new URL(req.url,'http://x').pathname);
    const file=resolve(ROOT,'.'+path);
    if(!file.startsWith(ROOT+sep)){res.writeHead(403).end();return}
    let stat;
    try{stat=statSync(file);if(!stat.isFile())throw 0}catch{res.writeHead(404).end();return}
    const etag=`"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers={'content-type':TYPES[extname(file)]||'application/octet-stream','access-control-allow-origin':'*','cache-control':'max-age=600',etag};
    const editorPart=path.startsWith('/app/hwp-lab/');
    if(req.headers['if-none-match']===etag){
      if(editorPart)log.push({path,status:304,bytes:0});
      res.writeHead(304,headers).end();return;
    }
    res.writeHead(200,{...headers,'content-length':stat.size});
    if(editorPart)log.push({path,status:200,bytes:stat.size});
    if(!editorPart){createReadStream(file).pipe(res);return}
    // 편집기 부품만 정해진 속도로 보낸다.
    const stream=createReadStream(file,{highWaterMark:64*1024});
    const started=Date.now();let sent=0;
    stream.on('data',chunk=>{
      sent+=chunk.length;res.write(chunk);
      const wait=sent/RATE*1000-(Date.now()-started);
      if(wait>0){stream.pause();setTimeout(()=>stream.resume(),wait)}
    });
    stream.on('end',()=>res.end());
    stream.on('error',()=>res.destroy());
    res.on('close',()=>stream.destroy());
  });
}

const sum=(rows,test)=>rows.filter(test).reduce((n,row)=>n+row.bytes,0);
const mib=n=>(n/1048576).toFixed(1)+'MiB';

test('편집기를 두 번째 열 때 큰 편집기 부품을 다시 받지 않는다',async({page})=>{
  test.setTimeout(180000);
  const log=[];
  const server=pagesLikeServer(log);
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const rounds=[];
    for(const round of [1,2]){
      log.length=0;
      await page.goto(origin+'/tests/app-e2e/hwp-frame-cache-fixture.html');
      await page.waitForFunction(()=>window.fixtureReady===true);
      const timing=await page.evaluate(b64=>window.openEditorOnce(b64),HWPX);
      expect(timing.pages).toBeGreaterThan(0);
      const rows=[...log];
      const wasm=sum(rows,row=>row.path.endsWith('.wasm'));
      const all=sum(rows,()=>true);
      rounds.push({round,...timing,editorBytes:all,wasmBytes:wasm,requests:rows.length,fresh:rows.filter(row=>row.status===200).map(row=>row.path.replace(/^.*\/studio\//,'')+' '+mib(row.bytes))});
    }
    for(const r of rounds){
      const line=`[LIB-편집열기느림 실측] ${r.round}번째 열기: 편집기 준비 ${r.readyMs}ms, 파일 펼치기 ${r.openMs}ms, 편집기 부품 받은 양 ${mib(r.editorBytes)}(WASM ${mib(r.wasmBytes)}), 요청 ${r.requests}개`;
      // GitHub Actions 기록 위에 한 줄 알림으로도 남긴다(전후 비교 근거).
      console.log(`::notice title=LIB-편집열기느림 실측::${line} / 새로 받은 파일: ${r.fresh.join(', ')||'없음'}`);
      test.info().annotations.push({type:'measure',description:line});
    }
    // 처음에는 엔진 파일을 받고, 두 번째에는 Web2 창의 캐시로 넘겨받아 서버에서 다시 받지 않는다.
    expect(rounds[0].wasmBytes).toBeGreaterThan(10*1048576);
    expect(rounds[1].wasmBytes).toBe(0);
  }finally{
    server.closeAllConnections();
    await new Promise(done=>server.close(done));
  }
});

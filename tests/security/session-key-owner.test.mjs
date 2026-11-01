// QA-미완점검(S47-54): 로그인 세션의 기기 저장 이름(옛 협업 시절 이름 그대로)은 runtime-client.js 한 곳만 가진다.
// 다른 화면 모듈은 KPTURuntime.session(read/write/refresh/ensure)으로만 세션을 읽고 쓴다. 그래야 로그인·로그아웃·사용자 바뀜 때
// 사용자별 캐시 지우기와 세션 세대 올리기(runtime-client.js write)가 빠짐없이 돈다. 로그아웃은 write(null)로 저장 이름을 지운다.
// app/legacy/는 지금 진입 경로에서 불러오지 않는 격리 파일이라 제외한다(app/ARCHITECTURE.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const app=join(root,'app');
const NAME='kptu_collab_session_v1';
function walk(dir,out=[]){
  for(const name of readdirSync(dir)){
    const path=join(dir,name),rel=relative(root,path).replaceAll('\\','/');
    if(rel==='app/legacy'||/^app\/hwp-lab\/rhwp-/.test(rel)||name==='node_modules')continue;
    if(statSync(path).isDirectory())walk(path,out);
    else if(/\.(m?js|html)$/.test(name))out.push(rel);
  }
  return out;
}

test('the session storage name lives only in runtime-client.js',()=>{
  const users=walk(app).filter(rel=>readFileSync(join(root,rel),'utf8').includes(NAME));
  assert.deepEqual(users,['app/runtime-client.js']);
});

test('sign-in, handoff and session checks go through KPTURuntime.session',()=>{
  const read=rel=>readFileSync(join(root,rel),'utf8');
  for(const rel of ['app/auth-bootstrap.js','app/auth-handoff-client.js','app/session-resilience.js','app/team.js','app/library-upload.js']){
    assert.doesNotMatch(read(rel),/\blocalStorage\b/,rel+' must not touch browser storage for the session');
  }
  assert.match(read('app/auth-bootstrap.js'),/window\.KPTURuntime\.session\.write\(session\)/);
  assert.match(read('app/auth-handoff-client.js'),/window\.KPTURuntime\.session\.write\(s\)/);
});

test('logout clears the stored session through the runtime store',()=>{
  const team=readFileSync(join(root,'app/team.js'),'utf8'),runtime=readFileSync(join(root,'app/runtime-client.js'),'utf8');
  assert.match(team,/async function logout\(\)\{[^\n]*saveSession\(null\)/);
  assert.match(team,/function saveSession\(s\)\{session=s;window\.KPTURuntime\?\.session\?\.write\(s\)\}/);
  assert.match(runtime,/else localStorage\.removeItem\(config\.sessionKey\);/);
});

test('the login page and the loader load the runtime before the session modules',()=>{
  const login=readFileSync(join(root,'app/login/index.html'),'utf8'),loader=readFileSync(join(root,'app/loader-v2.js'),'utf8');
  assert.ok(login.indexOf('runtime-client.js')<login.indexOf('auth-bootstrap.js'));
  const ready=loader.indexOf('await runtimeReady');
  assert.ok(ready>0&&ready<loader.indexOf("import('./auth-handoff-client.js')")&&ready<loader.indexOf("import('./auth-bootstrap.js')"));
});

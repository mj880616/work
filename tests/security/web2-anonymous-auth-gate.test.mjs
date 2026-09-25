import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const loader=readFileSync(new URL('../../app/loader-v2.js',import.meta.url),'utf8');
const router=readFileSync(new URL('../../app/app-router.js',import.meta.url),'utf8');
const capabilities=readFileSync(new URL('../../app/capabilities.js',import.meta.url),'utf8');
const login=readFileSync(new URL('../../app/login/index.html',import.meta.url),'utf8');
const team=readFileSync(new URL('../../app/team.js',import.meta.url),'utf8');

test('anonymous Web2 boot redirects to login before workspace routing or features load',()=>{
  assert.doesNotMatch(loader,/import\(['"]\.\/public-workspace\.js/);
  assert.match(loader,/const loginUrl=\(\)=>window\.KPTUAuth\.loginUrl\(location\.href\)/);
  assert.match(loader,/if\(!authenticated\)\s*\{[\s\S]*?redirectToLogin\(\);[\s\S]*?return;/);
  assert.ok(loader.indexOf("import('./app-router.js")>loader.indexOf('if(!authenticated)'));
  assert.ok(loader.indexOf("import('./team.js")>loader.indexOf('if(!authenticated)'));
});

test('Web2 router has no anonymous public home fallback',()=>{
  assert.doesNotMatch(router,/publicHomeAvailable|kptu-public-workspace|source:'public'/);
  assert.match(router,/authenticatedShellReady\(\)/);
});

test('Web2 read capabilities require a signed-in session even for public resources',()=>{
  const sandbox={
    window:{
      KPTURuntime:{
        session:{read:()=>null}
      }
    },
    location:{href:'https://desk.bokdoong.com/work/app/'},
    CustomEvent:class CustomEvent{}
  };
  vm.runInNewContext(capabilities,sandbox);
  const caps=sandbox.window.KPTUCapabilities;
  assert.equal(caps.can('project.read',{visibility:'public'}),false);
  assert.equal(caps.can('page.read',{status:'published',visibility:'public'}),false);
  assert.equal(caps.can('task.read',{project_id:'project-1',project_public:true}),false);
});

test('dedicated login does not offer the retired Web2 public workspace',()=>{
  assert.doesNotMatch(login,/공개 프로젝트|로그인 없이 공개 업무 보기|id="publicBackLink"/);
});

test('session loss and bfcache restoration lock private UI before navigation',()=>{
  assert.match(loader,/kptu:session-changed/);
  assert.match(loader,/addEventListener\('storage'/);
  assert.match(loader,/event\.key!==window\.KPTURuntime\.config\.sessionKey/);
  assert.match(loader,/pageshow/);
  assert.match(loader,/\.inert\s*=\s*true/);
  assert.match(loader,/context\?\.clear\?\.\(\)/);
});

test('authenticated workspace initialization errors remain recoverable',()=>{
  assert.match(login,/Web2 업무정보는 로그인한 사용자만 볼 수 있습니다/);
  assert.match(team,/showWorkspaceError\(\)/);
  assert.match(team,/bootRetryBtn/);
  assert.match(team,/bootLogoutBtn/);
});

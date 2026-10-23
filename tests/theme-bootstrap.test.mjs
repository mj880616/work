import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
// SET-보기선택서버저장: 화면 색은 서버(프로필 view_prefs)에서 읽는다. 로그인 전·첫 줄 스크립트는 기기 저장소를 읽지 않고 기본(올리브)만 건다.
// 저장된 색은 loader-v2.js가 첫 화면을 공개하기 전에 적용한다.
for(const path of ['app/index.html','app/login/index.html']){
 const html=readFileSync(path,'utf8');
 const script=html.match(/<script data-kptu-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];
 test(path+' sets the default theme before CSS without touching browser storage',()=>{
  assert.ok(script,'missing early theme bootstrap');
  assert.ok(html.indexOf('data-kptu-theme-bootstrap')<html.indexOf('rel="stylesheet"'));
  assert.doesNotMatch(script,/Storage|storage/);
  let theme;
  const context={document:{documentElement:{setAttribute:(key,value)=>theme=[key,value]}}};
  Object.defineProperty(context,'localStorage',{get(){throw Error('storage must not be read')}});
  assert.doesNotThrow(()=>vm.runInNewContext(script,context));
  assert.deepEqual(theme,['data-theme','olive']);
 });
}
test('loader applies the saved theme before the first screen is shown',()=>{
 const loader=readFileSync('app/loader-v2.js','utf8');
 const apply=loader.indexOf("viewPrefs?.get('theme')"),reveal=loader.indexOf("app?.classList.add('kptu-shell-ready')"),owner=loader.indexOf("if(teamState!=='workspace')return;");
 assert.ok(loader.includes("import('./view-prefs.js')"));
 assert.ok(owner>0&&apply>owner,'prefs are read only after the owner is confirmed');
 assert.ok(apply>0&&reveal>apply,'theme must be applied before the app screen is revealed');
 assert.doesNotMatch(loader,/MutationObserver/);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
for(const path of ['app/index.html','app/login/index.html']){
 const html=readFileSync(path,'utf8');
 const script=html.match(/<script data-kptu-theme-bootstrap>([\s\S]*?)<\/script>/)?.[1];
 test(path+' applies validated stored theme before CSS',()=>{
  assert.ok(script,'missing early theme bootstrap');
  assert.ok(html.indexOf('data-kptu-theme-bootstrap')<html.indexOf('rel="stylesheet"'));
  for(const value of [null,'olive','navy','terracotta','sand','invalid']){
   let theme;vm.runInNewContext(script,{document:{documentElement:{setAttribute:(key,value)=>theme=value}},localStorage:{getItem:()=>value}});
   assert.equal(theme,['olive','navy','terracotta','sand'].includes(value)?value:'olive');
  }
 });
 test(path+' tolerates blocked storage',()=>{
  assert.ok(script);let theme;
  const context={document:{documentElement:{setAttribute:(key,value)=>theme=value}}};
  Object.defineProperty(context,'localStorage',{get(){throw Error('blocked')}});
  assert.doesNotThrow(()=>vm.runInNewContext(script,context));assert.equal(theme,'olive');
 });
}

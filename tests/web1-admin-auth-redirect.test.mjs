import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import vm from 'node:vm';

const source=readFileSync(new URL('../app/web1-admin-auth.js',import.meta.url),'utf8');

function load({path='/work/p/',search='',hash='',storage=new Map()}={}){
  const location={origin:'https://work.bokdoong.com',pathname:path,search,hash,reloadCount:0};
  Object.defineProperty(location,'href',{set(value){location.nextHref=value}});
  location.reload=()=>{location.reloadCount++};
  const sessionStorage={
    getItem:key=>storage.get(key)??null,
    setItem:(key,value)=>storage.set(key,value),
    removeItem:key=>storage.delete(key)
  };
  const localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  const history={replaceState(_state,_title,url){const next=new URL(url,location.origin);location.pathname=next.pathname;location.search=next.search;location.hash=next.hash}};
  const window={};
  vm.runInNewContext(source,{window,location,history,sessionStorage,localStorage,URLSearchParams,URL,Date,fetch:()=>{throw new Error('unexpected fetch')}});
  return {location,auth:window.KPTUWeb1AdminAuth,storage};
}

test('Web1 OAuth allowlist callback uses the exact page path',()=>{
  const {location,auth}=load({search:'?slug=example&external=1'});
  auth.signInWithGoogle();
  const next=new URL(location.nextHref);
  assert.equal(next.searchParams.get('redirect_to'),'https://work.bokdoong.com/work/p/');
});

test('Web1 OAuth restores the original query after consuming a callback',()=>{
  const storage=new Map();
  load({search:'?slug=example&external=1',storage}).auth.signInWithGoogle();
  const {location}=load({hash:'#access_token=token&refresh_token=refresh&expires_in=3600',storage});
  assert.equal(location.search,'?slug=example&external=1');
  assert.equal(location.hash,'');
  assert.equal(location.reloadCount,1);
  assert.equal(storage.size,0);
});

test('Web1 OAuth does not restore a query for a different callback path',()=>{
  const storage=new Map();
  load({search:'?slug=example',storage}).auth.signInWithGoogle();
  const {location}=load({path:'/work/2in1/',hash:'#access_token=token&refresh_token=refresh',storage});
  assert.equal(location.search,'');
  assert.equal(location.reloadCount,0);
  assert.equal(storage.size,0);
});

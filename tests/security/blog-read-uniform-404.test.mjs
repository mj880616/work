import test from 'node:test';
import assert from 'node:assert/strict';
import {store,handler,read,KEYS} from './blog-read-harness.mjs';
// BLOG ① 9절 '모든 없음이 같은 404 모양, 응답에 내부 id·작업공간·이메일 없음'.
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
test('every "none" is the same 404 body and headers',async()=>{
 const cases=[];
 const off=store();off.blogs[0].enabled=false;
 const noAllow=store();noAllow.allow=[];
 const noBlog=store();noBlog.blogs=noBlog.blogs.slice(1);
 for(const [s,body] of [[off,{blog:'home'}],[noAllow,{blog:'home'}],[noBlog,{blog:'home'}],[store(),{blog:'board',board:'ffffffffff'}],
  [store(),{blog:'post',post:KEYS.postDraft}],[store(),{blog:'post',post:KEYS.postTrash}],[store(),{blog:'post',post:KEYS.postOther}],
  [store(),{blog:'nope'}],[store(),{blog:'home',x:1}],[store(),{blog:'board'}],[store(),{blog:'board',board:'AAAAAAAAAA'}],[store(),{blog:'board',board:KEYS.boardA,page:-1}],
  [store(),{blog:'board',board:KEYS.boardA,page:1.5}],[store(),{blog:'board',board:KEYS.boardA,page:'1'}],[store(),{blog:'post',post:KEYS.postA,head:true}],
  [store(),{blog:'post',post:KEYS.postA,token:'a1'.repeat(32)}],[store(),{blog:['home']}],[store(),{blog:'home',blog2:'x'}]])
  cases.push(await read(handler(s),body));
 const first=cases[0];
 for(const c of cases){assert.equal(c.status,404);assert.equal(c.text,'{"error":"not_found"}');assert.deepEqual(c.headers,first.headers);}
 assert.equal(first.headers['cache-control'],'no-store, max-age=0');
 assert.match(first.headers['x-robots-tag'],/noindex/);
});
test('success bodies carry no uuid, workspace, note, page or e-mail field',async()=>{
 const s=store(),h=handler(s);
 for(const body of [{blog:'home'},{blog:'board',board:KEYS.boardA},{blog:'post',post:KEYS.postA}]){
  const r=await read(h,body);assert.equal(r.status,200);
  const text=r.text.replace(/"https:\/\/example\.supabase\.co[^"]*"/g,'""');
  assert.doesNotMatch(text.replace(/"share:[0-9a-f-]{36}"/g,'""').replace(/"[0-9a-f-]{36}":/g,'"":'),UUID,JSON.stringify(body));
  assert.doesNotMatch(r.text,/workspace|note_id|page_id|board_id|"id"|@|email|owner/i);
 }
 // 사진 id는 그 글 페이지 소속으로 서명한 것만 media 키에(글 블록의 share:<id>와 짝) — 그 밖에 uuid 없음.
 const post=JSON.parse((await read(h,{blog:'post',post:KEYS.postA})).text);
 assert.deepEqual(Object.keys(post).sort(),['blog','board','media','ok','post']);
 assert.deepEqual(Object.keys(post.post).sort(),['blocks','date','key','title','updated']);
 assert.equal(post.post.date,'2026-11-25');
});
test('CORS: bokdoong.com allowed for the blog page; other origins refused before any lookup',async()=>{
 const s=store();
 const ok=await read(handler(s),{blog:'home'});assert.equal(ok.headers['access-control-allow-origin'],'https://bokdoong.com');
 for(const origin of ['https://workonplus.com','https://evil.example','https://www.bokdoong.com']){
  const r=await read(handler(s),{blog:'home'},{origin});assert.equal(r.status,403);
 }
 assert.equal(s.calls.filter(c=>c[0]==='workspace').length,1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {store,handler,read,KEYS,IDS} from './blog-read-harness.mjs';
// BLOG ① 9절 '비공개 노트가 익명 경로로 안 보임'(게시 안 한 노트, 링크 게시만 한 노트, 틀린·남의 key).
// 블로그 길은 노트 글을 읽지 않는다(사본 페이지만). 노트 표는 id·휴지통 칸만 묻는다.
test('only posted copies appear; unposted notes, link-only pages and other blogs never do',async()=>{
 const s=store(),h=handler(s);
 const texts=[];
 for(const body of [{blog:'home'},{blog:'board',board:KEYS.boardA},{blog:'board',board:KEYS.boardB},{blog:'post',post:KEYS.postA},{blog:'post',post:KEYS.postB}]){
  const r=await read(h,body);assert.equal(r.status,200,JSON.stringify(body));texts.push(r.text);
 }
 const all=texts.join('\n');
 for(const secret of ['비밀','링크로만 보낸 글','링크 본문','남의','노트 원본'])assert.ok(!all.includes(secret),secret);
 assert.ok(all.includes('공개 본문'));
 const board=JSON.parse(texts[1]);
 assert.deepEqual(board.posts.map(p=>p.key),[KEYS.postB,KEYS.postA]);
 assert.ok(!s.calls.some(c=>c[0]==='pagesByIds'&&c[1].includes(IDS.pageLink)),'link-only page never asked');
 assert.ok(!s.calls.some(c=>(c[0]==='notesByIds')&&c[1].includes(IDS.noteSecret)),'unposted note never asked');
 assert.ok(!s.calls.some(c=>c[0]==='link'||c[0]==='page'),'blog path does not touch the link path');
});
test('wrong, foreign or made-up keys are 404 and do not reach the page or note tables',async()=>{
 const s=store(),h=handler(s);
 for(const body of [{blog:'post',post:KEYS.postOther},{blog:'post',post:'0123456789'},{blog:'board',board:KEYS.boardOther},{blog:'board',board:'0123456789'},
  {blog:'post',post:IDS.pageLink},{blog:'post',post:IDS.noteSecret}]){
  const r=await read(h,body);assert.equal(r.status,404,JSON.stringify(body));
 }
 assert.ok(!s.calls.some(c=>c[0]==='pagesByIds'||c[0]==='notesByIds'));
});
test('the reader never selects note text: the note lookup returns only id and trash time',async()=>{
 const s=store();let seen=null;const h=handler(s);
 await read(h,{blog:'post',post:KEYS.postA});
 seen=s.calls.find(c=>c[0]==='notesByIds');assert.deepEqual(seen[1],[IDS.noteA]);
 const {readFileSync}=await import('node:fs');
 const index=readFileSync('supabase/functions/share-page-read/index.ts','utf8');
 const blog=index.slice(index.indexOf('\n  blog: {'));
 assert.match(blog,/from\("app_notes"\)\s*\.select\("id,deleted_at"\)/);
});

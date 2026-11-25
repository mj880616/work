import test from 'node:test';
import assert from 'node:assert/strict';
import {store,handler,read,KEYS} from './blog-read-harness.mjs';
// BLOG ① 9절 '내린 글은 즉시 안 보임'(서버 부분): 페이지 draft·archived(휴지통), 노트 휴지통·완전히 지움, 블로그 끄기, 게시판 옮기기.
const status=async(s,body)=>(await read(handler(s),body)).status;
const keysOf=async(s,board)=>JSON.parse((await read(handler(s),{blog:'board',board})).text).posts.map(p=>p.key);
test('take down (page draft) and trash (archived) are 404 at once and leave the lists',async()=>{
 for(const st of ['draft','archived']){
  const s=store();assert.equal(await status(s,{blog:'post',post:KEYS.postA}),200);
  s.pages[0].status=st;s.pages[0].blocks=[];
  assert.equal(await status(s,{blog:'post',post:KEYS.postA}),404,st);
  assert.deepEqual(await keysOf(s,KEYS.boardA),[KEYS.postB]);
  const home=JSON.parse((await read(handler(s),{blog:'home'})).text);
  assert.equal(home.boards.find(b=>b.key===KEYS.boardA).count,1);
 }
});
test('note in trash or purged: 404 even while the copy page is still published',async()=>{
 const s=store();assert.equal(await status(s,{blog:'post',post:KEYS.postTrash}),404);
 assert.ok(!(await keysOf(s,KEYS.boardB)).includes(KEYS.postTrash));
 const p=store();p.posts[0].note_id=null;assert.equal(await status(p,{blog:'post',post:KEYS.postA}),404);
 const g=store();g.notes=g.notes.filter(n=>n.id!==g.posts[0].note_id);assert.equal(await status(g,{blog:'post',post:KEYS.postA}),404);
});
test('turning the blog off makes every blog address 404; turning on brings them back unchanged',async()=>{
 const s=store();s.blogs[0].enabled=false;
 for(const body of [{blog:'home'},{blog:'board',board:KEYS.boardA},{blog:'post',post:KEYS.postA}])assert.equal(await status(s,body),404);
 s.blogs[0].enabled=true;assert.equal(await status(s,{blog:'post',post:KEYS.postA}),200);
});
test('moving a post to another board removes it from the old board list',async()=>{
 const s=store();s.posts[0].board_id=s.boards[1].id;
 assert.deepEqual(await keysOf(s,KEYS.boardA),[KEYS.postB]);
 assert.deepEqual(await keysOf(s,KEYS.boardB),[KEYS.postA]);
 const post=JSON.parse((await read(handler(s),{blog:'post',post:KEYS.postA})).text);assert.equal(post.board.key,KEYS.boardB);
});
test('a post whose board belongs to another blog is never shown, even with a correct key',async()=>{
 const s=store();s.posts[0].board_id=s.boards[2].id;
 assert.equal(await status(s,{blog:'post',post:KEYS.postA}),404);
});
test('board pages: 30 per page, newest first, more flag',async()=>{
 const s=store();
 for(let i=0;i<40;i++){const k=String(i).padStart(10,'1');const pid='53000000-0000-4000-8000-'+String(i).padStart(12,'0'),nid='54000000-0000-4000-8000-'+String(i).padStart(12,'0');
  s.posts.push({board_id:s.boards[1].id,page_id:pid,note_id:nid,public_key:k,published_at:new Date(Date.UTC(2026,9,1,0,i)).toISOString(),republished_at:null});
  s.pages.push({id:pid,title:'글 '+i,blocks:[],status:'published'});s.notes.push({id:nid,deleted_at:null});}
 const p0=JSON.parse((await read(handler(s),{blog:'board',board:KEYS.boardB})).text);
 const p1=JSON.parse((await read(handler(s),{blog:'board',board:KEYS.boardB,page:1})).text);
 assert.equal(p0.posts.length,30);assert.equal(p0.more,true);assert.equal(p1.posts.length,10);assert.equal(p1.more,false);
 assert.equal(p0.posts[0].title,'글 39');
});

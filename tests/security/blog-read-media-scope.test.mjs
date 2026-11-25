import test from 'node:test';
import assert from 'node:assert/strict';
import {store,handler,read,KEYS,IDS} from './blog-read-harness.mjs';
// BLOG ① 9절 '사진은 그 글 페이지 소속만, Drive 번호·첨부 링크 없음'. EXIF 지우기는 올릴 때(share-page-media, 기존 시험 share-page-media.test.mjs)가 맡는다.
test('photos are signed only for media rows of that post page; another page photo id in the copy stays unsigned',async()=>{
 const s=store(),h=handler(s);
 const r=JSON.parse((await read(h,{blog:'post',post:KEYS.postA})).text);
 assert.deepEqual(Object.keys(r.media),[IDS.mediaA]);
 const ask=s.calls.find(c=>c[0]==='mediaForPage');assert.equal(ask[1][0],IDS.pageA);
 assert.deepEqual(s.calls.filter(c=>c[0]==='signMedia').map(c=>c[1]),[['share/a.jpg',300]]);
});
test('lists never sign photos; a post without photos has no media key; signing trouble keeps the text',async()=>{
 const s=store(),h=handler(s);
 await read(h,{blog:'home'});await read(h,{blog:'board',board:KEYS.boardA});
 assert.ok(!s.calls.some(c=>c[0]==='mediaForPage'||c[0]==='signMedia'));
 const b=JSON.parse((await read(h,{blog:'post',post:KEYS.postB})).text);assert.equal(b.media,undefined);
 const broken=store(),logs=[];const hb=handler(broken,{log:c=>logs.push(c)});
 const rd=(await import('./blog-read-harness.mjs')).reader;void rd;
 broken.media=null;// mediaForPage가 던지게
 const r=JSON.parse((await read(hb,{blog:'post',post:KEYS.postA})).text);
 assert.deepEqual(r.media,{});assert.match(JSON.stringify(r.post.blocks),/공개 본문/);assert.deepEqual(logs,['blog_media_unavailable']);
});
test('copies carry no Drive ids or attachment links (the copy is what the owner screen published)',async()=>{
 const s=store();s.pages[0].blocks[0].doc.doc.content.push({type:'image',attrs:{src:'drive:1AbCdEf'}});
 const r=JSON.parse((await read(handler(s),{blog:'post',post:KEYS.postA})).text);
 // 서명 대상은 share:<id>만이다(drive: 칸은 주소를 만들지 않음). 사본에서 drive: 칸을 지우는 것은 게시 화면(BLOG ③) 몫이고 그 시험이 따로 지킨다.
 assert.ok(!Object.values(r.media).some(u=>u.includes('drive')));
 assert.deepEqual(Object.keys(r.media),[IDS.mediaA]);
});

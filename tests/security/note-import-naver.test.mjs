// NOTE-링크원문 ④: 네이버 뉴스 모바일 기사 주소(n.news.naver.com/mnews/article/…)를 Edge note-import가 읽는지 고정한다.
// 네트워크 없음: 사이트·Supabase·이름 풀이는 모두 지어낸 응답이다. 기사 글은 네이버 뉴스 화면의 뼈대(본문 칸 #dic_area, <br>로 나눈 문단,
// 요약 줄·사진 설명·좋아요 줄·저작권 줄)를 흉내 낸 합성 글이고 실제 기사 원문이 아니다. 안전 범위(https만·이름 풀이 뒤 주소 확인·상한·읽기 전용)는
// tests/security/note-import.test.mjs가 그대로 지킨다 — 이 파일은 그 범위 안에서 본문 칸을 찾는지만 본다.
import test from 'node:test';
import assert from 'node:assert/strict';

const H=await import('../../supabase/functions/note-import/handler.ts');

const NOW=Date.parse('2026-11-19T00:00:00Z');
const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key-000000';
const WS='a0000000-0000-4000-8000-000000000001',USER='b0000000-0000-4000-8000-000000000001',JWT='synthetic.user.jwt-owner-0001';
const FN='https://synthetic.supabase.test/functions/v1/note-import';
const HOST='n.news.naver.com',PAGE=`https://${HOST}/mnews/article/000/0000000001`,PUBLIC_IP='93.184.216.34';
const s='노동자들은 오늘 합성 기사 본문을 읽는다. 이 문장은 네이버 뉴스 화면 뼈대를 흉내 낸 합성 문장이다. ';
const NAVER=`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>합성 기사 제목 : 네이버 뉴스</title>
<meta property="og:title" content="합성 기사 제목"><meta property="og:type" content="article"><meta property="og:url" content="${PAGE}">
<meta property="og:description" content="합성 요약 앞부분"><meta property="og:article:author" content="합성일보 | 네이버"></head>
<body><div id="ct" class="newsct"><div class="media_end_head go_trans"><h2 id="title_area" class="media_end_head_headline"><span>합성 기사 제목</span></h2>
<span class="media_end_head_info_datestamp_time _ARTICLE_DATE_TIME" data-date-time="2026-11-19 07:30:00">2026.11.19. 오전 7:30</span></div>
<div id="contents" class="newsct_body"><div id="newsct_article" class="newsct_article _article_body"><article id="dic_area" class="go_trans _article_content">
<strong class="media_end_summary">합성 요약 한 줄<br>합성 요약 두 줄</strong><span class="end_photo_org"><img src="https://imgnews.pstatic.net/image/000/0000000001_001.jpg" alt=""><em class="img_desc">합성 사진 설명</em></span><br><br>
첫째 ${s.repeat(3)}<br><br>둘째 ${s.repeat(4)}<br><br>셋째 ${s.repeat(2)}</article></div></div>
<div class="_reactionModule">좋아요 훈훈해요 슬퍼요 화나요 후속기사 원해요</div><div class="media_end_copyright">Copyright ⓒ 합성일보. All rights reserved. 무단 전재 및 재배포 금지.</div></div></body></html>`;

function world(robots){
 const outbound=[];
 const res=(v,st=200)=>new Response(v===null?null:JSON.stringify(v),{status:st,headers:{'content-type':'application/json'}});
 const doFetch=async(url,init={})=>{
  const u=new URL(url),method=init.method??'GET';
  if(u.origin===SB){
   if(u.pathname==='/auth/v1/user')return init.headers.Authorization===`Bearer ${JWT}`?res({id:USER}):res({},401);
   const p=u.pathname.replace('/rest/v1/','');
   if(p==='app_workspace_members'&&method==='GET')return res([{workspace_id:WS}]);
   if(p==='app_news_days'&&method==='GET')return res([]);
   return res(null,204);
  }
  outbound.push(u.href);
  if(u.pathname==='/robots.txt')return robots==null?new Response('',{status:404}):new Response(robots,{status:200,headers:{'content-type':'text/plain'}});
  if(u.href===PAGE)return new Response(NAVER,{status:200,headers:{'content-type':'text/html;charset=UTF-8'}});
  return new Response('',{status:404});
 };
 const resolve=async host=>{if(host===HOST)return [PUBLIC_IP];throw new Error('synthetic resolver: unknown');};
 const env=n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE})[n];
 const handler=H.createNoteImportHandler({env,resolve,fetch:doFetch,now:()=>NOW,sleep:async()=>{},log:()=>{}});
 return {handler,outbound};
}
const imp=async w=>{const out=await w.handler(new Request(FN,{method:'POST',headers:{authorization:`Bearer ${JWT}`,'content-type':'application/json'},body:JSON.stringify({url:PAGE})}));return {status:out.status,body:await out.json()};};

test('네이버 뉴스 모바일 기사: 본문 칸(#dic_area)의 <br> 문단을 글자 블록으로 읽는다(좋아요·저작권 줄·사진 주소는 빼고)',async()=>{
 const w=world(null);
 const {status,body}=await imp(w);
 assert.equal(status,200);
 assert.equal(body.state,'ok',JSON.stringify(body.reason));
 assert.equal(body.title,'합성 기사 제목');
 assert.equal(body.url,PAGE);
 const texts=body.blocks.map(b=>b.text);
 assert.ok(body.blocks.every(b=>['p','h','quote'].includes(b.t)),'글자 블록만(사진 블록 없음)');
 assert.ok(texts.some(t=>t.startsWith('첫째 ')),'첫째 문단');
 assert.ok(texts.some(t=>t.startsWith('둘째 ')),'둘째 문단');
 assert.ok(texts.some(t=>t.startsWith('셋째 ')),'셋째 문단');
 const all=texts.join('\n');
 assert.doesNotMatch(all,/훈훈해요|무단 전재|pstatic/,'좋아요 줄·저작권 줄·사진 주소는 본문이 아니다');
 // 읽은 곳은 robots.txt와 그 기사 둘뿐(다른 주소로 새지 않음).
 assert.deepEqual(w.outbound,[`https://${HOST}/robots.txt`,PAGE]);
});

test('네이버가 robots.txt로 읽기를 막아 두면 읽지 않는다(robots — 화면은 "이 사이트가 읽기를 막아 두었어요")',async()=>{
 const w=world('User-agent: *\nDisallow: /\n');
 const {status,body}=await imp(w);
 assert.equal(status,200);
 assert.equal(body.state,'failed');assert.equal(body.reason,'robots');
 assert.deepEqual(body.blocks,[]);
 assert.deepEqual(w.outbound,[`https://${HOST}/robots.txt`],'기사 쪽은 부르지 않는다');
});

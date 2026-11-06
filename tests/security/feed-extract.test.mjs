// NEWS-전면개편 P2b: 공용 본문 추출기(_shared/feed-extract.ts) + 카탈로그 extract 칸 + 예약 입구 probe.
// 네트워크 없음. 견본 HTML은 모두 지어낸 글·example.com 주소다(실제 기사 제목·본문 없음).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const E=await import('../../supabase/functions/_shared/feed-extract.ts');
const P=await import('../../supabase/functions/outside-feed/parse.ts');
const OC=await import('../../supabase/functions/_shared/outside-catalog.ts');
const NC=await import('../../supabase/functions/_shared/news-catalog.ts');
const OH=await import('../../supabase/functions/outside-feed/handler.ts');
const NH=await import('../../supabase/functions/news-feed/handler.ts');
const NP=await import('../../supabase/functions/news-feed/page.ts');
const FX=name=>readFileSync(new URL(`../fixtures/outside-feed/${name}`,import.meta.url),'utf8');

const NOW=Date.parse('2026-11-06T03:00:00Z');
const PARA='노동자들은 오늘 합성 견본 문단을 차례로 읽는다. 이 문단은 시험용으로 지어낸 글이다. ';
const LONG=PARA.repeat(4);
const EN='Workers in this synthetic sample read a made-up paragraph for the extractor test. ';

// DB 검사(migration 20261106050000 app_feed_bodies)와 같은 모양 검사 — 추출 결과가 그대로 들어갈 수 있는지.
const CNTRL=/[\x00-\x1f\x7f-\x9f]/;
function assertDbShape(e,label=''){
 const at=m=>`${label}: ${m}`;
 assert.ok(['ok','lead','image_only','failed'].includes(e.state),at('state'));
 assert.ok(e.reason===null||['robots','bot_check','paywall','too_big','timeout','http_4xx','http_5xx','no_body','off_host','relay'].includes(e.reason),at('reason'));
 assert.ok(e.rule===null||/^[a-z0-9][a-z0-9_-]{1,39}@[0-9]{1,4}$/.test(e.rule),at('rule'));
 assert.ok(Array.isArray(e.blocks)&&e.blocks.length<=400,at('blocks'));
 let chars=0,images=0;
 for(const b of e.blocks){
  if(b.t==='img'){
   assert.deepEqual(Object.keys(b).filter(k=>!['t','src','cap','alt'].includes(k)),[],at('img keys'));
   assert.match(b.src,/^https:\/\/[^\s"<>]+$/,at('src'));assert.ok(b.src.length<=2000,at('src len'));assert.ok(!CNTRL.test(b.src));
   for(const k of ['cap','alt'])if(b[k]!==undefined&&b[k]!==null){assert.equal(typeof b[k],'string');assert.ok([...b[k]].length>=1&&[...b[k]].length<=300,at(k));assert.ok(!CNTRL.test(b[k]),at(k+' cntrl'));}
   images++;
  }else{
   assert.ok(['p','h','quote'].includes(b.t),at('t'));
   assert.deepEqual(Object.keys(b).sort(),['t','text'],at('text keys'));
   assert.equal(typeof b.text,'string');assert.ok(b.text.length>0,at('empty text'));assert.ok(!CNTRL.test(b.text),at('cntrl'));
   chars+=[...b.text].length;
  }
 }
 const texts=e.blocks.filter(b=>b.t!=='img').map(b=>b.text);
 assert.ok([...JSON.stringify(texts).replace(/","/g,'", "')].length<=110000,at('text json'));
 assert.equal(e.chars,chars,at('chars'));assert.ok(chars<=100000);
 assert.equal(e.images,images,at('images'));assert.ok(images<=20);
 assert.equal(chars>0,e.blocks.some(b=>b.t!=='img'),at('chars>0'));
 if(e.state==='ok')assert.ok(e.reason===null&&chars>0,at('ok shape'));
 if(e.state==='lead')assert.ok(chars>0,at('lead shape'));
 if(e.state==='image_only')assert.ok(images>0,at('image_only shape'));
 if(e.state==='failed')assert.ok(e.reason!==null&&e.blocks.length===0,at('failed shape'));
 assert.equal(e.text,texts.join('\n'),at('text = 글자 블록'));
}

test('blocks: 문단·소제목·인용·사진(캡션·대체 글), 꾸밈 그림·http·data: 그림 빼기, 상대 주소 풀기, drop 칸 빼기',()=>{
 const html=`<html><body><nav>메뉴 칸</nav><article><h1>합성 제목</h1><p>2026.11.06</p><h2>합성 소제목</h2><p>${LONG}</p>
 <figure><img src="/data/photo/2026/a.jpg" alt="합성 대체 글"><figcaption>합성 캡션</figcaption></figure>
 <img src="/img/logo.png"><img src="https://cdn.example.com/p.gif" width="1" height="1"><img src="http://cdn.example.com/b.jpg"><img src="data:image/png;base64,AAAA">
 <img src="data:image/gif;base64,R0" data-src="https://cdn.example.com/lazy.jpg">
 <blockquote><p>합성 인용 문단</p></blockquote><div class="share-box">공유 칸 글자</div><p>${LONG}</p><p>목록</p><p>목록 뒤 글자</p></article><footer>꼬리 칸</footer></body></html>`;
 const e=E.extractBlocks({html,base:'https://www.example.com/news/1',title:'합성 제목',key:'kctu',rule:{version:3,drop:/^share-box$/},minChars:60});
 assertDbShape(e,'basic');
 assert.equal(e.state,'ok');assert.equal(e.rule,'kctu@3');
 assert.deepEqual(e.blocks.map(b=>b.t),['h','p','img','img','quote','p']);
 assert.deepEqual(e.blocks[2],{t:'img',src:'https://www.example.com/data/photo/2026/a.jpg',cap:'합성 캡션',alt:'합성 대체 글'});
 assert.equal(e.blocks[3].src,'https://cdn.example.com/lazy.jpg');
 assert.equal(e.captions,1);
 const all=JSON.stringify(e.blocks);
 for(const bad of ['메뉴 칸','공유 칸','꼬리 칸','목록 뒤','2026.11.06','logo.png','p.gif','http://','data:'])assert.ok(!all.includes(bad),bad);
 // 같은 본문 칸·제목 줄·끝 표시·덧줄 거르기: 캡션 줄만 빼면 extractBody와 같은 글자.
 assert.equal(e.text,P.extractBody(html.replace('<div class="share-box">공유 칸 글자</div>',''),'합성 제목').replace('합성 캡션\n',''));
 assert.deepEqual(E.bodyNumbers(e),{state:'ok',reason:null,rule:'kctu@3',blocks:6,chars:e.chars,images:2,captions:1,headings:1,quotes:1});
});

test('limits: 블록 400개·사진 20장·글자 10만 자·제어 문자 없음, 같은 사진 한 번',()=>{
 const many=Array.from({length:500},(_,i)=>`<p>${PARA}${i}</p><img src="https://img.example.com/p${i%30}.jpg">`).join('');
 const e=E.extractBlocks({html:`<article>${many}</article>`,base:'https://www.example.com/',title:'',key:'ws',rule:{version:1},minChars:60});
 assertDbShape(e,'many');assert.equal(e.blocks.length,400);assert.equal(e.images,20);
 const big=`<article>${Array.from({length:300},()=>`<p>${'가'.repeat(900)}</p>`).join('')}</article>`;
 const b=E.extractBlocks({html:big,base:'https://www.example.com/',title:'',key:'ws',rule:{version:1},minChars:60});
 assertDbShape(b,'big');assert.equal(b.chars,100000);
 const q=E.extractBlocks({html:`<article>${Array.from({length:300},()=>`<p>${'"'.repeat(400)}</p>`).join('')}</article>`,base:'https://www.example.com/',title:'',key:'ws',rule:{version:1},minChars:60});
 assertDbShape(q,'quotes');
 const ctl=String.fromCharCode(1)+String.fromCharCode(0x2028)+String.fromCharCode(0x85);
 const c=E.extractBlocks({html:`<article><p>${PARA}${ctl}${PARA}</p><img src="https://img.example.com/a.jpg" alt="합성${ctl}글"></article>`,base:'https://www.example.com/',title:'',key:'ws',rule:{version:1},minChars:60});
 assertDbShape(c,'cntrl');
 const dup=E.extractBlocks({html:`<article><p>${LONG}</p><img src="https://img.example.com/a.jpg"><img src="https://img.example.com/a.jpg#x"></article>`,base:'https://www.example.com/',title:'',key:'ws',rule:{version:1},minChars:60});
 assert.equal(dup.images,1);
 const long=E.extractBlocks({html:`<article><p>${LONG}</p><img src="https://img.example.com/${'a'.repeat(2100)}.jpg"></article>`,base:'https://www.example.com/',title:'',key:'ws',rule:{version:1},minChars:60});
 assert.equal(long.images,0,'2000자 넘는 주소는 뺀다');
});

test('states: 그림뿐인 글은 image_only(첨부 이름 줄 포함), 본문 없음은 failed/no_body, 유료벽은 앞부분만, 읽기 실패 코드 → 까닭',()=>{
 const img=E.extractBlocks({html:`<div class="publishList_write"><p><img src="/upload/a.png"></p><p>합성성명.hwp</p></div>`,base:'https://www.example.com/board/1',title:'',key:'kptu',rule:{version:1},body:/^publishList_write$/,minChars:60});
 assertDbShape(img,'image_only');assert.equal(img.state,'image_only');assert.deepEqual(img.blocks.map(b=>b.t),['img','p']);assert.equal(img.blocks[1].text,'합성성명.hwp');
 const none=E.extractBlocks({html:'<article><p>짧음</p></article>',base:'https://www.example.com/',title:'',key:'kctu',rule:{version:1},minChars:60});
 assertDbShape(none,'none');assert.deepEqual([none.state,none.reason,none.rule],['failed','no_body','kctu@1']);
 const pay=E.extractBlocks({html:`<article><p>${LONG}</p><p>${LONG}</p><p>${LONG}</p><p>${LONG}</p></article><div class="paywall-mark">x</div>`,base:'https://www.example.com/',title:'',key:'news-labortoday',rule:{version:1,lead:/paywall-mark/},minChars:200});
 assertDbShape(pay,'lead');assert.deepEqual([pay.state,pay.reason],['lead','paywall']);assert.ok(pay.chars<=E.LEAD_MAX_CHARS);
 const want={robots:'robots',robots_denied:'robots',bot_check:'bot_check',too_large:'too_big',url_outside:'off_host',redirect_outside:'off_host',
  http_404:'http_4xx',http_403:'http_4xx',http_503:'http_5xx',timeout:'timeout',network:'timeout',robots_unreachable:'timeout',redirect_loop:'http_4xx'};
 for(const [k,v] of Object.entries(want)){assert.equal(E.readFailReason(k),v,k);assertDbShape(E.failedBody(E.readFailReason(k)),k);}
 assertDbShape(E.textBlocks('',{key:'justice',rule:{version:1},minChars:60}),'empty');
 const tg=E.textBlocks(`${PARA}\n${PARA}`,{key:'justice',rule:{version:1},minChars:60,photos:['https://cdn.example.com/t.jpg','http://cdn.example.com/x.jpg','javascript:alert(1)']});
 assertDbShape(tg,'tg');assert.deepEqual(tg.blocks.map(b=>b.t),['p','p','img']);
 const row=E.bodyRow(tg,{workspace_id:'a0000000-0000-4000-8000-000000000001',outside_post_id:'b0000000-0000-4000-8000-000000000001'},'2026-11-06T03:00:00.000Z');
 assert.deepEqual(Object.keys(row).sort(),['blocks','chars','extracted_at','images','news_item_id','outside_post_id','reason','rule','state','workspace_id']);
 assert.equal(row.news_item_id,null);
});

test('same text as extractBody on every stored article fixture (한 번 뽑아 세 곳 — 캡션 줄만 빠짐)',()=>{
 const pages=[['kptu-article.html','kptu'],['kptu-article-image-only.html','kptu'],['jinboparty-article.html','jinboparty'],['laborparty-article.html','laborparty'],
  ['socialism-article.html','socialism'],['jacobin-article.html','jacobin'],['article-ko.html','kctu'],['article-en.html','labornotes'],['article-nodate.html','kctu']];
 for(const [file,key] of pages){
  const html=FX(file),src=OC.sourceByKey(key);
  const e=E.extractBlocks({html,base:'https://www.example.com/a/1',title:'',key,rule:src.extract||{version:1},body:src.bodyClass,minChars:1});
  assertDbShape(e,file);
  const caps=e.blocks.filter(b=>b.t==='img'&&b.cap).map(b=>b.cap);
  const want=P.extractBody(html,'',src.bodyClass).split('\n').filter(l=>!caps.includes(l)).join('\n');
  if(e.state!=='image_only'&&!src.extract.drop)assert.equal(e.text,want,file);
 }
});

// 출처 전수 견본: 출처마다 그 사이트 모양(본문 칸·빼는 칸·캡션 칸)을 줄인 지어낸 글 한 쪽. 표에 없는 출처가 있으면 실패(새 출처는 견본을 더해야 함).
const NAV='<nav>합성 메뉴</nav><header>합성 머리</header>';
const FOOT='<footer>합성 저작권 꼬리</footer>';
const FIG=(cls='')=>`<figure${cls?` class="${cls}"`:''}><img src="/data/photo/sample.jpg" alt="합성 대체 글"><figcaption>합성 캡션 글</figcaption></figure>`;
const body=(lang)=>lang==='en'?`<p>${EN.repeat(4)}</p><h3>Synthetic subhead</h3><p>${EN.repeat(4)}</p>`:`<p>${LONG}</p><h3>합성 소제목</h3><p>${LONG}</p>`;
const wrap=(inner,head='')=>`<html><head>${head}</head><body>${NAV}${inner}${FOOT}</body></html>`;
const SAMPLES={
 kctu:l=>wrap(`<div class="xe_content">${body(l)}${FIG()}</div>`),
 kptu:l=>wrap(`<form><div class="publishList_write">${body(l)}<p><img src="/upload/sample.png"></p></div></form>`.replace('<form>','').replace('</form>','')),
 kmwu:l=>wrap(`<section id="bo_v_atc"><div id="bo_v_con">${body(l)}${FIG()}</div><section id="bo_v_file">합성첨부.hwp 빼는 칸</section><div id="bo_v_sns">공유 빼는 칸</div></section>`),
 kfsu:l=>wrap(`<div class="kboard-content">${body(l)}${FIG()}</div><div class="kboard-document-action">빼는 칸 좋아요</div>`),
 hakbi:l=>wrap(`<div class="board_view">${body(l)}${FIG()}</div>`),
 laborparty:l=>wrap(`<div class="kboard-content">${body(l)}${FIG()}<div class="kboard-document-action">빼는 칸 인쇄</div></div>`),
 kgreens:l=>wrap(`<h1>합성 견본 제목</h1>${body(l)}${FIG()}`),
 jinboparty:l=>wrap(`<div class="content_head">합성 머리 칸</div><div class="content_box">${body(l)}${FIG()}</div>`),
 pssp:l=>wrap(`<div class="view_content">${body(l)}${FIG()}</div>`),
 ws:l=>wrap(`<div class="entry-content">${body(l)}${FIG('wp-caption')}<div class="sharedaddy">빼는 칸 공유</div></div>`),
 platformc:l=>wrap(`<article>${body(l)}${FIG()}</article>`),
 leftall:l=>wrap(`<div id="bo_v_con">${body(l)}${FIG()}</div><div id="bo_v_sns">공유 빼는 칸</div>`),
 socialism:l=>wrap(`<article>공유 단추 칸</article><div id="body_content">${body(l)}${FIG()}</div>`),
 jacobin:l=>wrap(`<article><div class="po-bo__content">${body(l)}${FIG()}</div><div class="po-bo__share">빼는 칸 Share</div><div class="po-bo__content"><p>${EN.repeat(2)}</p></div></article>`),
 labornotes:l=>wrap(`<article>${body(l)}<div class="image"><img src="/files/sample.jpg"><div class="caption">합성 캡션 글</div></div></article>`),
 redpepper:l=>wrap(`<div class="entry-content">${body(l)}<div class="wp-caption"><img src="/wp-content/uploads/sample.jpg"><p class="wp-caption-text">합성 캡션 글</p></div><div class="jp-relatedposts">빼는 칸 관련</div></div>`),
 socialistworker:l=>wrap(`<div class="entry-content">${body(l)}<figure class="wp-block-image">${'<img src="/wp-content/uploads/sample.jpg"><figcaption class="wp-element-caption">합성 캡션 글</figcaption>'}</figure><div class="addtoany_share_save_container">빼는 칸 공유</div></div>`),
 'news-labortoday':l=>wrap(`<article class="article-view-header">합성 머리 칸</article><article id="article-view-content-div">${body(l)}${FIG('photo-layout')}<div class="view-copyright">빼는 칸 저작권</div></article>`),
 'news-beminor':l=>wrap(`<article id="article-view-content-div">${body(l)}${FIG('photo-layout')}<div class="view-editors">빼는 칸 기자</div></article>`),
 'news-pressian':l=>wrap(`<div class="article_body">${body(l)}${FIG()}<div class="byline">빼는 칸 기자</div></div>`),
 'news-psi':l=>wrap(`<article>${body(l)}${FIG()}</article>`),
 'news-itf':l=>wrap(`<article>${body(l)}${FIG()}</article>`),
 'news-labourstart':l=>wrap(`<article>${body(l)}${FIG()}</article>`),
};
const TELEGRAM={justice:'justice-telegram.html',socialist:'socialist-telegram.html'};

test('every catalog source has an extract rule and a sample (전수)',()=>{
 const keys=[...OC.OUTSIDE_CATALOG.map(s=>s.key),...NC.NEWS_CATALOG.map(s=>s.key)];
 for(const s of [...OC.OUTSIDE_CATALOG,...NC.NEWS_CATALOG]){
  assert.ok(s.extract===false||(s.extract&&Number.isInteger(s.extract.version)&&s.extract.version>=1),`${s.key} extract`);
  assert.ok(E.ruleId(s.key,s.extract||{version:1}),`${s.key} rule id`);
 }
 assert.equal(NC.GOOGLE_NEWS.extract,false,'구글 중계 주소는 읽지 않음(relay)');
 for(const k of keys)assert.ok(SAMPLES[k]||TELEGRAM[k],`견본 없음: ${k}`);
 assert.deepEqual(Object.keys(SAMPLES).filter(k=>!keys.includes(k)),[]);
});

test('every catalog source sample: 본문 문단·소제목·사진·캡션, 메뉴·꼬리·빼는 칸 없음, DB 모양',()=>{
 for(const s of OC.OUTSIDE_CATALOG){
  if(TELEGRAM[s.key]){
   const items=P.parseTelegram(s,FX(TELEGRAM[s.key]),NOW,5);
   assert.ok(items.length>0,s.key);
   const e=OH.postBody(s,{...items[0],content:`${items[0].content??''}\n${LONG}`,photos:['https://cdn.example.com/tg.jpg']},null);
   assertDbShape(e,s.key);assert.equal(e.state,'ok',s.key);assert.equal(e.images,1);assert.equal(e.rule,`${s.key}@1`);
   continue;
  }
  const html=SAMPLES[s.key](s.lang);
  const it={url:'https://www.example.com/a/1',title:'합성 견본 제목',kind:'statement',published_at:null,author:null,summary:null,content:null};
  const e=OH.postBody(s,it,{ok:true,text:html,url:'https://www.example.com/a/1'});
  assertDbShape(e,s.key);
  assert.equal(e.state,'ok',s.key);
  assert.equal(e.rule,`${s.key}@${s.extract.version}`);
  assert.ok(e.blocks.some(b=>b.t==='h'),`${s.key} h`);
  assert.ok(e.images>=1,`${s.key} img`);
  if(s.key!=='kptu')assert.ok(e.captions>=1,`${s.key} cap`);
  const all=JSON.stringify(e.blocks);
  for(const bad of ['합성 메뉴','합성 머리','저작권 꼬리','빼는 칸','공유 단추'])assert.ok(!all.includes(bad),`${s.key}: ${bad}`);
 }
 for(const s of NC.NEWS_CATALOG){
  const html=SAMPLES[s.key](s.lang).replace('<head>','<head><meta property="og:title" content="합성 견본 제목">');
  const info=NP.readArticlePage(html,NOW,NH.mediaRule(s,'https://www.example.com/news/1'));
  assertDbShape(info.blocks,s.key);
  assert.equal(info.blocks.state,'ok',s.key);assert.equal(info.body_kind,'full');assert.equal(info.body,info.blocks.text);
  assert.ok(info.blocks.images>=1&&info.blocks.captions>=1,`${s.key} img/cap`);
  const all=JSON.stringify(info.blocks.blocks);
  for(const bad of ['합성 메뉴','합성 머리','저작권 꼬리','빼는 칸'])assert.ok(!all.includes(bad),`${s.key}: ${bad}`);
 }
});

test('RSS 피드 본문 칸(content:encoded)은 글 쪽을 읽지 않고 블록으로 — 이스케이프된 HTML도',()=>{
 const s=OC.sourceByKey('ws');
 const html=`<p>${LONG}</p><figure><img src="https://www.example.com/p.jpg"><figcaption>합성 캡션 글</figcaption></figure><p>${LONG}</p>`;
 const it={url:'https://ws.or.kr/article/1',title:'합성 견본 제목',kind:'article',published_at:null,author:null,summary:null,content:P.feedText(html),contentHtml:html};
 const e=OH.postBody(s,it,null);assertDbShape(e,'feed');assert.deepEqual(e.blocks.map(b=>b.t),['p','img','p']);
 const escaped=html.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
 const e2=OH.postBody(s,{...it,contentHtml:escaped},null);assert.deepEqual(e2.blocks.map(b=>b.t),['p','img','p']);
 const e3=OH.postBody(s,{...it,contentHtml:null},null);assertDbShape(e3,'feed text');assert.equal(e3.state,'ok');
 // 실제 피드 견본(ws.xml): 본문 칸이 있으면 contentHtml을 남긴다.
 const items=P.parseFeed(s,FX('ws.xml'),NOW,5);
 for(const i of items)if(i.content)assert.equal(typeof i.contentHtml,'string');
 assert.ok(P.CONTENT_HTML_MAX>=100000);
});

test('telegram photos: tgme_widget_message_photo_wrap 배경 주소(https만)',()=>{
 const seg=`<a class="tgme_widget_message_photo_wrap blured" style="width:100px;background-image:url('https://cdn1.example.com/file/a.jpg')"></a>
 <a class="tgme_widget_message_photo_wrap" style="background-image:url(&quot;http://cdn1.example.com/b.jpg&quot;)"></a>`;
 assert.deepEqual(P.telegramPhotos(seg),['https://cdn1.example.com/file/a.jpg']);
});

// ---- probe(예약 입구, 숫자만·저장 없음) -------------------------------------------------------------------------------
const SB='https://synthetic.supabase.test',SERVICE='synthetic-service-role-key';
const OSECRET='synthetic-outside-feed-cron-secret-0123456789',NSECRET='synthetic-news-feed-cron-secret-0123456789abc';
function world(sites){
 const calls=[];
 const doFetch=async(url,init={})=>{
  const u=new URL(url);calls.push({url:u.href,method:init.method??'GET'});
  if(u.origin===SB)return new Response('[]',{status:200,headers:{'content-type':'application/json'}});
  const site=sites[u.href];
  if(site===undefined)return new Response('',{status:404});
  return new Response(site.body,{status:site.status??200,headers:{'content-type':site.type??'text/html; charset=utf-8'}});
 };
 return {calls,doFetch};
}
const req=(fn,header,secret,body)=>new Request(`${SB}/functions/v1/${fn}?action=probe`,{method:'POST',headers:{[header]:secret,'content-type':'application/json'},body:JSON.stringify(body)});

test('outside-feed probe: 키 목록·단체 하나 → 숫자·코드만, 저장 없음, 열쇠 없으면 401',async()=>{
 const s=OC.sourceByKey('jacobin');
 const xml=FX('jacobin.xml');const first=P.parseFeed(s,xml,NOW,5)[0];
 const w=world({[s.lists[0]]:{body:xml,type:'application/rss+xml'},[first.url]:{body:FX('jacobin-article.html')}});
 const h=OH.createOutsideFeedHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,OUTSIDE_FEED_CRON_SECRET:OSECRET})[n],fetch:w.doFetch,now:()=>NOW,sleep:async()=>{},log:()=>{}});
 const list=await(await h(req('outside-feed',OH.CRON_HEADER,OSECRET,{}))).json();
 assert.deepEqual(list,{ok:true,sources:OC.OUTSIDE_SOURCE_KEYS});
 const r=await h(req('outside-feed',OH.CRON_HEADER,OSECRET,{source:'jacobin'}));
 assert.equal(r.status,200);
 const out=await r.json();
 assert.equal(out.source,'jacobin');assert.equal(out.list,'ok');assert.equal(out.page,'ok');assert.equal(out.from,'page');
 assert.equal(out.state,'ok');assert.ok(out.chars>0);assert.equal(out.rule,'jacobin@1');
 for(const v of Object.values(out))assert.ok(v===null||typeof v==='number'||typeof v==='boolean'||/^[a-z0-9_@-]{1,40}$/.test(v),`숫자·코드만: ${v}`);
 assert.ok(!JSON.stringify(out).includes(first.title.slice(0,10)));
 assert.equal(w.calls.filter(c=>c.url.startsWith(SB)&&c.method!=='GET').length,0,'저장 없음');
 assert.equal((await h(req('outside-feed',OH.CRON_HEADER,OSECRET,{source:'https://evil.example'}))).status,400);
 assert.equal((await h(req('outside-feed',OH.CRON_HEADER,OSECRET,{source:'jacobin',x:1}))).status,400);
 assert.equal((await h(req('outside-feed',OH.CRON_HEADER,OSECRET+'x',{source:'jacobin'}))).status,401);
 const user=await h(new Request(`${SB}/functions/v1/outside-feed?action=probe`,{method:'POST',headers:{authorization:'Bearer synthetic.user.jwt-owner-0001'},body:'{}'}));
 assert.equal(user.status,400,'화면 열쇠로는 probe 없음');
 // 글 쪽을 못 읽으면 까닭 코드만.
 const w2=world({[s.lists[0]]:{body:xml,type:'application/rss+xml'},[first.url]:{body:'',status:503}});
 const h2=OH.createOutsideFeedHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,OUTSIDE_FEED_CRON_SECRET:OSECRET})[n],fetch:w2.doFetch,now:()=>NOW,sleep:async()=>{},log:()=>{}});
 const o2=await(await h2(req('outside-feed',OH.CRON_HEADER,OSECRET,{source:'jacobin'}))).json();
 assert.deepEqual([o2.page,o2.state,o2.reason,o2.blocks],['http_503','failed','http_5xx',0]);
});

test('news-feed probe: 매체 하나 → 숫자·코드만, 저장 없음',async()=>{
 const s=NC.newsSourceByKey('news-beminor');
 const art='https://www.beminor.com/news/articleView.html?idxno=1';
 const rss=`<rss><channel><item><title>합성 견본 기사</title><link>${art}</link><description>합성 소개</description></item></channel></rss>`;
 const page=SAMPLES['news-beminor']('ko').replace('<head>','<head><meta property="og:title" content="합성 견본 기사">');
 const w=world({[s.lists[0]]:{body:rss,type:'application/rss+xml'},[art]:{body:page}});
 const h=NH.createNewsFeedHandler({env:n=>({SUPABASE_URL:SB,SUPABASE_SERVICE_ROLE_KEY:SERVICE,NEWS_FEED_CRON_SECRET:NSECRET})[n],fetch:w.doFetch,now:()=>NOW,sleep:async()=>{},log:()=>{}});
 assert.deepEqual(await(await h(req('news-feed',NH.CRON_HEADER,NSECRET,{}))).json(),{ok:true,sources:NC.NEWS_SOURCE_KEYS});
 const out=await(await h(req('news-feed',NH.CRON_HEADER,NSECRET,{source:'news-beminor'}))).json();
 assert.deepEqual([out.list,out.page,out.page_state,out.body_kind,out.state,out.rule],['ok','ok','ok','full','ok','news-beminor@1']);
 assert.ok(out.images>=1&&out.captions>=1);
 for(const v of Object.values(out))assert.ok(v===null||typeof v==='number'||typeof v==='boolean'||/^[a-z0-9_@-]{1,40}$/.test(v),`숫자·코드만: ${v}`);
 assert.equal(w.calls.filter(c=>c.url.startsWith(SB)).length,0,'DB 요청 없음');
 assert.equal((await h(req('news-feed',NH.CRON_HEADER,NSECRET,{source:'news-google'}))).status,400);
});

test('beminor 503 원인 고침: in.(…) 묶음은 주소 길이로도 나눈다(한글 제목 40개 = 1만 바이트 넘음)',()=>{
 const titles=Array.from({length:40},(_,i)=>`장애인권리합성견본기사제목이꽤길게이어지는경우를시험한다${i}`);
 const one=encodeURIComponent(`(${titles.map(t=>`"${t}"`).join(',')})`).length;
 assert.ok(one>10000,`예전 한 묶음 ${one}바이트`);
 const parts=NH.inChunks(titles);
 assert.ok(parts.length>1);
 for(const p of parts)assert.ok(p.length<=NH.IN_LIST_MAX_BYTES+400,`묶음 ${p.length}바이트`);
 const back=parts.flatMap(p=>decodeURIComponent(p).slice(1,-1).split(',').map(v=>v.slice(1,-1)));
 assert.deepEqual(back,titles);
 assert.deepEqual(NH.inChunks([]),[]);
 assert.equal(NH.inChunks(['a'.repeat(5000)]).length,1,'긴 값 하나는 그 값만');
});

test('source text: 추출기는 HTML·주소를 받으러 가지 않음(fetch 없음), 로그에 본문 없음',()=>{
 const src=readFileSync(new URL('../../supabase/functions/_shared/feed-extract.ts',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\(|Deno\.|console\./);
 for(const f of ['outside-feed/handler.ts','news-feed/handler.ts']){
  const t=readFileSync(new URL(`../../supabase/functions/${f}`,import.meta.url),'utf8');
  for(const m of t.matchAll(/log\("([a-z_]+)"(, \{[^}]*\})?\)/g))assert.doesNotMatch(m[2]??'',/title|text|body|url|blocks/,`${f}: ${m[0]}`);
 }
});

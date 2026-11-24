// S68-52 READ-조선일보원문: 본문 태그가 비고 문단이 페이지 안 공개 구조화 데이터(JSON-LD articleBody · Arc XP Fusion globalContent)에 있는 기사 쪽.
// 네트워크 없음. 견본 HTML은 모두 지어낸 글·example.com 주소다(실제 기사 제목·본문 없음). 조선일보식(Arc) 페이지 구조만 흉내 낸다.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const J=await import('../../supabase/functions/_shared/page-json-body.ts');
const NP=await import('../../supabase/functions/news-feed/page.ts');
const NC=await import('../../supabase/functions/_shared/news-catalog.ts');
const H=await import('../../supabase/functions/note-import/handler.ts');

const NOW=Date.parse('2026-11-23T03:00:00Z');
const URL_='https://www.example.com/economy/2026/11/12/SYNTH1/';
const RULE={key:NC.OPEN_ARTICLE_KEY,rule:NC.OPEN_ARTICLE_RULE,base:URL_};
const para=i=>`합성 경제 기사 ${i}번째 문단은 단기 일자리와 임금 이야기를 길게 이어 쓴 지어낸 글이다. `.repeat(3).trim();

// Arc XP(Fusion) 모양: 본문 칸은 비어 있고(브라우저 스크립트가 그림), 문단은 Fusion.globalContent의 content_elements에 있다.
const arcPage=({restrict=null,extraLd='',bodyHtml=''}={})=>{
 const g={_id:'SYNTH1',type:'story',headlines:{basic:'합성 기사 제목'},
  ...(restrict?{content_restrictions:{content_code:restrict}}:{}),
  content_elements:[
   {type:'text',content:para(1)},
   {type:'image',url:'https://www.example.com/photo.jpg',caption:'합성 사진'},
   {type:'header',content:'합성 소제목',level:2},
   {type:'text',content:`${para(2)} <b>굵게</b> &amp; <a href="https://www.example.com/x">링크</a> {괄호} "따옴표" \\ 끝`},
   {type:'raw_html',content:'<div>광고 칸</div>'},
   {type:'text',content:para(3)},
  ]};
 return `<!DOCTYPE html><html lang="ko"><head><title>합성 기사 제목 - 합성일보</title>
<meta property="og:title" content="합성 기사 제목"><meta property="og:site_name" content="합성일보">
<meta property="og:description" content="공개 리드 문단 한 줄.">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"NewsArticle","headline":"합성 기사 제목","author":[{"@type":"Person","name":"예시 기자"}]}</script>${extraLd}
</head><body><div id="fusion-app"><header><nav><a href="/">메뉴 하나</a><a href="/">메뉴 둘</a></nav></header>
<h1>합성 기사 제목</h1><section class="article-body">${bodyHtml}</section><footer>합성 꼬리 © 합성일보</footer></div>
<script id="fusion-metadata" type="application/javascript">window.Fusion=window.Fusion||{};Fusion.arcSite="synth";Fusion.globalContent=${JSON.stringify(g)};Fusion.globalContentConfig={"source":"x"};</script>
</body></html>`;
};

test('Arc globalContent: text·header 칸만 본문으로(사진·광고 칸 제외), 안쪽 태그·문자 참조를 글자로',()=>{
 const t=J.arcBody(arcPage());
 assert.ok(t);
 const lines=t.split('\n');
 assert.equal(lines.length,4);
 assert.ok(lines[0].startsWith('합성 경제 기사 1번째'));
 assert.equal(lines[1],'합성 소제목');
 assert.ok(lines[2].includes('굵게 & 링크 {괄호} "따옴표" \\ 끝'));
 assert.ok(!t.includes('<')&&!t.includes('광고 칸')&&!t.includes('합성 사진'));
});

test('Arc 유료 표시(content_restrictions)·짝이 안 맞는 JSON·표시 없음은 읽지 않는다',()=>{
 assert.equal(J.arcBody(arcPage({restrict:'premium'})),null);
 assert.equal(J.arcBody(arcPage({restrict:'subscriber'})),null);
 assert.ok(J.arcBody(arcPage({restrict:'free'})));
 assert.equal(J.arcBody('<script>Fusion.globalContent={"content_elements":[{"type":"text","content":"끝나지 않음"}</script>'),null);
 assert.equal(J.arcBody('<p>보통 페이지</p>'),null);
});

test('JSON-LD articleBody: 기사 종류만, @graph 안도, isAccessibleForFree=false는 읽지 않음',()=>{
 const ld=v=>`<script type="application/ld+json">${JSON.stringify(v)}</script>`;
 assert.equal(J.ldArticleBody(ld({'@type':'NewsArticle',articleBody:'첫 줄\n\n둘째 줄 &amp; 끝'})),'첫 줄\n둘째 줄 & 끝');
 assert.equal(J.ldArticleBody(ld({'@graph':[{'@type':'WebPage'},{'@type':['NewsArticle'],articleBody:'그래프 안 본문'}]})),'그래프 안 본문');
 assert.equal(J.ldArticleBody(ld({'@type':'NewsArticle',isAccessibleForFree:false,articleBody:'유료 본문'})),null);
 assert.equal(J.ldArticleBody(ld({'@type':'NewsArticle',isAccessibleForFree:'False',articleBody:'유료 본문'})),null);
 assert.equal(J.ldArticleBody(ld({'@type':'Product',articleBody:'기사 아님'})),null);
 assert.equal(J.ldArticleBody('<script type="application/ld+json">{깨진 JSON</script>'),null);
 // 둘 다 있으면 더 긴 쪽.
 const both=arcPage({extraLd:ld({'@type':'NewsArticle',articleBody:'짧은 요약 본문'})});
 assert.equal(J.jsonBody(both).via,'arc');
});

test('readArticlePage: 본문 태그가 빈 Arc 페이지 → 리드가 아니라 전체 본문(json_arc), 메뉴·꼬리 글자 없음',()=>{
 const info=NP.readArticlePage(arcPage(),NOW,RULE);
 assert.equal(info.state,'ok');
 assert.equal(info.body_kind,'full');
 assert.equal(info.blocks.state,'ok');
 assert.equal(info.blocks.scope,'json_arc');
 assert.ok(info.body.includes('합성 경제 기사 3번째'));
 for(const junk of ['메뉴 하나','합성 꼬리','공개 리드 문단'])assert.ok(!info.body.includes(junk),junk);
});

test('readArticlePage: 본문 태그에 충분한 본문이 있으면 그대로(사진 유지), 유료벽 페이지는 구조화 본문도 읽지 않음',()=>{
 const tagBody=[1,2,3,4].map(i=>`<p>${para(i)}</p>`).join('')+'<figure><img src="https://www.example.com/p.jpg" alt="합성 사진"></figure>';
 const info=NP.readArticlePage(arcPage({bodyHtml:tagBody}),NOW,RULE);
 assert.equal(info.blocks.state,'ok');
 assert.notEqual(info.blocks.scope,'json_arc');
 assert.equal(info.blocks.images,1);
 const paid=arcPage({extraLd:'<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false,"articleBody":"유료 본문 전체"}</script>'});
 const p=NP.readArticlePage(paid,NOW,RULE);
 assert.equal(p.state,'paywall');
 assert.ok(!(p.body||'').includes('합성 경제 기사 3번째'));
});

test('note-import buildResult: Arc 페이지가 앞부분만(lead_only)이 아니라 ok로',()=>{
 const r=H.buildResult({text:arcPage(),url:URL_,contentType:'text/html; charset=utf-8'},NOW);
 assert.equal(r.state,'ok');
 assert.equal(r.reason,null);
 assert.ok(r.blocks.some(b=>b.text.includes('합성 경제 기사 2번째')));
 assert.equal(r.author,'예시 기자');
});

test('상한·연결: 파싱 길이 상한이 있고 공용 판정(feed-extract withPageJson)이 공용 부품을 부르며 page.ts·outside-feed가 그 판정을 쓴다(S69-06)',()=>{
 assert.equal(J.objectAfter('x={"a":"'+'가'.repeat(50)+'"}',/x=/,20),null);
 const page=readFileSync(new URL('../../supabase/functions/news-feed/page.ts',import.meta.url),'utf8');
 assert.match(page,/withPageJson\(/);
 const fx=readFileSync(new URL('../../supabase/functions/_shared/feed-extract.ts',import.meta.url),'utf8');
 assert.match(fx,/import \{ jsonBody \} from "\.\/page-json-body\.ts";/);
 const out=readFileSync(new URL('../../supabase/functions/outside-feed/handler.ts',import.meta.url),'utf8');
 assert.match(out,/return withPageJson\(tagEx, page\.text,/);
 const src=readFileSync(new URL('../../supabase/functions/_shared/page-json-body.ts',import.meta.url),'utf8');
 assert.ok(!/fetch\(|cookie|authorization/i.test(src.replace(/^\s*\/\/.*$/gm,'')));
});

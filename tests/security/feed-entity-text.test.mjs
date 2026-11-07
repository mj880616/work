// S52-38 NEWS-글자표기깨짐: 수집한 제목·요약·본문에 'quot;'·'middot;'·'hellip;'·'lsquo;'·'rsquo;'·'&quot;' 같은 표기가 글자로 남지 않는다.
// 글자 풀기는 공용 한 곳(supabase/functions/_shared/html-entities.ts). 네트워크 없음, 글은 모두 지어낸 것.
// - 프레시안 RSS 모양: 제목의 따옴표·가운뎃점·말줄임표가 '&' 없이 'quot;'·'middot;'·'hellip;'로 온다(11/08 요청함 캡처, 피드 원문 확인).
// - 두 번·세 번 감싼 표기(&amp;quot;·&amp;amp;quot;), 숫자 표기(&#39;·&#x27;·'#39;'), CDATA 안 표기.
// - 전수: News 매체(RSS 전부)·구글 뉴스·사회운동 단체(RSS·목록 HTML·텔레그램 표본 전부)·기사 쪽 제목(og:title)·정돈 함수·사진 대체 글.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const E=await import('../../supabase/functions/_shared/html-entities.ts');
const P=await import('../../supabase/functions/outside-feed/parse.ts');
const T=await import('../../supabase/functions/_shared/outside-tidy.ts');
const {NEWS_CATALOG,GOOGLE_NEWS}=await import('../../supabase/functions/_shared/news-catalog.ts');
const {OUTSIDE_CATALOG}=await import('../../supabase/functions/_shared/outside-catalog.ts');
const {readArticlePage}=await import('../../supabase/functions/news-feed/page.ts');
const {extractBlocks}=await import('../../supabase/functions/_shared/feed-extract.ts');

const NOW=Date.parse('2026-11-04T03:00:00Z');
// 남으면 안 되는 표기: '&'가 있는 이름·숫자 표기, 또는 영문·숫자 뒤가 아닌 자리의 'quot;' 같은 낱말.
const LEFT=/&(?:[a-z][a-z0-9]{1,7}|#\d{1,7}|#x[0-9a-f]{1,6});|(?<![A-Za-z0-9])(?:quot|apos|amp|middot|hellip|lsquo|rsquo|ldquo|rdquo|nbsp|ndash|mdash|laquo|raquo|#0?39|#x27|#0?34|#8216|#8217|#8220|#8221|#8230|#183);/i;
const fields=it=>[it.title,it.subtitle,it.summary,it.content].filter(v=>typeof v==='string');

test('decodeText: 이름·숫자 표기, 두 번·세 번 감싼 표기, & 빠진 표기', ()=>{
 const cases=[
  ['가짜 의원 quot;가짜 성과 영원히quot;', '가짜 의원 "가짜 성과 영원히"'],
  ['언니middot;누나에게 배우고hellip;가짜여고middot;가짜초', '언니·누나에게 배우고…가짜여고·가짜초'],
  ["[속보] 가짜, lsquo;가짜 합당론rsquo;에 quot;반찬종지인가quot;", '[속보] 가짜, ‘가짜 합당론’에 "반찬종지인가"'],
  ['ldquo;가짜rdquo; ndash; 끝', '“가짜” – 끝'],
  ['&quot;하나&quot; &middot; &hellip; &lsquo;둘&rsquo; &#39;셋&#39; &#x27;넷&#x27; &#8220;다섯&#8221;', '"하나" · … ‘둘’ \'셋\' \'넷\' “다섯”'],
  ['&amp;quot;두 번&amp;quot; &amp;middot; &amp;#39;', '"두 번" · \''],
  ['&amp;amp;quot;세 번&amp;amp;quot;', '"세 번"'],
  ['amp;quot;& 빠진 두 번amp;quot;', '"& 빠진 두 번"'],
  ["It#39;s a fake, don#39;t", "It's a fake, don't"],
  ['Fake &amp;amp; title', 'Fake & title'],
  ['lt;가짜 책gt; 소개', '<가짜 책> 소개'],
 ];
 for(const [raw,want] of cases)assert.equal(E.decodeText(raw),want,raw);
 // 낱말 끝·모르는 이름·이미 풀린 글자는 그대로.
 for(const s of ['Volt; camp; Bolt;','R&D 가짜 & 회사','&unknownx; 그대로','"이미" ‘풀린’ 글자','가짜 제목 그대로'])assert.equal(E.decodeText(s),s,s);
 // 두 번 돌려도 같다(정돈 함수가 다시 고치려 들지 않음).
 for(const [raw] of cases)assert.equal(E.decodeText(E.decodeText(raw)),E.decodeText(raw),raw);
 // 한 번 풀기(주소·속성값)는 한 겹만.
 assert.equal(E.decodeEntities('a&amp;amp;b'),'a&amp;b');
 assert.equal(E.decodeEntities('?a=1&amp;b=2'),'?a=1&b=2');
 // 제어 문자 번호는 빈칸.
 assert.equal(E.decodeText('가&#1;나&#x7f;다'),'가 나 다');
});

test('태그는 글자로도 살리지 않는다(제목은 걷고, 본문 글자는 글자로만)', ()=>{
 assert.equal(P.cleanTitle('&lt;b&gt;가짜&lt;/b&gt; 제목 &amp;lt;i&amp;gt;굵게&amp;lt;/i&amp;gt;'),'가짜 제목 굵게');
 assert.equal(P.cleanTitle('<![CDATA[가짜 &quot;제목&quot;]]>'.replace(/<!\[CDATA\[|\]\]>/g,'')),'가짜 "제목"');
 assert.equal(P.feedText('&lt;p&gt;가짜 quot;본문quot;&lt;/p&gt;&lt;p&gt;둘째middot;줄&lt;/p&gt;'),'가짜 "본문"\n둘째·줄');
});

// RSS 한 건: 제목·요약·본문에 세 가지 모양을 섞는다.
const RAW_TITLE='가짜 의원 quot;성과middot;노고quot; &amp;lsquo;두 번&amp;rsquo; &amp;amp;quot;세 번&amp;amp;quot; hellip; &amp;#39;숫자&amp;#39;';
const WANT_TITLE='가짜 의원 "성과·노고" ‘두 번’ "세 번" … \'숫자\'';
const rss=(host,title=RAW_TITLE)=>`<rss><channel><item><title>${title}</title><link>https://${host}/a/1</link><pubDate>Wed, 04 Nov 2026 01:00:00 +0000</pubDate>`+
 `<description>가짜 요약 quot;따옴표quot; &amp;middot; 끝hellip;</description><content:encoded><![CDATA[<p>가짜 본문 &quot;하나&quot; middot; lsquo;둘rsquo;</p>]]></content:encoded></item></channel></rss>`;

test('News 매체 RSS 전부: 제목·요약·본문에 표기 글자가 남지 않는다', ()=>{
 const rows=[];
 for(const s of [...NEWS_CATALOG.filter(x=>x.mode==='rss'),GOOGLE_NEWS]){
  const host=s.hosts?.[0]??'news.google.com';
  const [it]=P.parseFeed(s,rss(host),NOW);
  assert.ok(it,`${s.key}: 글 한 건`);
  const title=T.tidyTitle(it.title,s.name??'',{split:false}).title;
  assert.equal(title,WANT_TITLE,s.key);
  for(const v of fields(it))assert.doesNotMatch(v,LEFT,`${s.key}: ${v}`);
  assert.match(it.summary,/"따옴표" · 끝…/,s.key);
  assert.match(it.content,/"하나" · ‘둘’/,s.key);
  rows.push(s.key);
 }
 assert.ok(rows.includes('news-pressian'));
});

test('사회운동 RSS 단체 전부(노동자연대·Socialist Worker 등): 같은 모양을 같은 결과로', ()=>{
 for(const s of OUTSIDE_CATALOG.filter(x=>x.mode==='rss')){
  const [it]=P.parseFeed(s,rss(s.hosts[0]),NOW);
  assert.ok(it,`${s.key}: 글 한 건`);
  assert.equal(T.tidyTitle(it.title,s.name,{split:false}).title,WANT_TITLE,s.key);
  for(const v of fields(it))assert.doesNotMatch(v,LEFT,`${s.key}: ${v}`);
 }
});

// 표본(tests/fixtures/outside-feed) 전부: 지금 표본에서 표기 글자가 남지 않고, 표본 제목 가운데에 표기를 끼워 넣어도 글자로 풀린다.
const FX=name=>readFileSync(new URL(`../fixtures/outside-feed/${name}`,import.meta.url),'utf8');
const LISTS={kctu:['kctu.html'],kptu:['kptu.html'],kmwu:['kmwu.html'],kfsu:['kfsu.html'],hakbi:['hakbi.html'],laborparty:['laborparty.html'],kgreens:['kgreens-statement.html','kgreens-press.html'],
 jinboparty:['jinboparty-comment.html','jinboparty-press.html'],justice:['justice-telegram.html'],pssp:['pssp.html'],ws:['ws.xml'],platformc:['platformc.html'],leftall:['leftall.html'],
 socialism:['socialism.html'],socialist:['socialist-telegram.html'],jacobin:['jacobin.xml'],labornotes:['labornotes.xml'],redpepper:['redpepper.xml'],socialistworker:['socialistworker.xml']};
const parse=(s,text,i)=>s.mode==='rss'?P.parseFeed(s,text,NOW):s.mode==='telegram'?P.parseTelegram(s,text,NOW):P.parseListHtml(s,text,s.lists[i],30,undefined,NOW);
const INJECT=' lsquo;합성rsquo;middot;끝&amp;quot;표&amp;quot;hellip; ',INJECTED='‘합성’·끝"표"…';

test('사회운동 단체 표본 전부(목록 HTML·텔레그램·RSS): 표기를 끼워 넣어도 제목이 글자로 풀린다', ()=>{
 assert.deepEqual(Object.keys(LISTS).sort(),OUTSIDE_CATALOG.map(s=>s.key).sort(),'카탈로그 단체 전부');
 const done=[];
 for(const s of OUTSIDE_CATALOG)for(const [i,f] of LISTS[s.key].entries()){
  const text=FX(f),items=parse(s,text,i);
  assert.ok(items.length,`${s.key}/${f}`);
  for(const it of items)for(const v of fields(it))assert.doesNotMatch(v,LEFT,`${s.key}/${f}: ${v}`);
  // 글 제목의 6자 조각을 표본에서 찾아 그 뒤에 끼워 넣는다(제목 조각이 표본에 그대로 있을 때).
  let head='',at=-1;
  for(const it of items){for(let o=0;o<6&&at<0;o++){head=[...it.title].slice(o,o+6).join('');if(head.length===6)at=text.indexOf(head);}if(at>=0)break;}
  if(at<0)continue;
  const changed=text.slice(0,at+head.length)+INJECT+text.slice(at+head.length);
  const again=parse(s,changed,i);
  assert.ok(again.some(it=>it.title.includes(INJECTED)||(it.subtitle??'').includes(INJECTED)||(it.content??'').includes(INJECTED)),`${s.key}/${f}: ${again.map(x=>x.title).join(' | ')}`);
  for(const it of again){
   for(const v of fields(it))assert.doesNotMatch(v,LEFT,`${s.key}/${f}: ${v}`);
   const tidy=T.tidyTitle(it.title,s.name,{split:s.lang==='ko'});
   for(const v of [tidy.title,tidy.subtitle].filter(Boolean))assert.doesNotMatch(v,LEFT,`${s.key}/${f} tidy: ${v}`);
  }
  done.push(s.key);
 }
 // 텔레그램 두 단체(정의당·사회주의자)와 목록 HTML 단체 대부분이 실제로 끼워 넣기 시험을 거쳤는지.
 for(const k of ['justice','socialist','ws','socialistworker','pssp'])assert.ok(done.includes(k),`${k} 끼워 넣기 시험`);
 assert.ok(new Set(done).size>=15,`끼워 넣기 시험 단체 수 ${new Set(done).size}`);
});

test('정돈 함수: 어느 길로 들어온 제목·요약이든 표기를 글자로(옛 글 다시 정돈 포함)', ()=>{
 assert.equal(T.tidyTitle('[성명] 가짜 quot;제목quot; middot; 끝','가짜단체',{split:false}).title,'가짜 "제목" · 끝');
 assert.equal(T.tidySummary('가짜 요약 lsquo;하나rsquo;hellip;'),'가짜 요약 ‘하나’…');
 assert.equal(T.pageTitleFrom('<html><head><meta property="og:title" content="가짜 &amp;quot;글 쪽&amp;quot; 제목 middot; 끝"></head></html>'),'가짜 "글 쪽" 제목 · 끝');
 // 고친 제목은 정돈 함수에 다시 넣어도 같다(수집기의 '옛 글 다시 정돈'이 되풀이 고치지 않음).
 const t=T.tidyTitle('가짜 quot;제목quot;','',{split:false}).title;assert.equal(T.tidyTitle(t,'',{split:false}).title,t);
});

test('기사 쪽(채널 기사·외국 기사): og:title·<title>·설명·본문에 표기가 남지 않는다', ()=>{
 const html='<html lang="ko"><head><meta property="og:title" content="가짜 기사 quot;제목quot; &amp;middot; 끝hellip;">'+
  '<meta property="og:description" content="가짜 설명 lsquo;하나rsquo;"><meta property="og:site_name" content="가짜&amp;amp;매체"></head>'+
  '<body><article><p>가짜 본문 첫 문장 quot;인용quot;입니다. 둘째 문장 middot; 셋째.</p><p>가짜 본문 둘째 문단 &amp;quot;두 번&amp;quot; 글.</p></article></body></html>';
 const page=readArticlePage(html,NOW);
 assert.equal(page.title,'가짜 기사 "제목" · 끝…');
 assert.equal(page.publisher,'가짜&매체');
 for(const v of [page.title,page.body,page.description].filter(v=>typeof v==='string'))assert.doesNotMatch(v,LEFT,v);
 const t=readArticlePage('<html><head><title>가짜 &amp;amp;quot;제목&amp;amp;quot; rsquo;</title></head><body><p>짧은 본문</p></body></html>',NOW).title;
 assert.equal(t,'가짜 "제목" ’');
});

test('본문 블록: 문단·캡션·사진 대체 글에 표기가 남지 않는다', ()=>{
 const ex=extractBlocks({html:'<p>가짜 문단 quot;하나quot; middot; 둘 &amp;quot;셋&amp;quot; 넷 다섯 여섯 일곱 여덟 아홉 열.</p><figure><img src="https://example.org/a.jpg" alt="가짜 사진 quot;대체quot;"><figcaption>가짜 캡션 lsquo;하나rsquo;</figcaption></figure><p>가짜 둘째 문단 hellip; 끝.</p>',
  base:'https://example.org/a/1',fragment:true,title:'가짜',rule:{key:'test',version:1}});
 const texts=(ex.blocks??[]).flatMap(b=>[b.text,b.cap,b.alt]).filter(v=>typeof v==='string');
 assert.ok(texts.length>=2,JSON.stringify(ex));
 for(const v of texts)assert.doesNotMatch(v,LEFT,v);
 assert.ok(texts.some(v=>v.includes('"하나" · 둘 "셋"')),JSON.stringify(texts));
});

// S61-37 NEWS-원문표기깨짐2: 한글 문서를 붙여 넣은 누리집(공공운수노조 보도자료 등) 글 원문에
// '&middot'·'&rarr'가 글자로 남고 '13 일'·'잠정합의했습니다 .'처럼 빈칸이 끼던 문제.
// 고친 곳은 공용 한 곳: outside-feed/parse.ts stripTags·htmlToText(글자 모양 태그는 빈칸 없이 걷음),
// _shared/html-entities.ts decodeText(';' 빠진 흔한 이름 표기 풀기). 네트워크 없음, 글은 모두 지어낸 것.
// 시험 재료는 한글 문서 붙여넣기 HTML 모양(글자 덩어리마다 <SPAN style>, <FONT>, <o:p>, ';' 없는 표기, 태그로 쪼개진 '&middot'+';')을 재현했다.
import test from 'node:test';
import assert from 'node:assert/strict';

const E=await import('../../supabase/functions/_shared/html-entities.ts');
const P=await import('../../supabase/functions/outside-feed/parse.ts');
const {OUTSIDE_CATALOG}=await import('../../supabase/functions/_shared/outside-catalog.ts');
const {extractBlocks}=await import('../../supabase/functions/_shared/feed-extract.ts');
const {readArticlePage}=await import('../../supabase/functions/news-feed/page.ts');

const S=(t,f="'맑은 고딕'")=>`<SPAN style="FONT-FAMILY: ${f}; FONT-SIZE: 11pt; LETTER-SPACING: -0.5pt">${t}</SPAN>`;
// 한글 문서 붙여넣기 모양: 문단은 <P class=HStyle0>, 글자는 덩어리마다 SPAN, 숫자·괄호·마침표가 따로 쪼개짐.
const HWP_BODY=[
  `<P class=HStyle0 style="TEXT-ALIGN: justify">${S('가짜철도 노사가 ')}${S('13')}${S('일 경고파업을 앞두고 ')}${S('잠정합의했습니다')}${S('.')} ${S('이에 따라 파업은 철회됩니다.')}</P>`,
  `<P class=HStyle0>${S('저연차 ')}${S('(6')}${S('급')}${S(')')} ${S('처우개선 ')}${S('&middot')} ${S('안전인력 충원')}</P>`,
  `<P class=HStyle0>${S('&middot')} ${S('근속승진제 첫 도입 ')}${S('(2027')}${S('년 ')}${S('1')}${S('월 시행')}${S(')')}${S(',')}</P>`,
  `<P class=HStyle0>${S('4')}${S('급 ')}${S('&rarr')} ${S('3')}${S('급')} <FONT color=#000000>승진 </FONT><B>확대</B><o:p></o:p></P>`,
  `<P class=HStyle0>${S('태그로 쪼개진 표기')} ${S('&middot')}${S(';')} ${S('끝')}&nbsp;${S('&amp;rarr;')} ${S('두 번 감싼 표기')}</P>`,
].join('\n');
const PAGE=`<!doctype html><html><head><title>가짜철도 노사 잠정합의, 13일 경고파업 철회 | 가짜노조</title></head><body>
<nav><a href="/">처음</a></nav><form method="post" action="./detail.aspx?mid=F686C1F3&amp;idx=1">
<div class="publishList_title"><H3><SPAN>가짜철도 노사 잠정합의, </SPAN><SPAN>13</SPAN><SPAN>일 경고파업 철회</SPAN></H3></div>
<div class="publishList_write">${HWP_BODY}</div></form><footer>저작권</footer></body></html>`;

const LEFT=/&(?:middot|rarr|larr|nbsp|quot|amp|lt|gt|hellip)\b|\d \S*[일년월급]|\S \.|\( |\s\)/;

test('decodeText: ";" 빠진 흔한 이름 표기를 푼다, 낱말·주소 꼴은 그대로', ()=>{
 const cases=[
  ['처우개선 &middot 안전인력','처우개선 · 안전인력'],
  ['4급 &rarr 3급, 3급 &larr 4급','4급 → 3급, 3급 ← 4급'],
  ['&middot안전','·안전'],
  ['끝&nbsp;그리고&nbsp 다음','끝 그리고  다음'],
  ['&quot가짜&quot','"가짜"'],
  ['A &amp B, 1 &lt 2 &gt 0, 기다림&hellip','A & B, 1 < 2 > 0, 기다림…'],
  ['&amp;middot 두 번 감싼 표기','· 두 번 감싼 표기'],
  ['&amp;amp;rarr 세 번','→ 세 번'],
 ];
 for(const [raw,want] of cases)assert.equal(E.decodeText(raw),want,raw);
 // 낱말 끝·주소 꼴·모르는 이름은 그대로.
 for(const s of ['&copyright 2026','?a=1&lt=2','R&D 가짜 & 회사','&middotx','&Middot 대문자 다름','Volt; camp;','&unknown 그대로'])assert.equal(E.decodeText(s),s,s);
 // 한 번 풀기(주소·속성값용)는 ';' 없는 표기를 건드리지 않는다.
 assert.equal(E.decodeEntities('a=1&lt=2&middot'),'a=1&lt=2&middot');
 // 두 번 돌려도 같다.
 for(const [raw] of cases)assert.equal(E.decodeText(E.decodeText(raw)),E.decodeText(raw),raw);
});

test('stripTags·htmlToText: 글자 모양 태그는 빈칸 없이, 칸 나누는 태그는 빈칸·줄바꿈', ()=>{
 assert.equal(P.htmlToText('<span>13</span><span>일</span>'),'13일');
 assert.equal(P.htmlToText('<SPAN style="x">잠정합의했습니다</SPAN><SPAN>.</SPAN>'),'잠정합의했습니다.');
 assert.equal(P.htmlToText('<b>굵게</b><i>기울임</i><font color=red>색</font><a href="/x">고리</a><sup>1</sup><o:p></o:p>끝'),'굵게기울임색고리1끝');
 // 칸 나누는 태그: 표 칸·그림·입력은 빈칸, 문단·줄바꿈은 줄바꿈.
 assert.equal(P.htmlToText('<table><tr><td>번호</td><td>제목</td></tr></table>'),'번호 제목');
 assert.equal(P.htmlToText('<p>첫 줄</p><p>둘째<br>셋째</p>'),'첫 줄\n둘째\n셋째');
 assert.equal(P.htmlToText('앞<img src="a.png">뒤'),'앞 뒤');
 // 비슷한 이름의 칸 태그는 글자 모양 태그로 보지 않는다(<section>·<summary>·<button>·<ul>·<image>).
 assert.equal(P.stripTags('가<section>나</section>다<button>라</button>마<summary>바</summary>'),'가 나 다 라 마 바 ');
 // 태그로 쪼개진 표기('&middot' + '<span>;</span>')가 다시 붙어 풀린다.
 assert.equal(P.htmlToText('가<span>&middot</span><span>;</span>나'),'가·나');
 // 글자 사이 원래 빈칸은 빈칸 하나로 남는다(원래 줄바꿈 글자를 줄로 두는 예전 동작은 그대로).
 assert.equal(P.htmlToText('<span>가</span>  <span>나</span>\t<span>다</span>'),'가 나 다');
});

test('공공운수노조 보도자료 모양(한글 문서 붙여넣기) 원문: 표기 없음·빈칸 끼지 않음', ()=>{
 const src=OUTSIDE_CATALOG.find(s=>s.key==='kptu');
 assert.ok(src,'kptu 카탈로그');
 const out=extractBlocks({html:PAGE,base:'https://www.kptu.net/board/detail.aspx?mid=F686C1F3&idx=1',title:'가짜철도 노사 잠정합의, 13일 경고파업 철회',
  key:src.key,rule:src.extract,body:src.bodyClass,minChars:50});
 assert.equal(out.state,'ok',JSON.stringify(out));
 const text=out.blocks.filter(b=>b.t!=='img').map(b=>b.text).join('\n');
 assert.ok(!LEFT.test(text),text);
 for(const want of ['13일 경고파업을 앞두고 잠정합의했습니다. 이에 따라','저연차 (6급) 처우개선 · 안전인력 충원','· 근속승진제 첫 도입 (2027년 1월 시행),',
  '4급 → 3급 승진 확대','태그로 쪼개진 표기 · 끝 → 두 번 감싼 표기'])assert.ok(text.includes(want),`${want}\n---\n${text}`);
});

test('같은 종류 전수: 목록 제목(cleanTitle)·피드 요약(feedText)·기사 쪽 제목(readArticlePage)', ()=>{
 assert.equal(P.cleanTitle('<span>가짜 노사 </span><span>13</span><span>일 합의 &middot 철회</span>'),'가짜 노사 13일 합의 · 철회');
 assert.equal(P.cleanTitle('&lt;span&gt;이스케이프된&lt;/span&gt;&lt;span&gt; 제목&lt;/span&gt;&lt;b&gt;.&lt;/b&gt;'),'이스케이프된 제목.');
 assert.equal(P.feedText('<p><span>요약 </span><span>4</span><span>급 &rarr 3</span><span>급</span><span>.</span></p>'),'요약 4급 → 3급.');
 // 텔레그램 소식 링크 글처럼 한 번 더 이스케이프돼 온 본문 칸.
 assert.equal(P.feedText('&lt;span&gt;가&lt;/span&gt;&lt;span&gt;&amp;middot&lt;/span&gt;&lt;span&gt;나&lt;/span&gt;'),'가·나');
 const page=readArticlePage('<html><head><meta property="og:title" content="가짜 기사 &amp;middot 제목"><title>x</title></head><body><article><p>'+'본문 '.repeat(80)+'</p></article></body></html>','https://example.com/a');
 if(page&&page.title)assert.ok(!/&middot/.test(page.title),page.title);
});

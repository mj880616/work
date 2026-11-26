// S67-19(11/20 사용자 '금속노조 글 제대로 못불러오는 현상 점검'): 그누보드 글 쪽 본문 칸·잘린 목록 제목.
// 네트워크 없음. 표본(tests/fixtures/outside-feed/kmwu-article.html·kmwu-list-cut.html)은 그누보드 기본 글 쪽 모양에 맞춰 지어낸 것이다(글자는 실제 성명이 아님).
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const OC=await import('../../supabase/functions/_shared/outside-catalog.ts');
const P=await import('../../supabase/functions/outside-feed/parse.ts');
const H=await import('../../supabase/functions/outside-feed/handler.ts');
const T=await import('../../supabase/functions/_shared/outside-tidy.ts');
const E=await import('../../supabase/functions/_shared/feed-extract.ts');
const FX=name=>readFileSync(new URL(`../fixtures/outside-feed/${name}`,import.meta.url),'utf8');
const NOW=Date.parse('2026-11-19T10:00:00Z');
const ART=FX('kmwu-article.html');
const FULL='가상 하청 노동자 집단해고, 원청이 책임져라';
const textOf=ex=>ex.blocks.filter(b=>b.t!=='img').map(b=>b.text).join('\n');

test('금속노조: 목록 제목이 줄임표로 잘려도 글 쪽 제목 전체를 쓴다',()=>{
 const src=OC.sourceByKey('kmwu');
 const [it]=P.parseListHtml(src,FX('kmwu-list-cut.html'),src.lists[0],30,undefined,NOW);
 assert.equal(it.title,'[성명] 가상 하청 노동자 집…','목록 칸 글자 그대로(잘림)');
 assert.equal(it.kind,'statement');
 assert.equal(T.pageTitleFrom(ART),'[성명] 가상 하청 노동자 집단해고, 원청이 책임져라 > 보도자료/성명 | 전국금속노동조합');
 assert.equal(T.pageTitleHead(T.pageTitleFrom(ART)),'[성명] 가상 하청 노동자 집단해고, 원청이 책임져라','게시판·사이트 이름 꼬리 떼기');
 const better=T.betterTitle(it.title,T.pageTitleFrom(ART),src.name);
 assert.equal(better,FULL);
 assert.equal(T.tidyTitle(better,src.name,{split:true}).title,FULL,'저장 정돈 뒤에도 제목 전체');
 // 잘리지 않은 목록 제목·다른 글 제목·너무 짧은 앞부분은 그대로(예전 동작)
 assert.equal(T.betterTitle('[성명] 가상 다른 글…','[성명] 가상 하청 노동자 집단해고 | 사이트',src.name),null,'앞부분이 다르면 쓰지 않음');
 assert.equal(T.betterTitle('[성명] 가…',T.pageTitleFrom(ART),src.name),null,'잘린 앞부분이 4자 미만이면 쓰지 않음');
 assert.equal(T.betterTitle('[성명] 가상 하청 노동자 집단해고, 원청이 책임져라',T.pageTitleFrom(ART),src.name),null,'잘리지 않은 제목은 그대로');
 assert.equal(T.pageTitleHead('가상 > 제목'),'가상 > 제목','앞이 4자 미만이면 꼬리를 떼지 않음');
});

test('금속노조: 본문 칸 #bo_v_con에서 본문 글이 나온다(본문 앞 목록 단추·댓글 수·첨부 줄 빼기)',()=>{
 const src=OC.sourceByKey('kmwu');
 assert.ok(src.bodyClass.test('bo_v_con'));
 assert.equal(E.ruleId('kmwu',src.extract),'kmwu@3','판을 올려 옛 글을 다시 뽑기로 한 번 다시 읽음');
 const it={url:'https://kmwu.kr/bbs/board.php?bo_table=ce_B12&wr_id=9001',title:'[성명] 가상 하청 노동자 집…',kind:'statement',published_at:null,author:null,summary:null,content:null};
 const ex=H.postBody(src,it,{ok:true,text:ART,url:it.url});
 assert.deepEqual([ex.state,ex.reason,ex.rule],['ok',null,'kmwu@3']);
 const text=textOf(ex);
 assert.match(text,/^가상 회사의 하청 노동자들이 한꺼번에 해고 통보를 받았다/);
 assert.match(text,/원청이 직접 교섭에 나서고 해고를 거두어들일 것을 요구한다/);
 for(const no of [/목록/,/글쓰기/,/첨부/,/\.hwp/,/다운로드/,/이전글/,/댓글/,/추천/,/스크랩/,/Copyright/,/페이지 정보/])assert.doesNotMatch(text,no);
 // 본문 글자 함수(문장 표·AI 재료)도 같은 칸
 assert.match(P.extractBody(ART,it.title,src.bodyClass),/^가상 회사의 하청 노동자들이/);
});

test('같은 종류(그누보드 글 쪽, 단체 본문 칸 없음): 본문 앞 단추·댓글 수 줄에서 끊기지 않는다',()=>{
 // 예전: 첫 <article>(#bo_v)을 본문 칸으로 골라 '댓글 0건'·'목록' 줄(본문 끝 표시와 머리가 같음)에서 끊겨 no_body.
 const ex=E.extractBlocks({html:ART,base:'https://kmwu.kr/bbs/board.php?bo_table=ce_B12&wr_id=9001',title:'[성명] 가상 하청 노동자 집…',key:'kmwu',rule:{version:3},minChars:60});
 assert.equal(ex.state,'ok');
 assert.match(textOf(ex),/원청이 직접 교섭에 나서고/);
 assert.doesNotMatch(textOf(ex),/이전글|댓글목록|등록된 댓글/,'본문 뒤 이전글·댓글 칸은 예전처럼 끝');
 // 본문이 정말 없는 글(첨부뿐)은 댓글 칸 글을 본문으로 읽지 않는다.
 const empty=ART.replace(/<div id="bo_v_con">[\s\S]*?<\/div>\s*<div id="bo_v_act">/,'<div id="bo_v_con"></div><div id="bo_v_act">')
  .replace('<p id="bo_vc_empty">등록된 댓글이 없습니다.</p>','<article id="c_1"><p>가상 댓글 글자가 길게 이어진다. 이 줄은 본문이 아니라 댓글 칸의 글자이므로 본문으로 읽으면 안 된다.</p></article>');
 const none=E.extractBlocks({html:empty,base:'https://kmwu.kr/x',title:'[성명] 가상 하청 노동자 집…',key:'kmwu',rule:OC.sourceByKey('kmwu').extract,body:OC.sourceByKey('kmwu').bodyClass,minChars:60});
 assert.equal(none.state,'failed');assert.equal(none.reason,'no_body');
 // 같은 줄 자르기 규칙: 본문 앞 단추 줄만 건너뛰고, 본문이 나온 뒤 '목록'은 끝
 const lines=['목록','글쓰기','댓글 0건','본문','가상 본문 문장이 서른 글자를 넘도록 길게 이어지는 줄이다.','목록','가상 꼬리 글자'];
 assert.deepEqual(P.bodyRange(lines,'',false),['가상 본문 문장이 서른 글자를 넘도록 길게 이어지는 줄이다.']);
});

test('같은 종류 전수: 그누보드 단체(금속노조·전국결집)는 본문 칸 #bo_v_con, 사회주의를향한전진은 실측한 #body_content 그대로',()=>{
 const gnu=OC.OUTSIDE_CATALOG.filter(s=>s.lists.some(u=>/\/bbs\/board\.php\?bo_table=/.test(u)));
 assert.deepEqual(gnu.map(s=>s.key),['kmwu','leftall','socialism']);
 for(const key of ['kmwu','leftall'])assert.ok(OC.sourceByKey(key).bodyClass.test('bo_v_con'),key);
 assert.equal(E.ruleId('leftall',OC.sourceByKey('leftall').extract),'leftall@2');
 assert.ok(OC.sourceByKey('socialism').bodyClass.test('body_content'));
 const page=ART.replaceAll('kmwu.kr/bbs/board.php?bo_table=ce_B12','leftall.com/bbs/board.php?bo_table=notice');
 const src=OC.sourceByKey('leftall');
 const ex=H.postBody(src,{url:'https://leftall.com/notice/9001',title:'[입장] 가상 하청 노동자 집…',kind:'statement',published_at:null,author:null,summary:null,content:null},{ok:true,text:page,url:'https://leftall.com/notice/9001'});
 assert.equal(ex.state,'ok');assert.match(textOf(ex),/^가상 회사의 하청 노동자들이/);
});

test('다시 뽑기 제목 고치기: 줄임표로 잘린 저장 제목만, 새로 넣을 때와 같은 정돈',()=>{
 const src=OC.sourceByKey('kmwu');
 assert.equal(H.refillTitle(src,'가상 하청 노동자 집…',ART),FULL);
 assert.equal(H.refillTitle(src,'[성명] 가상 하청 노동자 집…',ART),FULL);
 assert.equal(H.refillTitle(src,FULL,ART),null,'잘리지 않은 제목은 고치지 않음');
 assert.equal(H.refillTitle(src,'가상 다른 글 제목…',ART),null,'다른 글 제목이면 고치지 않음');
 assert.equal(H.refillTitle(src,'가상 하청 노동자 집…','<html><head></head><body></body></html>'),null,'글 쪽 제목이 없으면 그대로');
});

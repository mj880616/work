import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// NEWS-클리핑 D: docs/ops/collector-feed.gs 채널 기사 보내기(tgScrap…) 순수 함수를 node에서 돌리고,
// 만든 몸통이 서버 collector-feed(handler.ts parseScrapBody·scrapUrl·scrapAt)에서 그대로 받아지는지 본다.
// 네트워크·Drive 없음. 채널·주소·글은 모두 지어낸 것이다.
const source=readFileSync(new URL('../../docs/ops/collector-feed.gs',import.meta.url),'utf8');
const sandbox={module:{exports:{}}};
vm.createContext(sandbox);
vm.runInContext(source,sandbox,{filename:'collector-feed.gs'});
const G=sandbox.module.exports;
const {parseScrapBody,scrapUrl,scrapAt,SCRAP_MAX_ITEMS}=await import('../../supabase/functions/collector-feed/handler.ts');
const plain=(o)=>JSON.parse(JSON.stringify(o));
const NOW=Date.parse('2026-11-01T05:00:00Z');
const msg=(id,text,at='2026-11-01T01:00:00.000Z',extra={})=>({id:String(id),day:'2026-11-01',at,text,hasText:!!text,service:false,...extra});

test('앱 스크립트: 채널 구간에 채널 이름·번호·폴더 ID·비밀값이 없고, Drive를 고치지 않으며, 같은 입구·비밀값·자기 트리거를 쓴다',()=>{
  const sec=source.slice(source.indexOf('채널 기사 보내기 (NEWS-클리핑 D)'),source.indexOf('멈춤 알림 (OPS-수집멈춤알림)'));
  assert.ok(sec.length>3000);
  assert.ok(!/1[A-Za-z0-9_-]{30,}/.test(sec),'Drive ID처럼 긴 글자 없음');
  assert.ok(!/-100\d{6,}/.test(sec),'채널 번호 없음');
  assert.ok(!/신문/.test(sec),'채널 이름을 코드에 적지 않음');
  assert.ok(!/setDescription|setContent|setName|setTrashed|moveTo|createFile|createFolder|makeCopy/.test(sec),'Drive를 고치지 않는다');
  for(const m of sec.matchAll(/(?:Logger\.log|new Error)\(([^;]*)\)/g)) assert.ok(!/\bsecret\b|getProperty\(CALL_FEED_SECRET_KEY\)|\.url\b|items\b/.test(m[1]),m[0].slice(0,80));
  assert.match(sec,/getProperty\(TG_SCRAP_TEST_KEY\) !== '끔'/,'시험 모드 기본 켬');
  assert.ok(sec.includes("tgFeed_postAction_('scrap'")&&sec.includes('CALL_FEED_SECRET_KEY'),'같은 입구·같은 비밀값');
  assert.ok(sec.includes("newTrigger('tgScrap_run').timeBased().everyHours(1)"),'자기 매시 트리거');
  assert.ok(!/getScriptLock/.test(sec),'텔레그램 소식 잠금을 기다리지 않음');
  assert.match(sec,/function tgScrap_run_\(\)/);
  assert.equal(G.tgScrapParseRooms('*').length,0,'* 는 받지 않음');
  assert.deepEqual(plain(G.tgScrapParseRooms('가상 채널, *, -100777')),['가상 채널','-100777']);
});

test('기사 줄 뽑기: 줄 앞 한국 시각을 스크랩 시각으로, http·너무 긴 주소는 넘기고, 끝 문장부호를 뗀다',()=>{
  const text=['2026-11-01 09:30:15 https://news.example.com/a/1?utm_source=tg',
    '2026-11-01 09:31:00 http://old.example.com/b',
    '참고 https://news.example.org/c/2). 와 (https://news.example.org/d/3)',
    '2026-11-01 09:30:15 https://news.example.com/a/1?utm_source=tg',
    'https://news.example.net/'+'x'.repeat(2100)].join('\n');
  const r=G.tgScrapLines(text,'2026-11-01T01:00:00.000Z');
  assert.deepEqual(plain(r.items),[
    {url:'https://news.example.com/a/1?utm_source=tg',at:'2026-11-01T00:30:15.000Z'},
    {url:'https://news.example.org/c/2',at:'2026-11-01T01:00:00.000Z'},
    {url:'https://news.example.org/d/3',at:'2026-11-01T01:00:00.000Z'},
  ]);
  assert.equal(r.skipped,2);
});

test('새 줄만·묶음: lastId보다 큰 메시지만 번호 순으로, 50줄 넘지 않게 메시지 단위로 나누고 묶음 끝 번호를 붙인다',()=>{
  const many=Array.from({length:30},(_,i)=>`2026-11-01 08:00:00 https://news.example.com/n/${i}`).join('\n');
  const parsed=[msg(105,many),msg(99,'2026-11-01 08:00:00 https://news.example.com/old'),msg(101,'https://news.example.com/x'),
    msg(103,many.replace(/\/n\//g,'/m/')),msg(104,'글만 있고 주소 없음'),msg(106,''),msg(102,'',undefined,{service:true}),msg(101,'https://news.example.com/x')];
  const p=G.tgScrapPlan(parsed,'100',SCRAP_MAX_ITEMS);
  assert.equal(p.messages,5,'99 이하·시스템 메시지·같은 번호 뺌');
  assert.deepEqual(plain(p.chunks.map(c=>[c.items.length,c.maxId])),[[31,'104'],[30,'106']]);
  assert.equal(p.lines,61);
  const last=G.tgScrapPlan([msg(201,'주소 없음')],'200',50);
  assert.deepEqual(plain(last.chunks),[{items:[],maxId:'201'}],'줄 없는 새 메시지도 위치는 옮김');
  assert.deepEqual(plain(G.tgScrapPlan(parsed,'106',50).chunks),[],'새 메시지 없음');
  const big=G.tgScrapPlan([msg(1,Array.from({length:60},(_,i)=>`https://news.example.com/z/${i}`).join(' '))],'',50);
  assert.equal(big.chunks[0].items.length,50);assert.equal(big.skipped,10);
});

test('만든 몸통은 서버가 그대로 받는다(모양·주소·시각 규칙)',()=>{
  const p=G.tgScrapPlan([msg(7,'2026-11-01 13:59:00 https://www.news.example.com/a/9?fbclid=1\nhttps://news.example.com/b')],'',SCRAP_MAX_ITEMS);
  const body=plain({items:p.chunks[0].items});
  const items=parseScrapBody(body);
  assert.equal(items.length,2);
  for(const it of items){assert.ok(scrapUrl(it.url));assert.ok(scrapAt(it.at,NOW));}
  assert.equal(scrapUrl(items[0].url).url_key,'news.example.com/a/9');
});

test('상태 정리·날짜: 틀린 칸은 버리고, 볼 날 수는 1~14',()=>{
  const s=G.tgScrapStateClean(JSON.stringify({rooms:{'-100555':{m:'42'},'방':{m:'1'},'-1':{m:'x'}},fetch:{d:'2026-11-01',n:5},lastRun:{at:'2026-11-01T00:00:00Z',sends:1,stop:'x'}}));
  assert.deepEqual(plain(s.rooms),{'-100555':{m:'42'}});
  assert.deepEqual(plain(s.fetch),{d:'2026-11-01',n:5});
  assert.equal(G.tgScrapStateClean('깨진 글').lastRun,null);
  assert.equal(G.tgScrapLookDays('5'),5);assert.equal(G.tgScrapLookDays('0'),3);assert.equal(G.tgScrapLookDays('99'),3);
  assert.deepEqual(plain(G.tgScrapDays('2026-11-01',3)),['2026-10-30','2026-10-31','2026-11-01']);
  assert.match(G.tgScrapLastRunText(s.lastRun),/보낸 묶음 1/);
});

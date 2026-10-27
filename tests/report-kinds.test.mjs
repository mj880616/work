// MTG-사업보고 4단계: 칸 값·글자의 유일한 정의(app/report-kinds.mjs)와 PC 2단 목록(listHtml). DB CHECK(20261022182319)와 값이 같아야 한다.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REPORT_KINDS,ALL_KINDS,DEFAULT_KIND,isReportKind,reportKindOf,reportKindLabel,reportKindChips,filterByReportKind} from '../app/report-kinds.mjs';
import {listHtml} from '../app/meeting-columns.js';

test('칸 8개는 DB 허용값과 같은 순서·같은 값이고 화면 글자는 설계 3절과 같다',()=>{
  assert.deepEqual(REPORT_KINDS.map(k=>k.value),['meeting','policy','negotiation','press','assembly','struggle','education','other']);
  assert.deepEqual(REPORT_KINDS.map(k=>k.label),['회의','정책','교섭','언론','국회','투쟁','교육','기타']);
  const sql=readFileSync(new URL('../supabase/migrations/20261022182319_bizreport_activity_kind.sql',import.meta.url),'utf8');
  assert.match(sql,new RegExp(`check \\(activity_kind in\\s+\\(${REPORT_KINDS.map(k=>`'${k.value}'`).join(', ')}\\)\\)`));
  assert.equal(DEFAULT_KIND,'meeting');
  assert.deepEqual(reportKindChips().map(c=>c.label),['전체','회의','정책','교섭','언론','국회','투쟁','교육','기타']);
  assert.equal(reportKindChips()[0].value,ALL_KINDS);
});

test('칸 없음·빈 값·null은 회의, 모르는 값은 기타로 보이고 저장 허용값이 아니다',()=>{
  assert.equal(reportKindOf({}),'meeting');assert.equal(reportKindOf({activity_kind:null}),'meeting');assert.equal(reportKindOf({activity_kind:''}),'meeting');assert.equal(reportKindOf(null),'meeting');
  assert.equal(reportKindOf({activity_kind:'press'}),'press');
  assert.equal(reportKindOf({activity_kind:'future'}),'other');assert.equal(isReportKind('future'),false);assert.equal(isReportKind(ALL_KINDS),false);
  assert.equal(reportKindLabel('assembly'),'국회');assert.equal(reportKindLabel('nope'),'기타');
});

test('칩으로 거르기: [전체]는 전부, [회의]는 칸 없는 옛 행 포함',()=>{
  const rows=[{id:1},{id:2,activity_kind:'meeting'},{id:3,activity_kind:'press'},{id:4,activity_kind:'x'}];
  assert.deepEqual(filterByReportKind(rows,ALL_KINDS).map(r=>r.id),[1,2,3,4]);
  assert.deepEqual(filterByReportKind(rows,'meeting').map(r=>r.id),[1,2]);
  assert.deepEqual(filterByReportKind(rows,'press').map(r=>r.id),[3]);
  assert.deepEqual(filterByReportKind(rows,'other').map(r=>r.id),[4]);
  assert.deepEqual(filterByReportKind(null,'press'),[]);
});

test('2단 목록: 고른 건(없으면 첫 건)이 오른쪽, 줄에 이름·칸·시각, 글자는 이스케이프',()=>{
  const rows=[{id:'a',series_name:'<가상>',meeting_at:'x'},{id:'b',series_name:'둘째'}];
  const seen=[];
  const html=listHtml(rows,{selectedId:'b',label:'전체',nameOf:m=>m.series_name,kindOf:()=>'언론',colorOf:()=>'red',whenOf:()=>'10. 21.',resultHtml:m=>{seen.push(m.id);return '<p>결과</p>'}});
  assert.deepEqual(seen,['b']);
  assert.match(html,/data-meeting-result="b"/);
  assert.match(html,/data-meeting-round="b" aria-controls="mcolResult" aria-label="둘째 · 언론 · 10\. 21\." aria-current="true"/);
  assert.ok(html.includes('&lt;가상&gt;'));assert.ok(!html.includes('<가상>'));
  assert.match(html,/<span class="mcol-count" aria-label="2건">2<\/span>/);
  assert.equal(listHtml(rows,{selectedId:'gone',label:'x',nameOf:m=>m.id,colorOf:()=>'',whenOf:()=>'',resultHtml:m=>`<i>${m.id}</i>`}).includes('data-meeting-result="a"'),true);
  assert.equal(listHtml([],{label:'언론',nameOf:()=>'',colorOf:()=>'',whenOf:()=>''}),'<div class="empty">이 칸에 사업 보고가 없습니다.</div>');
});

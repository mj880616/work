// S7-b 원장 가져오기 검사기 단위 시험. 합성 시트만(tests/ledger-import-fixture.mjs, 09xx ID). 실제 원장 내용 없음.
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,tabNameFromFile,tabKey,normalizeId,expandRefs,parseLedgerDate,parseDay,looksPersonal,readInputFiles,readXlsx,analyze,numberCheck,FORMAT} from '../app/ledger-import-model.mjs';
import {TABS,csvFiles,csvText,xlsxBytes} from './ledger-import-fixture.mjs';

const enc=new TextEncoder();
const one=(tab,rows)=>({name:`가상 원장 - ${tab}.csv`,bytes:enc.encode(csvText(rows))});
const run=async(files,ctx={},overrides={},label='시험 묶음')=>analyze(await readInputFiles(files),ctx,overrides,label);
const reasons=(r,level='error')=>Object.fromEntries(r.summary[level].map(e=>[e.reason,e.count]));
const tab=(r,key)=>r.tabs.find(t=>t.key===key);

test('CSV: quotes, commas, new lines, BOM, CRLF; sheet download names give the tab',()=>{
 assert.deepEqual(parseCSV('﻿a,"b,c","d ""e"""\r\n"줄\n바꿈",,x\r\n'),[['a','b,c','d "e"'],['줄\n바꿈','','x']]);
 assert.equal(tabNameFromFile('가상 원장 - 변화기록.csv'),'변화기록');
 assert.equal(tabNameFromFile('사건.csv'),'사건');
 assert.equal(tabKey(' 조직 연결 '),'org_link');assert.equal(tabKey('검색인덱스'),null);
});

test('fixed ids: prefix + 4~6 digits, short numbers padded, same number in another shape refused; ranges expand',()=>{
 assert.deepEqual(normalizeId('evt-912'),{id:'EVT-0912',prefix:'EVT',padded:true});
 assert.deepEqual(normalizeId('EVT-0912'),{id:'EVT-0912',prefix:'EVT',padded:false});
 assert.equal(normalizeId('EVT-12345').id,'EVT-12345');
 assert.equal(normalizeId('EVT-00912').error,'bad_id');
 assert.equal(normalizeId('사건-1').error,'bad_id');assert.equal(normalizeId('E-1').error,'bad_id');
 assert.deepEqual(expandRefs('SRC-0907~SRC-0909, SRC-0912').ids,['SRC-0907','SRC-0908','SRC-0909','SRC-0912']);
 assert.deepEqual(expandRefs('SRC-0907 ~ 0908').ids,['SRC-0907','SRC-0908']);
 assert.equal(expandRefs('SRC-0909~SRC-0907').bad,true);
 assert.equal(expandRefs('SRC-0907~DEC-0909').bad,true);
 assert.deepEqual(expandRefs('가상 회의자료').ids,[]);
});

test('date precision: day, month (1st), year (Jan 1), range (start<end), unknown keeps the original text',()=>{
 assert.deepEqual(parseLedgerDate('2026-03-15'),{date_start:'2026-03-15',date_end:null,date_precision:'day',date_note:''});
 assert.deepEqual(parseLedgerDate('2026.3.5.'),{date_start:'2026-03-05',date_end:null,date_precision:'day',date_note:''});
 assert.deepEqual(parseLedgerDate('2026년 3월 5일'),{date_start:'2026-03-05',date_end:null,date_precision:'day',date_note:''});
 assert.deepEqual(parseLedgerDate('2026-09'),{date_start:'2026-09-01',date_end:null,date_precision:'month',date_note:'2026-09'});
 assert.deepEqual(parseLedgerDate('2025년'),{date_start:'2025-01-01',date_end:null,date_precision:'year',date_note:'2025년'});
 assert.deepEqual(parseLedgerDate('2021~2025'),{date_start:'2021-01-01',date_end:'2025-12-31',date_precision:'range',date_note:'2021~2025'});
 assert.deepEqual(parseLedgerDate('2026-02~2026-03'),{date_start:'2026-02-01',date_end:'2026-03-31',date_precision:'range',date_note:'2026-02~2026-03'});
 assert.equal(parseLedgerDate('2026-03~2025-01').error,'bad_date');
 assert.deepEqual(parseLedgerDate('가상 협의 이전(정확일 미확인)'),{date_start:null,date_end:null,date_precision:'unknown',date_note:'가상 협의 이전(정확일 미확인)',warning:'date_unknown'});
 assert.equal(parseLedgerDate('2026-02-30').error,'bad_date');assert.equal(parseLedgerDate('2026-13').error,'bad_date');
 assert.deepEqual(parseLedgerDate(''),{date_start:null,date_end:null,date_precision:'unknown',date_note:''});
 assert.equal(parseLedgerDate('45658').date_start,'2025-01-01');
 assert.deepEqual(parseDay('2026-05'),{date:'2026-05-01',warning:'date_month_start'});
 assert.equal(parseDay('곧').error,'bad_date');
});

test('personal data shapes are detected (synthetic numbers)',()=>{
 assert.equal(looksPersonal('연락처 010-0000-0000'),true);
 assert.equal(looksPersonal('900101-1000000'),true);
 assert.equal(looksPersonal('SRC-0901 2026-03-02 3쪽'),false);
});

test('synthetic sheet (CSV): counts per tab add up, S3 excluded, links to excluded rows dropped, skipped tabs listed',async()=>{
 const r=await run(csvFiles());
 assert.equal(r.ok,true,JSON.stringify(r.summary.error));
 for(const t of r.tabs)assert.equal(t.sheetRows,t.importRows+t.excluded+t.rejected,t.key);
 assert.deepEqual([tab(r,'event').sheetRows,tab(r,'event').importRows,tab(r,'event').excluded,tab(r,'event').blankRows],[3,2,1,1]);
 assert.deepEqual(reasons(r,'excluded'),{s3:2,excluded_link:2});
 assert.equal(tab(r,'change').droppedLinks,1);
 assert.deepEqual(tab(r,'change').dropped,['신문반영일']);
 assert.deepEqual(r.skipped,[{name:'검색인덱스',decision:'L2'}]);
 assert.deepEqual(r.counts,{topics:2,organizations:2,sources:2,records:{event:2,change:2,decision:2,evidence:2,commitment:1},record_sources:5,links_to_records:1,links_to_organizations:2,legacy_write_requests:2});
 assert.deepEqual(r.idPrefixes,{topic:'TOP',organization:'ORG',source:'SRC',event:'EVT',change:'CHG',decision:'DEC',evidence:'EVD',commitment:'COM'});
 const p=r.payload;
 assert.equal(p.format,FORMAT);assert.equal(p.kind,'sheet');assert.match(p.sha256,/^[0-9a-f]{64}$/);assert.equal(p.label,'시험 묶음');
 assert.equal(JSON.stringify(p).includes('EVT-0903'),false);assert.equal(JSON.stringify(p).includes('_tab'),false);
 // 근거 출처 칸: 제목으로도 찾고(가상 통화 전사 → SRC-0902), 근거위치를 연결 줄에.
 assert.deepEqual(p.record_sources.filter(x=>x.record.startsWith('EVD')).map(x=>[x.record,x.source,x.locator]),[['EVD-0901','SRC-0901','3쪽'],['EVD-0902','SRC-0902','00:12']]);
 assert.deepEqual(p.links.find(l=>l.relation==='belongs_to'),{record:'CHG-0901',target_record:'EVT-0901',target_organization:null,relation:'belongs_to',note:''});
 const dec=p.records.find(x=>x.ledger_id==='DEC-0901');
 assert.deepEqual([dec.validity,dec.superseded_by,dec.date_precision,dec.decision_type],['superseded','DEC-0902','year','adopted']);
 const com=p.records.find(x=>x.kind==='commitment');
 assert.deepEqual([com.counterparty,com.commitment_status,com.follow_up_on],['나 기관','waiting','2026-05-01']);
 assert.deepEqual(p.legacy_write_requests[0],{legacy_id:'REQ-0901',occurred_at:'2026-03-02T10:30:00+09:00',detail:{status:'반영',date:'2026-03-02 10:30',type:'신규',summary:'가상 요청 하나'}});
 assert.deepEqual(p.report.tabs.event,[3,1,0]);
});

test('xlsx (one file) reads the same tabs and gives the same rows as the CSV set',async()=>{
 const tabs=await readXlsx(xlsxBytes());
 assert.deepEqual(tabs.map(t=>t.name),Object.keys(TABS));
 const a=await run(csvFiles()),b=await run([{name:'가상 원장.xlsx',bytes:xlsxBytes()}]);
 assert.equal(b.ok,true);
 const strip=p=>({...p,sha256:'',source_kind:''});
 assert.deepEqual(strip(b.payload),strip(a.payload));
 assert.notEqual(a.sha256,b.sha256);
});

test('fingerprint: the same files give the same sha256 in any order; a changed file changes it',async()=>{
 const files=csvFiles();
 const x=await readInputFiles(files),y=await readInputFiles([...files].reverse());
 assert.equal(x.sha256,y.sha256);
 const changed=csvFiles({...TABS,결정:[...TABS.결정,['DEC-0903','가상 셋째 방침','채택','','2026-05-01','유효','','']]});
 assert.notEqual((await readInputFiles(changed)).sha256,x.sha256);
});

test('mapping draft: rule guesses, ambiguous values marked, user choice wins and re-checks',async()=>{
 const r=await run(csvFiles());
 const topic=r.mapping.topic.values;
 assert.deepEqual(topic.find(v=>v.raw==='가상 철도'),{raw:'가상 철도',count:1,value:'',guessed:true,ambiguous:true});
 assert.equal(topic.find(v=>v.raw==='가상 교섭 주제').value,'TOP-0902');
 assert.equal(r.mapping.evidence_type.values.find(v=>v.raw==='통계자료').value,'statistics');
 assert.equal(r.mapping.relation.values.find(v=>v.raw==='상대 기관').value,'counterpart');
 assert.equal(r.mapping.event_status.values.find(v=>v.raw==='진행 / Y').value,'tracking');
 const again=await run(csvFiles(),{},{topic:{'가상 철도':'TOP-0901'},evidence_type:{'통계자료':'other'}});
 assert.equal(again.payload.records.find(x=>x.ledger_id==='EVT-0901').topic,'TOP-0901');
 assert.equal(again.payload.records.find(x=>x.ledger_id==='EVD-0901').evidence_type,'other');
 assert.equal(again.mapping.topic.values.find(v=>v.raw==='가상 철도').guessed,false);
 // An S3 choice in the table excludes the row.
 const s3=await run(csvFiles(),{},{sensitivity:{S2:'S3'}});
 assert.equal(s3.payload.records.some(x=>x.ledger_id==='EVT-0902'),false);
 assert.equal(s3.payload.sources.some(x=>x.ledger_id==='SRC-0902'),false);
});

test('broken references reject the whole batch (rows listed); existing ids, duplicates, mixed or foreign prefixes are refused',async()=>{
 const broken=await run([one('변화기록',[['ID','사건ID','제목'],['CHG-0950','EVT-0999','가상 변화']]),one('근거',[['ID','제목','출처'],['EVD-0950','가상 근거','SRC-0999'],['EVD-0951','가상 근거 둘','없는 출처 제목']])]);
 assert.equal(broken.ok,false);
 assert.deepEqual(reasons(broken),{broken_ref:2});
 // 무엇이 없는지 함께 보인다. 출처가 ID가 아닌 글자면 거부하지 않고 비고에 남긴다(알림).
 assert.deepEqual(broken.summary.error[0].samples.sort(),['CHG-0950 → EVT-0999 (없는 ID: EVT-0999)','EVD-0950 → SRC-0999 (없는 ID: SRC-0999)']);
 assert.equal(reasons(broken,'warning').source_text_kept,1);
 // A reference to a row already in the ledger is fine.
 const later=await run([one('변화기록',[['ID','사건ID','제목'],['CHG-0950','EVT-0901','가상 변화']])],{existing:{records:new Set(['EVT-0901'])},prefixes:{event:'EVT'}});
 assert.equal(later.ok,true);assert.equal(later.counts.links_to_records,1);
 const dup=await run([one('사건',[['ID','제목','상태'],['EVT-0901','가상 하나','진행'],['EVT-901','가상 둘','진행'],['EVX-0902','가상 셋','진행']])],{existing:{records:new Set(['EVT-0905'])},prefixes:{event:'EVT'}});
 assert.deepEqual(reasons(dup),{duplicate_id:1,mixed_prefix:1});
 assert.deepEqual(reasons(dup,'warning'),{id_padded:1});
 const exists=await run([one('사건',[['ID','제목','상태'],['EVT-0905','가상 하나','진행']])],{existing:{records:new Set(['EVT-0905'])},prefixes:{event:'EVX'}});
 assert.deepEqual(reasons(exists),{existing_id:1,prefix_conflict:1});
 const shared=await run([one('사건',[['ID','제목','상태'],['ABC-0901','가상 하나','진행']]),one('결정',[['ID','제목'],['ABC-0902','가상 둘']])]);
 assert.deepEqual(reasons(shared),{prefix_shared:1});
});

test('row checks: empty title, missing column, commitment needs counterparty, supersede consistency and cycles, too long, bad dates',async()=>{
 const r=await run([
  one('사건',[['ID','제목','상태','기준일'],['EVT-0901','','진행',''],['EVT-0902','가상','진행','2026-13-01']]),
  one('약속',[['ID','제목','상대측','이행상태','후속확인일'],['COM-0901','가상 약속','','대기',''],['COM-0902','가상 약속 둘','가 기관','대기','언젠가']]),
  one('결정',[['ID','제목','유효상태','대체기록ID'],['DEC-0901','가상 하나','대체',''],['DEC-0902','가상 둘','대체','DEC-0903'],['DEC-0903','가상 셋','대체','DEC-0902'],['DEC-0904','가'.repeat(301),'유효','']]),
  one('조직',[['ID','별칭'],['ORG-0901','가지부']])
 ]);
 assert.deepEqual(reasons(r),{empty_title:1,missing_column:1,missing_counterparty:1,bad_date:1,supersede_mismatch:1,broken_ref:2});
 // 긴 제목은 앞 300자 + 전체는 요지, 읽을 수 없는 후속확인일은 비우고 비고에(둘 다 알림).
 assert.deepEqual(reasons(r,'warning'),{title_cut:1,date_text_kept:1});
 const long=r.payload.records.find(x=>x.ledger_id==='DEC-0904');assert.equal(long.title.length,300);assert.equal(long.summary.length,301);
 assert.match(r.payload.records.find(x=>x.ledger_id==='COM-0902').note,/후속확인일: 언젠가/);
 assert.equal(tab(r,'organization').rejected,1);
 assert.equal(tab(r,'event').importRows,0);
});

test('personal data shape in any cell excludes the row (counted, not stored); links to it are dropped',async()=>{
 const r=await run([one('사건',[['ID','제목','요지','상태'],['EVT-0901','가상 하나','연락 010-0000-0000','진행'],['EVT-0902','가상 둘','','진행']]),one('조직',[['ID','조직명'],['ORG-0901','가 지부']]),one('조직연결',[['기록ID','조직ID','관계유형'],['EVT-0901','ORG-0901','직접'],['EVT-0902','ORG-0901','직접']])]);
 assert.equal(r.ok,true);
 assert.deepEqual(reasons(r,'excluded'),{personal:1,excluded_link:1});
 assert.equal(JSON.stringify(r.payload).includes('010-0000-0000'),false);
 assert.deepEqual([tab(r,'org_link').importRows,tab(r,'org_link').excluded],[1,1]);
});

test('Web2 organisation link: unknown id is dropped with a warning; one Web2 organisation per ledger organisation',async()=>{
 const known='23000000-0000-4000-8000-000000000001';
 const r=await run([one('조직',[['ID','조직명','Web2연결ID'],['ORG-0901','가 지부',known],['ORG-0902','나 지부','없는 값'],['ORG-0903','다 지부',known]])],{suborganizations:new Set([known])});
 assert.deepEqual(reasons(r),{duplicate_web2:1});
 assert.deepEqual(reasons(r,'warning'),{web2_missing:1});
});

test('Claude import file (JSON): same checks; values must already be fixed-list values; candidate files are shape-checked only',async()=>{
 const sheet=await run(csvFiles());
 const file={...sheet.payload,label:'Claude 묶음'};delete file.sha256;delete file.report;
 const r=await run([{name:'원장-가져오기.json',bytes:enc.encode(JSON.stringify(file))}],{},{},'');
 assert.equal(r.ok,true);assert.equal(r.label,'Claude 묶음');assert.equal(r.source_kind,'claude_file');
 assert.deepEqual(r.counts,sheet.counts);
 const bad=JSON.parse(JSON.stringify(file));bad.records[0].importance='높음';bad.records[1].sensitivity='S3';bad.links.push({record:'EVT-0901',target_organization:'ORG-0999',relation:'direct'});
 const rb=await run([{name:'원장.json',bytes:enc.encode(JSON.stringify(bad))}]);
 assert.deepEqual(reasons(rb),{bad_value:1,broken_ref:1});
 assert.equal(reasons(rb,'excluded').s3,1);
 assert.equal((await run([{name:'x.json',bytes:enc.encode('{"format":"other"}')}])).summary.error[0].reason,'bad_file');
 await assert.rejects(readInputFiles([{name:'x.json',bytes:enc.encode('{')}]),/읽을 수 없습니다/);
 const cand=await run([{name:'후보.json',bytes:enc.encode(JSON.stringify({format:FORMAT,version:1,kind:'candidates',candidates:[{kind:'event',title:'가상 후보',sensitivity:'S1'},{kind:'decision',title:'가상 후보 둘',sensitivity:'S3'},{kind:'x'}]}))}]);
 assert.equal(cand.kind,'candidates');assert.equal(cand.ok,false);
 assert.deepEqual(cand.candidates,{total:3,invalid:1,kinds:{event:1,decision:1},excluded:1});
});

test('input rules: xlsx and JSON one at a time, other types refused, label required',async()=>{
 await assert.rejects(readInputFiles([{name:'a.xlsx',bytes:xlsxBytes()},{name:'b.csv',bytes:enc.encode('ID\n')}]),/한 개씩/);
 await assert.rejects(readInputFiles([{name:'a.pdf',bytes:enc.encode('x')}]),/CSV·xlsx/);
 await assert.rejects(readInputFiles([{name:'a.xlsx',bytes:enc.encode('not a zip')}]),/xlsx 파일이 아닙니다/);
 assert.equal((await run(csvFiles(),{},{},'')).ok,false);
});

test('number check: sheet rows = inserted + excluded + rejected per tab',async()=>{
 const r=await run(csvFiles());
 const db={topics:2,organizations:2,sources:2,records_by_kind:{event:2,change:2,decision:2,evidence:2,commitment:1},links_to_organizations:2,legacy_write_requests:2};
 const rows=numberCheck(r.payload.report,db);
 assert.equal(rows.length,10);assert.ok(rows.every(x=>x.ok));
 const short=numberCheck(r.payload.report,{...db,records_by_kind:{...db.records_by_kind,event:1}});
 assert.deepEqual(short.find(x=>x.key==='event'),{key:'event',label:'사건',sheet:3,inserted:1,excluded:1,rejected:0,shift:0,ok:false});
});

test('real sheet headers (synthetic content): no rejection; titles, notes, links, legacy ids and IDX handled',async()=>{
 const {REAL_TABS}=await import('./ledger-import-fixture.mjs');
 const r=await run(csvFiles(REAL_TABS));
 assert.deepEqual(r.summary.error,[]);assert.equal(r.ok,true);
 for(const t of r.tabs)assert.deepEqual(t.missing,[],t.key);
 const p=r.payload,rec=id=>p.records.find(x=>x.ledger_id===id);
 assert.equal(tab(r,'change').importRows,2);assert.equal(tab(r,'decision').importRows,2);assert.equal(tab(r,'commitment').importRows,1);
 assert.equal(tab(r,'write_request').importRows,3);assert.equal(tab(r,'org_link').importRows,5);
 // 변화기록: 제목 = 새로 확인된 것(길면 앞 300자, 전체는 요지), 확인시각의 날짜, 상태 변화·출처유형은 비고, 출처명이 출처 제목이면 연결.
 assert.equal(rec('CHG-0901').title,'가상 노선 1차 협의 결과가 새로 확인됨');
 assert.deepEqual([rec('CHG-0901').date_start,rec('CHG-0901').date_precision,rec('CHG-0901').verification],['2026-09-24','day','verified']);
 assert.match(rec('CHG-0901').note,/상태 변화: 협의 전 → 협의 중/);
 assert.ok(p.record_sources.some(x=>x.record==='CHG-0901'&&x.source==='SRC-0901'));
 assert.equal(rec('CHG-0902').title.length,300);assert.equal(rec('CHG-0902').summary.length,320);
 assert.match(rec('CHG-0902').note,/출처명: 가상 신문 기사/);
 // 결정: 제목 = 결정내용, 결정일, 회의명·결정주체·후속조치·태그는 비고, 출처ID + 근거위치, 관련업무 → 주제 대응표.
 assert.equal(rec('DEC-0901').title,'옛 가상 방침을 채택');assert.equal(rec('DEC-0901').date_start,'2025-03-02');
 assert.match(rec('DEC-0901').note,/회의명: 가상 회의 1차/);assert.equal(rec('DEC-0901').topic,'TOP-0902');
 assert.deepEqual(p.record_sources.filter(x=>x.record==='DEC-0901').map(x=>[x.source,x.locator]),[['SRC-0901','3쪽']]);
 assert.equal(p.record_sources.filter(x=>x.record==='DEC-0902').length,2);
 // 약속: 제목 = 약속내용, 상대측 = 주체, 원문표현 = 요지, 읽을 수 없는 후속확인일은 비고, 대표관련기록 → 관련 연결.
 const com=rec('COM-0901');
 assert.deepEqual([com.title,com.counterparty,com.follow_up_on,com.commitment_status],['가상 자료 제공 약속','나 기관',null,'waiting']);
 assert.match(com.note,/후속확인일: 2026-05 중/);assert.match(com.summary,/자료를 드리겠다/);
 assert.ok(p.links.some(l=>l.record==='COM-0901'&&l.target_record==='EVT-0901'&&l.relation==='related'));
 // 조직연결: 기록ID → 조직ID 방향. 결정·변화기록도 기록. 출처를 가리키는 행은 담을 칸이 없어 빠짐(알림), 한 행의 기록 여러 개는 연결 여러 개.
 const orgLinks=p.links.filter(l=>l.target_organization);
 assert.deepEqual(orgLinks.map(l=>`${l.record}>${l.target_organization}`).sort(),['CHG-0901>ORG-0901','DEC-0901>ORG-0901','DEC-0902>ORG-0901','DEC-0902>ORG-0902','EVT-0901>ORG-0901']);
 assert.equal(reasons(r,'warning').link_kind_unsupported,1);
 assert.match(orgLinks.find(l=>l.record==='EVT-0901').note,/활성여부: Y/);
 assert.equal(tab(r,'org_link').linkShift,0);
 // 쓰기요청: REQ-0901 모양은 legacy_id, 다른 모양은 원래 표기 보관. IDX 참조는 알림만.
 assert.deepEqual(p.legacy_write_requests.map(x=>x.legacy_id),['REQ-0901',null,null]);
 assert.equal(p.legacy_write_requests[1].detail.legacy_id_original,'REQ-20260924042846-COL-1cVke0');
 assert.equal(p.legacy_write_requests[0].occurred_at,'2026-09-24T04:28:00+09:00');
 assert.equal(p.legacy_write_requests[0].detail.results,'IDX-0927~IDX-0929');
 assert.deepEqual(reasons(r,'warning'),{title_cut:1,source_text_kept:1,date_text_kept:1,link_kind_unsupported:1,legacy_id_kept:2,idx_ref_ignored:1});
 // 숫자 확인(조직연결은 한 행 → 여러 연결·빠진 연결을 4번째 값으로 맞춤).
 const db={topics:2,organizations:2,sources:2,records_by_kind:{event:2,change:2,decision:2,evidence:2,commitment:1},links_to_organizations:5,legacy_write_requests:3};
 assert.ok(numberCheck(p.report,db).every(x=>x.ok),JSON.stringify(numberCheck(p.report,db)));
});

test('ids in free text: only UPPER-prefix + hyphen + digits; 출처명 is an id list only when the whole cell is ids; title prefix + bracket tail links',async()=>{
 assert.deepEqual(expandRefs('Web2 가상 담당 현황 - 가 지부').ids,[]);
 assert.deepEqual(expandRefs('COVID19 가상 기사, Web2').ids,[]);
 assert.deepEqual(expandRefs('REQ-20260924042846-COL-1cVke0').ids,[]);
 assert.deepEqual(expandRefs('SRC-0034, EVT-12').ids,['SRC-0034','EVT-0012']);
 const sources=one('출처',[['ID','제목'],['SRC-0934','Web2 가상 담당 현황 - 가 지부(2026-09-22 입력)'],['SRC-0935','가상 겹침 제목 (1차)'],['SRC-0936','가상 겹침 제목 (2차)'],['SRC-0937','가상 정확한 제목']]);
 const events=one('사건',[['ID','제목','상태'],['EVT-0930','가상 사건','진행']]);
 const changes=one('변화기록',[['업데이트ID','사건ID','새로 확인된 것','출처명'],
  ['CHG-0930','EVT-0930','가상 변화 하나','Web2 가상 담당 현황 - 가 지부'],
  ['CHG-0931','EVT-0930','가상 변화 둘','COVID19 가상 기사'],
  ['CHG-0932','EVT-0930','가상 변화 셋','가상 겹침 제목'],
  ['CHG-0933','EVT-0930','가상 변화 넷','가상 정확한 제목'],
  ['CHG-0934','EVT-0930','가상 변화 다섯','SRC-0937']]);
 const r=await run([sources,events,changes]);
 assert.deepEqual(r.summary.error,[]);assert.equal(r.ok,true);
 const rs=id=>r.payload.record_sources.filter(x=>x.record===id).map(x=>x.source);
 assert.deepEqual(rs('CHG-0930'),['SRC-0934']);
 assert.deepEqual(rs('CHG-0931'),[]);assert.match(r.payload.records.find(x=>x.ledger_id==='CHG-0931').note,/출처명: COVID19 가상 기사/);
 assert.deepEqual(rs('CHG-0932'),[]);
 assert.deepEqual(rs('CHG-0933'),['SRC-0937']);assert.deepEqual(rs('CHG-0934'),['SRC-0937']);
 assert.deepEqual(reasons(r,'warning'),{source_title_prefix:1,source_text_kept:2});
});

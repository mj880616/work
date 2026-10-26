// ACT-사진 4단계(결정 A): 자료실 사업 보고 사진 묶음 줄의 규칙 시험. 이름·번호는 모두 합성 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {foldPhotoSets,photoMeetingChunks,isPhotoSet,localDay,PHOTOSET_PREFIX} from '../app/library-photoset.mjs';
import {buildTree,fileKindOf} from '../app/library-tree.js';
import {nodeDocumentIds} from '../app/library-select.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const M1=id(101),M2=id(102),M3=id(103);
const photo=(n,meeting,name='p.jpg',extra={})=>({id:id(n),meeting_id:meeting,file_id:'f'+n,file_name:name,mime_type:'image/jpeg',category:'투쟁',project_id:null,created_at:`2026-10-2${n%9}T01:00:00Z`,...extra});
const meeting=(mid,title,at)=>({id:mid,title,series_name:title,round_no:null,meeting_at:at,activity_kind:'struggle'});
const meetings=()=>new Map([[M1,meeting(M1,'○○ 결의대회','2026-10-24T05:00:00Z')],[M2,meeting(M2,'□□ 교육','2026-10-10T05:00:00Z')],[M3,null]]);

test('사업 보고마다 한 줄: 사진 12장이어도 한 건, 제목은 "사진 n · 사업 보고 제목"', () => {
  const docs=Array.from({length:12},(_, i)=>photo(i+1,M1,`s${i+1}.jpg`));
  const out=foldPhotoSets(docs,meetings());
  assert.equal(out.length,1);
  const set=out[0];
  assert.equal(isPhotoSet(set),true);assert.equal(set.id,PHOTOSET_PREFIX+M1);
  assert.equal(set.title,'사진 12 · ○○ 결의대회');assert.equal(set.count,12);
  assert.equal(set.plan.shown.length,3);assert.equal(set.plan.total,12);
  assert.equal(set.meeting_id,M1);assert.equal(set.category,'투쟁');
  assert.equal(set.document_date,localDay('2026-10-24T05:00:00Z'));
  assert.equal(fileKindOf(set.file_name,set.mime_type),'그림');
  assert.ok(set.tags.includes('s7.jpg')); // 검색은 사진 이름도 본다
});

test('직접 올린 그림·그림 아닌 자료는 묶지 않고 그대로', () => {
  const direct=photo(1,null,'직접.png'),pdf={id:id(2),meeting_id:M1,file_id:'f2',file_name:'결과.pdf',mime_type:'application/pdf'};
  const noFile={...photo(3,M1),file_id:null};
  const out=foldPhotoSets([direct,pdf,noFile,photo(4,M1)],meetings());
  assert.deepEqual(out.filter(d=>!isPhotoSet(d)).map(d=>d.id).sort(),[id(1),id(2),id(3)].sort());
  assert.equal(out.filter(isPhotoSet).length,1);
  assert.equal(out.filter(isPhotoSet)[0].count,1);
});

test('사업 보고가 둘이면 두 줄, 휴지통 사업 보고(null)의 사진은 빠진다', () => {
  const out=foldPhotoSets([photo(1,M1),photo(2,M2),photo(3,M2),photo(4,M3),photo(5,null)],meetings());
  assert.deepEqual(out.filter(isPhotoSet).map(d=>d.count).sort(),[1,2]);
  assert.equal(out.some(d=>d.id===id(4)),false);
  assert.equal(out.some(d=>d.id===id(5)),true);
});

test('읽지 못했거나 묻지 않은 사업 보고는 접지 않는다(자료가 사라져 보이지 않게)', () => {
  const docs=[photo(1,M1),photo(2,M1)];
  assert.deepEqual(foldPhotoSets(docs,null),docs);
  const out=foldPhotoSets(docs,new Map([[M2,meeting(M2,'x','2026-10-10T05:00:00Z')]]));
  assert.deepEqual(out.map(d=>d.id).sort(),[id(1),id(2)].sort());
  assert.deepEqual(foldPhotoSets(undefined,meetings()),[]);
});

test('읽을 사업 보고 번호: 사진이 붙은 것만, 중복 없이, 100개씩', () => {
  assert.deepEqual(photoMeetingChunks([photo(1,M1),photo(2,M1),photo(3,M2),photo(4,null),{...photo(5,M3),file_id:null}]),[[M1,M2]]);
  const many=Array.from({length:230},(_, i)=>photo(i+1,id(1000+i)));
  assert.deepEqual(photoMeetingChunks(many).map(c=>c.length),[100,100,30]);
  assert.deepEqual(photoMeetingChunks([]),[]);
});

test('목록 계산: 묶기 어느 쪽이든 묶음은 1건으로 세고, 고르기 대상이 아니다', () => {
  const docs=foldPhotoSets([photo(1,M1),photo(2,M1),photo(3,M1),{id:id(9),file_id:'f9',file_name:'a.pdf',mime_type:'application/pdf',category:'투쟁',document_date:'2026-10-21'}],meetings());
  const o={docs,categories:['투쟁'],categoryOf:c=>c,kindOf:d=>fileKindOf(d.file_name,d.mime_type),sortKey:d=>String(d.document_date||d.created_at||'').slice(0,10),monthLabel:k=>k};
  for(const groupBy of ['category','month','folder']){
    const tree=buildTree({...o,groupBy});
    const total=tree.reduce((n,x)=>n+x.count,0);
    assert.equal(total,2,groupBy); // 사진 3장 → 1건 + 문서 1건
  }
  const tree=buildTree({...o,groupBy:'category'});
  assert.deepEqual(nodeDocumentIds(tree[0]),[id(9)]);
});

test('구조: 읽기 전용 — 사업 보고 표는 읽기만, 저장소·새 서버 경로 없음', () => {
  const src=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(src,/function luLoadPhotoMeetings/);
  assert.match(src,/\/rest\/v1\/app_meetings\?workspace_id=/);
  assert.doesNotMatch(readFileSync(new URL('../app/library-photoset.mjs',import.meta.url),'utf8'),/\b(?:local|session)Storage\b|fetch\(/);
  const css=readFileSync(new URL('../app/ui-standard.css',import.meta.url),'utf8');
  assert.match(css,/\.report-photo-strip\{/);
  for(const f of ['workplace-detail.css','project-system-v3.css']){
    const c=readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
    assert.doesNotMatch(c,/^\.report-photo-(thumb|more)/m,f+' 에 같은 스타일을 다시 두지 않는다');
  }
});

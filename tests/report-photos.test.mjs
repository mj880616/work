// ACT-사진 5단계: 사업 보고 줄 작은 그림(3장 + 외 n장)의 규칙 시험. 이름·번호는 모두 합성 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reportIdChunks,groupReportPhotos,stripPlan,moreLabel,STRIP_LIMIT} from '../app/report-photos-model.mjs';
import {readReportPhotos,reportPhotosHtml} from '../app/report-photos.js';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const doc=(n,meeting,name,mime,at)=>({id:id(n),meeting_id:meeting,file_name:name,mime_type:mime,created_at:at||`2026-10-2${n%9}T01:00:00Z`});

test('번호 묶음: 중복·잘못된 번호는 빼고 100건씩', () => {
  assert.deepEqual(reportIdChunks([{id:id(1)},{id:id(1)},{id:'x'},null,{id:id(2)}]),[[id(1),id(2)]]);
  const many=Array.from({length:250},(_, i)=>({id:id(i+1)}));
  assert.deepEqual(reportIdChunks(many).map(c=>c.length),[100,100,50]);
  assert.deepEqual(reportIdChunks([]),[]);
  assert.deepEqual(reportIdChunks(undefined),[]);
});

test('자료 → 사업 보고별 그림: 그림만, 올린 순서, 자료실 그림 판단과 같음', () => {
  const m=groupReportPhotos([
    doc(3,'m1','b.png','image/png','2026-10-02T00:00:00Z'),
    doc(1,'m1','a.JPG','','2026-10-01T00:00:00Z'),
    doc(2,'m1','결과.hwpx','application/x-hwpx'),
    doc(4,'m2','폰사진.heic',''),
    doc(5,'m2','noext','image/webp'),
    {id:id(6),meeting_id:null,file_name:'c.png',mime_type:'image/png'},
    {id:id(7),meeting_id:'m3',file_name:'보고서.pdf',mime_type:'application/pdf'}
  ]);
  assert.deepEqual(m.get('m1').map(p=>p.id),[id(1),id(3)]);
  assert.deepEqual(m.get('m2').map(p=>p.id),[id(4),id(5)]);
  assert.equal(m.has('m3'),false);
  assert.equal(m.size,2);
  assert.equal(groupReportPhotos(null).size,0);
});

test('한 줄 계획: 3장 + 외 n장, 그림이 없으면 null', () => {
  const list=n=>Array.from({length:n},(_, i)=>({id:id(i+1)}));
  assert.equal(STRIP_LIMIT,3);
  assert.equal(stripPlan([]),null);assert.equal(stripPlan(undefined),null);
  let p=stripPlan(list(1));assert.equal(p.shown.length,1);assert.equal(p.more,0);assert.equal(moreLabel(p),'');
  p=stripPlan(list(3));assert.equal(p.shown.length,3);assert.equal(moreLabel(p),'');
  p=stripPlan(list(6));assert.deepEqual(p.shown.map(x=>x.id),[id(1),id(2),id(3)]);assert.equal(p.more,3);assert.equal(moreLabel(p),'외 3장');assert.equal(p.total,6);
  assert.equal(moreLabel(null),'');
});

test('줄 글: 그림이 있는 줄만 칸이 생기고 번호는 이스케이프된다', () => {
  const photos=groupReportPhotos([1,2,3,4,5].map(n=>doc(n,'m1','p'+n+'.jpg','image/jpeg')));
  const html=reportPhotosHtml('m1',photos);
  assert.equal((html.match(/data-report-photo="/g)||[]).length,3);
  assert.match(html,/외 2장/);assert.match(html,/aria-label="사진 5장"/);
  assert.equal(reportPhotosHtml('m-none',photos),'');
  assert.equal(reportPhotosHtml('m1',new Map()),'');
  assert.equal(reportPhotosHtml('"><b>',new Map([['"><b>',[{id:id(1)}]]])).includes('"><b>'),false);
  assert.doesNotMatch(reportPhotosHtml('m1',groupReportPhotos([doc(1,'m1','a.png','image/png')])),/외/);
});

test('읽기: 줄마다 따로 묻지 않고 한 번에(N+1 없음), 100건 넘으면 묶음 수만큼', async () => {
  const calls=[];
  const rt={context:{read:()=>({workspace:{id:'w1'}})},api:async path=>{calls.push(path);return [doc(1,id(1),'a.jpg','image/jpeg')]}};
  const reports=Array.from({length:8},(_, i)=>({id:id(i+1)}));
  const map=await readReportPhotos(reports,rt);
  assert.equal(calls.length,1);
  assert.match(calls[0],/^\/rest\/v1\/app_documents\?workspace_id=eq\.w1&meeting_id=in\.\(/);
  assert.equal(calls[0].split('meeting_id=in.(')[1].split(')')[0].split(',').length,8);
  assert.match(calls[0],/select=id,meeting_id,file_name,mime_type,created_at/);
  assert.equal(map.get(id(1)).length,1);
  calls.length=0;
  await readReportPhotos(Array.from({length:101},(_, i)=>({id:id(i+1)})),rt);
  assert.equal(calls.length,2);
  calls.length=0;
  assert.equal((await readReportPhotos([],rt)).size,0);assert.equal(calls.length,0);
  await assert.rejects(readReportPhotos(reports,{context:{read:()=>null},api:async()=>[]}));
});

test('구조: 읽기 전용 — 저장·쓰기 요청과 새 서버 경로가 없다', () => {
  const src=readFileSync(new URL('../app/report-photos.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/method:\s*['"](POST|PATCH|PUT|DELETE)/i);
  assert.match(src,/library-files\?\$\{query\}/);assert.match(src,/action:'photo',document_id:documentId,size:'small'/);
  assert.doesNotMatch(src,/\b(?:local|session)Storage\b|\bindexed[D]B\b/);
});

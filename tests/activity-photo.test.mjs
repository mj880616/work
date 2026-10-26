// ACT-사진 3단계: 사업 보고 사진 줄의 규칙 시험(순수 함수). 이름·번호는 모두 합성 값.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {categoryForReportKind,isPhotoFile,splitPhotoFiles,splitPhotoDocs,photoUploadFields,photosToFollow,photoTitle,REPORT_KIND_CATEGORY} from '../app/activity-photo-model.mjs';
import {normalizeUploadMeeting} from '../app/library-upload-meeting.mjs';
import {REPORT_KINDS} from '../app/report-kinds.mjs';
import {DEFAULT_DOCUMENT_CATEGORIES} from '../app/document-categories.js';

const doc=(id,name,mime,extra={})=>({id,file_id:'f'+id,file_name:name,mime_type:mime,category:'회의자료',...extra});

test('칸 → 자료실 종류: 8개 칸 모두 기본 종류 목록 안의 이름으로 간다', () => {
  for(const k of REPORT_KINDS)assert.ok(DEFAULT_DOCUMENT_CATEGORIES.includes(categoryForReportKind(k.value,DEFAULT_DOCUMENT_CATEGORIES)),k.value);
  assert.equal(categoryForReportKind('struggle',DEFAULT_DOCUMENT_CATEGORIES),'투쟁');
  assert.equal(categoryForReportKind('meeting',DEFAULT_DOCUMENT_CATEGORIES),'회의');
  assert.equal(categoryForReportKind('negotiation',DEFAULT_DOCUMENT_CATEGORIES),'교섭');
  assert.equal(categoryForReportKind('assembly',DEFAULT_DOCUMENT_CATEGORIES),'정책');
  assert.equal(categoryForReportKind('press',DEFAULT_DOCUMENT_CATEGORIES),'선전');
});
test('칸 → 자료실 종류: 내 목록의 새 이름을 우선하고, 목록에 없으면 기타', () => {
  const mine=['교섭·합의','성명·보도자료','투쟁','기타'];
  assert.equal(categoryForReportKind('negotiation',mine),'교섭·합의');
  assert.equal(categoryForReportKind('press',mine),'성명·보도자료');
  assert.equal(categoryForReportKind('education',mine),'기타');
  assert.equal(categoryForReportKind('nope',mine),'기타');
  assert.equal(categoryForReportKind('struggle',undefined),'기타');
  assert.deepEqual(Object.keys(REPORT_KIND_CATEGORY).sort(),REPORT_KINDS.map(k=>k.value).sort());
});
test('사진 판단은 자료실 그림 판단 하나: 파일·자료 모두 같은 결과', () => {
  assert.equal(isPhotoFile({name:'a.JPG',type:''}),true);
  assert.equal(isPhotoFile({name:'폰.heic',type:''}),true);
  assert.equal(isPhotoFile({name:'noext',type:'image/webp'}),true);
  assert.equal(isPhotoFile({name:'결과.hwpx',type:'application/x-hwpx'}),false);
  assert.equal(isPhotoFile(null),false);
  const {photos,others}=splitPhotoFiles([{name:'a.png',type:'image/png'},{name:'b.pdf',type:'application/pdf'},{name:'c.gif',type:''}]);
  assert.deepEqual(photos.map(f=>f.name),['a.png','c.gif']);assert.deepEqual(others.map(f=>f.name),['b.pdf']);
  const s=splitPhotoDocs([doc('1','a.png','image/png'),doc('2','b.pdf','application/pdf'),{id:'3',file_name:'c.png',mime_type:'image/png'},doc('4','d.JPEG','')]);
  assert.deepEqual(s.photos.map(d=>d.id),['1','4']);assert.deepEqual(s.files.map(d=>d.id),['2','3']);
  assert.deepEqual(splitPhotoDocs(null),{photos:[],files:[]});
});
test('올릴 때 서버에 싣는 값: 제목은 파일 이름, 종류는 칸, 날짜는 사업 보고 날짜', () => {
  assert.equal(photoTitle('결의대회 01.jpg'),'결의대회 01');assert.equal(photoTitle('noext'),'noext');
  assert.deepEqual(photoUploadFields({name:'a.b.jpg'},{kind:'struggle',day:'2026-10-24'},DEFAULT_DOCUMENT_CATEGORIES),{title:'a.b',category:'투쟁',document_date:'2026-10-24'});
  assert.deepEqual(photoUploadFields({name:'a.jpg'},{kind:'meeting',day:'x'},DEFAULT_DOCUMENT_CATEGORIES),{title:'a',category:'회의'});
});
test('칸을 바꾸면: 옛 칸이 정해 준 종류 그대로인 사진만 따라간다', () => {
  const docs=[doc('1','a.png','image/png',{category:'투쟁'}),doc('2','b.png','image/png',{category:'교육'}),doc('3','c.pdf','application/pdf',{category:'투쟁'}),doc('4','d.png','image/png',{category:'투쟁'})];
  assert.deepEqual(photosToFollow(docs,'struggle','meeting',DEFAULT_DOCUMENT_CATEGORIES),{ids:['1','4'],category:'회의'});
  assert.deepEqual(photosToFollow(docs,'policy','assembly',DEFAULT_DOCUMENT_CATEGORIES).ids,[]); // 같은 종류(정책)면 바꿀 것 없음
  assert.deepEqual(photosToFollow(null,'meeting','struggle',DEFAULT_DOCUMENT_CATEGORIES).ids,[]);
});
test('올리기 대상: 칸·날짜가 정상 값일 때만 이어진다', () => {
  assert.deepEqual(normalizeUploadMeeting({id:' m1 ',project_id:'p',kind:'struggle',day:'2026-10-24'}),{id:'m1',name:'',projectId:'p',kind:'struggle',day:'2026-10-24'});
  assert.deepEqual(normalizeUploadMeeting({id:'m1',day:'내일'}),{id:'m1',name:'',projectId:''});
  assert.equal(normalizeUploadMeeting({}),null);
});
test('원본 규칙: 사진을 브라우저에서 줄이거나 로컬에 저장하지 않는다(소스 점검)', () => {
  for(const f of ['report-photo-row.js','activity-photo-model.mjs'])
    assert.doesNotMatch(readFileSync(new URL('../app/'+f,import.meta.url),'utf8'),/localStorage|sessionStorage|indexedDB|canvas|toBlob|drawImage/i,f);
  const up=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(up,/if\(!photo\)luAiFill\(/); // 사진은 AI 채우기를 건너뛴다
});

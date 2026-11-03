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
test('원본 규칙: 사진을 브라우저에서 줄이거나 기기에 저장하지 않는다(소스 점검)', () => {
  const banned = [['local','Storage'], ['session','Storage'], ['indexed','DB'], ['can','vas'], ['to','Blob'], ['draw','Image']].map(parts => parts.join(''));
  for(const f of ['report-photo-row.js','activity-photo-model.mjs']){
    const text = readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
    for(const word of banned)assert.equal(text.toLowerCase().includes(word.toLowerCase()),false,f+' '+word);
  }
  const up=readFileSync(new URL('../app/library-upload.js',import.meta.url),'utf8');
  assert.match(up,/if\(!photo\)luAiFill\(/); // 사진은 AI 채우기를 건너뛴다
});

// S46-20 사진 정리 ⑥: 업무 사진 붙이기(그 시각 사진)·일기 그날 폰 사진의 순수 규칙.
import {reportAtMs,nearPhotos,phoneDayItems,windowMonths,nearWindow,dayEndMs,attachName,odMonthItems,NEAR_MS} from '../app/time-photos-model.mjs';
const ph=(id,taken,extra={})=>({kind:'phone',source:'phone',key:'ms:'+id,id:'ph:'+id,phoneId:String(id),day:taken.slice(0,10),name:`IMG_${id}.jpg`,taken_at:taken,approx:false,video:false,size_bytes:100+id,...extra});
const odi=(id,taken,name=`od_${id}.jpg`)=>({kind:'od',source:'onedrive',key:id,id,day:taken.slice(0,10),name,taken_at:taken,approx:false,video:false,size_bytes:null});

test('그 시각: 쓰기 창 값(서울)과 저장된 값(ISO)이 같은 시각, 못 읽으면 NaN', () => {
  assert.equal(reportAtMs('2026-10-24T14:00'),Date.parse('2026-10-24T05:00:00Z'));
  assert.equal(reportAtMs('2026-10-24T05:00:00+00:00'),Date.parse('2026-10-24T05:00:00Z'));
  assert.ok(Number.isNaN(reportAtMs('')));assert.ok(Number.isNaN(reportAtMs('2026-10-24')));
  // 서울 자정 근처 창은 두 달에 걸친다.
  assert.deepEqual(windowMonths(nearWindow(reportAtMs('2026-11-01T01:00'))),['2026-10','2026-11']);
  assert.deepEqual(windowMonths(nearWindow(reportAtMs('2026-11-15T12:00'))),['2026-11']);
  assert.equal(dayEndMs('2026-10-24'),Date.parse('2026-10-24T15:00:00Z'));
});

test('그 시각 사진: 앞뒤 3시간 안 폰·원드라이브, 동영상 빼고, 같은 사진은 폰 것 한 장, 찍은 순', () => {
  const at=reportAtMs('2026-10-24T14:00');
  const phone=[ph(1,'2026-10-24T05:30:00.000Z'),ph(2,'2026-10-24T03:00:00.000Z'),ph(3,'2026-10-24T09:00:00.000Z'),ph(4,'2026-10-24T05:10:00.000Z',{video:true})];
  const od=[odi('A','2026-10-24T04:00:00.000Z'),odi('B','2026-10-24T05:30:01.000Z','img_1.JPG'),odi('C','2026-10-23T05:00:00.000Z')];
  assert.deepEqual(nearPhotos({phone,od,atMs:at}).map(x=>x.id),['ph:2','A','ph:1']);
  assert.deepEqual(nearPhotos({phone,od,atMs:NaN}),[]);
  // 많으면 보고 시각에 가까운 것부터 max장.
  const many=Array.from({length:10},(_,i)=>ph(10+i,new Date(at-NEAR_MS+i*60e3*30).toISOString()));
  assert.deepEqual(nearPhotos({phone:many,od:[],atMs:at,max:2}).map(x=>x.id),['ph:15','ph:16']);
});

test('일기 그날 폰 사진: 그날 것만, 동영상 빼고, 원드라이브에 같은 사진이면 뺀다', () => {
  const phone=[ph(1,'2026-10-24T05:00:00.000Z'),ph(2,'2026-10-24T01:00:00.000Z'),ph(3,'2026-10-23T05:00:00.000Z'),ph(4,'2026-10-24T02:00:00.000Z',{video:true})];
  assert.deepEqual(phoneDayItems(phone,'2026-10-24',[{id:'X',name:'IMG_1.jpg',taken_at:'2026-10-24T05:00:01.000Z'}]).map(x=>x.id),['ph:2']);
  assert.deepEqual(phoneDayItems(phone,'2026-10-24').map(x=>x.id),['ph:2','ph:1']);
  assert.deepEqual(odMonthItems({days:{'2026-10-24':[{id:'A',name:'a.jpg',taken_at:'2026-10-24T01:00:00Z'}],'2026-10-25':'x'}}).map(x=>[x.id,x.day,x.kind]),[['A','2026-10-24','od']]);
});

test('붙일 파일 이름: 확장자 없으면 형식대로, 나쁜 글자 빼기', () => {
  assert.equal(attachName('IMG_1.jpg','image/jpeg'),'IMG_1.jpg');
  assert.equal(attachName('IMG_1','image/png'),'IMG_1.png');
  assert.equal(attachName('a/b:c','image/webp'),'abc.webp');
  assert.equal(attachName('','image/jpeg'),'사진.jpg');
});

test('그 시각 사진 줄: 고른 사진만 기존 첨부 길로, 서버에 직접 쓰지 않음', () => {
  const src=readFileSync(new URL('../app/time-photos.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/rest\/v1|functions\/v1/); // 서버에 직접 쓰지 않는다(올리기는 부르는 쪽의 기존 길)
  const team=readFileSync(new URL('../app/team.js',import.meta.url),'utf8'),mrd=readFileSync(new URL('../app/meeting-round-detail.js',import.meta.url),'utf8');
  assert.match(team,/onPick:files=>addMeetingFiles\(files\)/);
  assert.match(mrd,/onPick:files=>mrdAddPhotos\(files\)/);
  const diary=readFileSync(new URL('../app/diary.js',import.meta.url),'utf8');
  assert.doesNotMatch(diary.slice(diary.indexOf('let phoneDay'),diary.indexOf('const phoneShown')),/uploadDiaryPhotos|rt\.api|addStar/);
});

// S48-58 사진 정리 ⑥ 남은 일: '그날·그 장소에서 찍은' 사진도 추천(위치는 원드라이브 색인에서만, 지도 서비스 없음).
import {suggestPhotos,placeAnchor,lendPlaces,distanceM,suggestRange,placeOf,nearHead,PLACE_M} from '../app/time-photos-model.mjs';
const HALL={lat:37.52971,lon:126.96499},FAR={lat:37.5665,lon:126.9780}; // 약 4km 떨어진 두 곳(가짜)
const at2=reportAtMs('2026-11-03T14:00');
const t=h=>new Date(at2+h*3600e3).toISOString();

test('그 장소: 거리·기준점·짝 위치 빌리기·범위', () => {
  assert.ok(distanceM(HALL,FAR)>3000&&distanceM(HALL,FAR)<6000);
  assert.ok(distanceM(HALL,{lat:HALL.lat+0.001,lon:HALL.lon})<PLACE_M);
  // 기준점: 앞뒤 3시간 안 위치 있는 사진들의 가운데 값(한 장이 멀어도 흔들리지 않음), 3시간 밖·추정 시각은 빼고, 없으면 null.
  const a=placeAnchor([odi('A',t(0.2)),{...odi('B',t(-0.5)),...HALL},{...odi('C',t(1)),...HALL},{...odi('D',t(2)),...FAR},{...odi('E',t(-5)),...FAR},{...odi('F',t(0.1)),...FAR,approx:true}],at2);
  assert.deepEqual(a,HALL);
  assert.equal(placeAnchor([odi('A',t(0))],at2),null);
  assert.equal(placeAnchor([{...odi('A',t(0)),...HALL}],NaN),null);
  // 폰 사진은 원드라이브 짝(같은 사진)의 위치를 빌린다. 짝이 없으면 그대로.
  const lent=lendPlaces([ph(1,t(0)),ph(2,t(1))],[{...odi('X',new Date(Date.parse(t(0))+1000).toISOString(),'img_1.jpg'),...HALL}]);
  assert.deepEqual([lent[0].lat,lent[0].lon,'lat' in lent[1]],[HALL.lat,HALL.lon,false]);
  // 범위 = 앞뒤 3시간 + 그 서울 날 하루.
  const r=suggestRange(at2);
  assert.equal(r.from,Date.parse('2026-11-02T15:00:00Z'));assert.equal(r.to,Date.parse('2026-11-03T15:00:00Z')-1);
  const late=suggestRange(reportAtMs('2026-11-03T23:00'));assert.equal(late.to,reportAtMs('2026-11-04T02:00'));
  assert.deepEqual(placeOf({lat:1,lon:2}),{lat:1,lon:2});assert.deepEqual(placeOf({lat:'1',lon:2}),{});assert.deepEqual(placeOf({lat:95,lon:2}),{});
  // 원드라이브 달 목록의 위치가 칸까지 그대로 온다.
  assert.deepEqual(odMonthItems({days:{'2026-11-03':[{id:'A',name:'a.jpg',taken_at:t(0),...HALL}]}}).map(x=>[x.lat,x.lon]),[[HALL.lat,HALL.lon]]);
});

test('그 장소 사진: 그날 기준점 근처면 3시간 밖이어도 더하고 📍, 다른 날·먼 곳·추정 시각은 빼기', () => {
  const od=[
    {...odi('N1',t(0.5)),...HALL},            // 3시간 안·그 장소 → here
    {...odi('N2',t(-1)),...FAR},              // 3시간 안·다른 곳 → 들어오되 here 없음
    odi('N3',t(1)),                           // 3시간 안·위치 없음
    {...odi('P1',t(-4.5)),...HALL},           // 3시간 밖·그날·그 장소(09:30) → here
    {...odi('P2',t(5)),...HALL,approx:true},  // 추정 시각 → 빼기
    {...odi('P3',t(4.5)),...FAR},             // 3시간 밖·다른 곳 → 빼기
    {...odi('P4',t(-24)),...HALL},            // 전날 그 장소 → 빼기
  ];
  const phone=[ph(7,t(-5),{name:'IMG_7.jpg'})]; // 폰 사진: 짝 위치를 빌려 그 장소 → here
  od.push({...odi('T7',new Date(Date.parse(t(-5))+500).toISOString(),'img_7.JPG'),...HALL});
  const got=suggestPhotos({phone,od,atMs:at2});
  assert.deepEqual(got.items.map(x=>[x.id,x.here===true]),[['ph:7',true],['P1',true],['N2',false],['N1',true],['N3',false]]);
  assert.equal(got.here,3);assert.deepEqual(got.anchor,HALL);
  // 기준점이 없으면 지금처럼 시각만(nearPhotos와 같은 결과).
  const plain=od.map(({lat,lon,...x})=>x);
  assert.deepEqual(suggestPhotos({phone:[],od:plain,atMs:at2}).items.map(x=>x.id),nearPhotos({phone:[],od:plain,atMs:at2}).map(x=>x.id));
  // 많으면 그 장소 사진을 먼저 남긴다.
  const capped=suggestPhotos({phone:[],od,atMs:at2,max:2});
  assert.deepEqual(capped.items.map(x=>x.id),['P1','N1']);
  assert.deepEqual(suggestPhotos({phone,od,atMs:NaN}),{items:[],here:0,anchor:null});
  assert.equal(nearHead(5,3),'그 시각 사진 5장 · 📍그 장소 3장');assert.equal(nearHead(2),'그 시각 사진 2장');
});

test('그 장소: 지도 서비스·새 외부 주소 없음', () => {
  for(const f of ['time-photos.js','time-photos-model.mjs']){
    const src=readFileSync(new URL('../app/'+f,import.meta.url),'utf8');
    assert.doesNotMatch(src,/https?:\/\/|geocod|kakao|naver|maps\./i,f); // 기기 저장 금지는 CI 저장 감사(audit)가 본다
  }
  const ui=readFileSync(new URL('../app/time-photos.js',import.meta.url),'utf8');
  assert.match(ui,/suggestPhotos\(\{phone:ph, od, atMs\}\)/);
  assert.match(ui,/tp-here/);
});

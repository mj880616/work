import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseDate,parseRound,parseKey,roleOf,splitPasted,firstLineKey,mergeKey,matchKind,kindKey,kindCandidates,groupItems,findExisting,appendResult,isHeaderLine,linesFromGlyphs} from '../app/meeting-file-parse.mjs';

test('날짜: YYMMDD·YYYYMMDD·YYYY.MM.DD·YYYY-MM-DD·년월일·YY.MM.DD, 없는 날짜는 버림',()=>{
  assert.equal(parseDate('251015 중집 결과').date,'2025-10-15');
  assert.equal(parseDate('20251015_중집').date,'2025-10-15');
  assert.equal(parseDate('2025.10.15 중집').date,'2025-10-15');
  assert.equal(parseDate('2025. 1. 5. 운영위').date,'2025-01-05');
  assert.equal(parseDate('2025-03-07').date,'2025-03-07');
  assert.equal(parseDate('2025년 3월 7일(금)').date,'2025-03-07');
  assert.equal(parseDate('25.10.15 운영위').date,'2025-10-15');
  assert.equal(parseDate('251345 회의').date,'');
  assert.equal(parseDate('2025.02.30').date,'');
  assert.equal(parseDate('중집 결과').date,'');
});

test('차수: N차·제N차, 없으면 null',()=>{
  assert.equal(parseRound('제12차 중앙집행위원회').round,12);
  assert.equal(parseRound('5차 운영위').round,5);
  assert.equal(parseRound('운영위').round,null);
});

test('파일 이름에서 날짜·차수·회의명을 읽고 결과·자료 낱말과 확장자는 이름에서 뺀다',()=>{
  assert.deepEqual(parseKey('251015 제5차 중앙집행위원회 회의결과.pdf'),{date:'2025-10-15',round:5,name:'중앙집행위원회',time:''});
  assert.deepEqual(parseKey('[본부] 2025.10.15 운영위원회 자료(안건).hwp'),{date:'2025-10-15',round:null,name:'본부 운영위원회',time:''});
  assert.deepEqual(parseKey('제12차 중집 회의록_최종.hwpx'),{date:'',round:12,name:'중집',time:''});
  assert.equal(parseKey('2025년 3월 7일 14:00 노조 중집 결과').time,'14:00');
});

test('결과/자료 구분: 결과·회의록=결과, 자료·안건=자료, 회의자료는 자료, 둘 다 없으면 고르기',()=>{
  assert.equal(roleOf('251015 중집 회의결과.pdf'),'result');
  assert.equal(roleOf('251015 중집 결과보고.hwp'),'result');
  assert.equal(roleOf('제5차 중집 회의록.hwp'),'result');
  assert.equal(roleOf('제5차 중집 회의자료.hwp'),'material');
  assert.equal(roleOf('제5차 중집 안건.pdf'),'material');
  assert.equal(roleOf('제5차 중집 붙임1.pdf'),'material');
  assert.equal(roleOf('제5차 중집.pdf'),'');
});

test('붙여 넣은 글은 회의 제목 줄마다 나누고, 목록 줄·긴 줄은 제목으로 보지 않는다',()=>{
  const text='제5차 중앙집행위원회 결과 (2025.10.15)\n1. 안건 승인\n- 운영위원회 보고\n\n제6차 중앙집행위원회 결과 (2025.11.12)\n1. 예산 승인';
  const parts=splitPasted(text);
  assert.equal(parts.length,2);
  assert.deepEqual(parts.map(p=>[p.key.round,p.key.date,p.key.name]),[[5,'2025-10-15','중앙집행위원회'],[6,'2025-11-12','중앙집행위원회']]);
  assert.match(parts[0].text,/^제5차[\s\S]*운영위원회 보고$/);
  assert.equal(isHeaderLine('- 제5차 운영위원회 보고'),false);
  assert.equal(isHeaderLine('운영위원회'),false);
  const one=splitPasted('결정 사항\n- 승인');
  assert.equal(one.length,1);assert.equal(one[0].text,'결정 사항\n- 승인');assert.equal(one[0].key.name,'');
  assert.deepEqual(splitPasted('  \n '),[]);
});

test('제목 줄 앞의 머리말은 첫 회의에 붙는다',()=>{
  const parts=splitPasted('공유드립니다\n제5차 중집 결과 2025.10.15\n- 승인');
  assert.equal(parts.length,1);assert.equal(parts[0].key.round,5);assert.match(parts[0].text,/^공유드립니다/);
});

test('본문 앞줄에서 회의명·날짜·차수를 찾고, 파일 이름 정보가 우선한다',()=>{
  const key=firstLineKey('전국공공운수노조\n제7차 본부 운영위원회 회의결과\n일시: 2025년 9월 3일(수) 15:00\n장소: 본부 회의실');
  assert.equal(key.round,7);assert.equal(key.date,'2025-09-03');assert.equal(key.name,'본부 운영위원회');assert.equal(key.time,'15:00');
  assert.deepEqual(mergeKey({date:'2025-09-04',round:null,name:'',time:''},key),{date:'2025-09-04',round:7,name:'본부 운영위원회',time:'15:00'});
});

test('기존 회의 종류 찾기: 띄어쓰기 무시·포함 관계',()=>{
  const kinds=['노조 중앙집행위원회','본부 운영위원회'];
  assert.equal(matchKind('노조중앙집행위원회',kinds),'노조 중앙집행위원회');
  assert.equal(matchKind('운영위원회',kinds),'본부 운영위원회');
  assert.equal(matchKind('대의원대회',kinds),'');
});

const item=(id,role,key,text='')=>({id,role,text,key:{date:'',round:null,name:'',time:'',...key}});
test('묶기: 같은 이름·차수끼리, 날짜만 있는 자료는 그 날짜의 차수 묶음에 짝',()=>{
  const groups=groupItems([
    item('a','material',{name:'중집',round:5}),
    item('b','result',{name:'중집',round:5,date:'2025-10-15'}),
    item('c','material',{name:'중집',date:'2025-10-15'}),
    item('d','result',{name:'중집',round:6,date:'2025-11-12'}),
  ]);
  assert.equal(groups.length,2);
  assert.deepEqual(groups[0].ids.sort(),['a','b','c']);
  assert.equal(groups[0].date,'2025-10-15');assert.equal(groups[0].round,5);
  assert.equal(groups[0].results.length,1);assert.equal(groups[0].materials.length,2);
  assert.deepEqual(groups[1].ids,['d']);
});

test('묶기: 정보가 모자란 것은 맞는 묶음이 하나면 거기에, 아니면 따로(직접 고르기)',()=>{
  const one=groupItems([item('a','result',{name:'중집',round:5}),item('t','result',{})]);
  assert.equal(one.length,1);assert.deepEqual(one[0].ids,['a','t']);
  const two=groupItems([item('a','result',{name:'중집',round:5}),item('b','result',{name:'중집',round:6}),item('t','material',{})]);
  assert.equal(two.length,3);assert.equal(two[2].key,'?t');assert.equal(two[2].name,'');
  const none=groupItems([item('x','result',{}),item('y','material',{})]);
  assert.equal(none.length,1);assert.deepEqual(none[0].ids,['x','y']);
  const byRound=groupItems([item('a','result',{name:'중집',round:5}),item('b','result',{name:'중집',round:6}),item('m','material',{round:6})]);
  assert.deepEqual(byRound[1].ids,['b','m']);
});

test('묶기: 직접 고른 값(override)이 읽은 값보다 우선',()=>{
  const it=item('t','result',{});it.override={name:'중집',round:6};
  const groups=groupItems([item('a','result',{name:'중집',round:5}),item('b','result',{name:'중집',round:6}),it]);
  assert.equal(groups.length,2);assert.deepEqual(groups[1].ids,['b','t']);
});

test('기존 회의 찾기: 같은 종류·차수, 차수가 없으면 같은 날짜',()=>{
  const meetings=[{id:'m5',series_name:'노조 중집',round_no:5,meeting_at:'2025-10-15T05:00:00Z'},{id:'m0',series_name:'운영위',round_no:null,meeting_at:'2025-09-03T06:00:00Z'}];
  const dateOf=v=>new Date(new Date(v).getTime()+9*3600000).toISOString().slice(0,10);
  assert.equal(findExisting({name:'노조중집',round:5},meetings,dateOf)?.id,'m5');
  assert.equal(findExisting({name:'노조 중집',round:6},meetings,dateOf),null);
  assert.equal(findExisting({name:'운영위',round:null,date:'2025-09-03'},meetings,dateOf)?.id,'m0');
  assert.equal(findExisting({name:'',round:5},meetings,dateOf),null);
});

test('HWP 글자 조각을 줄 글로: 같은 높이는 한 줄, 벌어진 사이는 빈칸',()=>{
  const g=(s,x,y,w)=>({s,x,y,size:13.33,w});
  const text=linesFromGlyphs([g('편',150,143.6),g('H',113.39,143.6,9.79),g('W',123.17,143.6,12.13),g('P',135.31,143.6,8.03),g('집',162.93,143.6),g('기',175.87,143.6),g('시',195.47,143.6),g('험',208.4,143.6),g('둘',113,170),g('째',126,170)]);
  assert.equal(text,'HWP 편집기 시험\n둘째');
  assert.equal(linesFromGlyphs([]),'');
});

test('결과 더하기: 빈 칸이면 그대로, 있으면 빈 줄 뒤에, 이미 있으면 그대로',()=>{
  assert.equal(appendResult('','새 결과'),'새 결과');
  assert.equal(appendResult('기존\n','새 결과'),'기존\n\n새 결과');
  assert.equal(appendResult('기존\n\n새 결과','새 결과'),'기존\n\n새 결과');
  assert.equal(appendResult('기존',''),'기존');
});

// MEET-파일이름인식: 등록된 종류와 파일 이름 속 회의 이름을 띄어쓰기·기호·꼬리말 차이 없이 맞춘다(별칭·줄임말은 맞추지 않음).
test('종류 맞추기용 글자: 기호·공백·꼬리말을 지운다',()=>{
  assert.equal(kindKey('운영 위원회 회의'),'운영위원회');
  assert.equal(kindKey('A·B-C 협의회 회의결과'),'abc협의회');
  assert.equal(kindKey('회의'),'');
});

test('파일 이름 → 종류 후보: 붙여 쓰기·띄어 쓰기·꼬리말·날짜 6자리·8자리 모두 같은 종류로 맞춘다',()=>{
  const kinds=['가나 다라국 회의','마바 협의회','중앙집행위원회'];
  const one=name=>kindCandidates(name,kinds);
  assert.deepEqual(one('261020_26-38차 가나다라국 회의결과.hwp'),['가나 다라국 회의']);
  assert.deepEqual(one('261020_26-38차 가나 다라국 회의결과.hwp'),['가나 다라국 회의']);
  assert.deepEqual(one('20261020 제38차 가나다라국회의 결과.pdf'),['가나 다라국 회의']);
  assert.deepEqual(one('2026-10-20 가나·다라국 결과.pdf'),['가나 다라국 회의']);
  assert.deepEqual(one('(최종) 마바협의회 자료 251020.hwpx'),['마바 협의회']);
  assert.deepEqual(one('251015 제5차 중앙집행위원회 회의결과.pdf'),['중앙집행위원회']);
});

test('파일 이름 → 종류 후보: 둘 이상이면 모두 돌려주고, 없거나 짧은 줄임말이면 빈 목록',()=>{
  assert.deepEqual(kindCandidates('261020 38차 가나다 운영위원회 결과.hwp',['가나다 운영위원회','운영위원회','마바 협의회']),['가나다 운영위원회','운영위원회']);
  assert.deepEqual(kindCandidates('261020 38차 사아자 회의결과.hwp',['가나 다라국 회의','마바 협의회']),[]);
  assert.deepEqual(kindCandidates('261020 중집 결과.hwp',['중앙집행위원회']),[]);
  assert.deepEqual(kindCandidates('261020 38차.hwp',['중앙집행위원회']),[]);
  assert.deepEqual(kindCandidates('',['중앙집행위원회']),[]);
  assert.deepEqual(kindCandidates('x.hwp',[]),[]);
  assert.deepEqual(kindCandidates('261020 가 결과.hwp',['가']),[]);
});

// S51-28 LIB-화면정리(요청 11/06 01:45, 명진 'ㅇ', 시안 docs/design/mockups/library-phone-dropdown.html):
// 폰·폴드(1199px까지)의 자료실 위 한 줄 [찾기][분류: 정책 외 3 ▾][⋯]에서 [분류 ▾]가 여는 고르기 창의 규칙(순수 함수, node --test).
// 상태 주인은 그대로 library-upload.js의 '꺼 둔 큰 분류 모음(off)'과 고른 소분류(sub) 하나다(PC 칩 줄과 같은 값, 서버 기억도 그대로).
// 창 안에서는 '고른 분류(picked)'로 보인다: 아무것도 안 골랐으면 = 분류 전체(off 비움). 고르면 고른 것만 보이고 나머지는 off.
// 소분류는 큰 분류 아래 들여 쓴 줄이고 하나만 고른다: 소분류를 고르면 그 큰 분류 하나만 고른 상태가 된다(PC 소분류 줄과 같은 뜻).

// 지금 상태(off) → 창에서 체크된 큰 분류. off가 비면 아무것도 체크하지 않는다(= 전체).
export function pickedFrom(names,off){return off.size?names.filter(name=>!off.has(name)):[];}
// 창에서 고른 것 → 꺼 둘 큰 분류. 아무것도 안 골랐으면 모두 켬.
export function offFrom(names,picked){const set=new Set(picked);return set.size?new Set(names.filter(name=>!set.has(name))):new Set();}
// 창 안 줄 하나를 눌렀을 때. value: 'all'(전체) | 큰 분류 이름 | 'sub:'+소분류 전체 이름. parentOf(소분류)는 그 큰 분류.
export function togglePick({picked,sub},value,parentOf){
  if(value==='all')return {picked:[],sub:''};
  if(value.startsWith('sub:')){const name=value.slice(4);return sub===name?{picked:[parentOf(name)],sub:''}:{picked:[parentOf(name)],sub:name};}
  const set=new Set(picked);if(set.has(value))set.delete(value);else set.add(value);
  return {picked:[...set],sub:''};
}
// 줄의 눌림 표시.
export function isPicked({picked,sub},value){
  if(value==='all')return !picked.length&&!sub;
  if(value.startsWith('sub:'))return sub===value.slice(4);
  return picked.includes(value);
}
// 위 한 줄 단추 글자: '분류: 전체' · '분류: 정책' · '분류: 정책 외 3' · '분류: 회의 빼고'(1~2개만 끈 처음 상태) · '분류: 없음'.
// subLabel = 고른 소분류의 보이는 이름('주간보고 › 확정본').
export function pickLabel(names,off,subLabel=''){
  if(subLabel)return `분류: ${subLabel}`;
  const on=names.filter(name=>!off.has(name)),hid=names.filter(name=>off.has(name));
  if(!hid.length)return '분류: 전체';
  if(!on.length)return '분류: 없음';
  if(hid.length<=2&&hid.length<on.length)return `분류: ${hid.join('·')} 빼고`;
  return on.length===1?`분류: ${on[0]}`:`분류: ${on[0]} 외 ${on.length-1}`;
}
// 창 아래 셈 글자.
export const pickCount=({picked,sub})=>sub?'소분류 1개 선택됨':picked.length?`${picked.length}개 선택됨`:'전체';

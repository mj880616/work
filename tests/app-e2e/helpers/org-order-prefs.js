// MULTI ②-3(D5): 화면 시험 고정 페이지(fixture)용 window.KPTUViewPrefs 대역. organization-order.js보다 먼저 불러온다.
// 값은 tests/org-order-fixture.mjs(운영자 프로필로 옮기는 migration 값)와 같다. 이미 있으면(진짜 view-prefs.js) 건드리지 않는다.
(()=>{
  if(window.KPTUViewPrefs)return;
  const prefs={
    org_order:{groups:[
      {name:'철도',orgs:['전국철도노동조합']},
      {name:'지하철',orgs:['서울교통공사노동조합','부산지하철노동조합','대구교통공사노동조합','인천교통공사노동조합']},
      {name:'민자철도',orgs:['서해선지부','신분당선지부','지티엑스에이운영지부','공항철도지부']},
      {name:'민간도시철도',orgs:['메트로9호선노동조합','서울교통공사9호선지부','김포도시철도지부','용인경전철지부']}
    ],hidden:['궤도협의회']},
    report_calendar:'공공운수노조'
  };
  // 보고 설정 칸 시험용: set은 값을 바꾸고(null = 지움) flush는 바로 끝난다. 바뀐 값은 window.__orgOrderPrefs로 본다.
  window.__orgOrderPrefs=prefs;
  window.KPTUViewPrefs={get:key=>prefs[key],set:(key,value)=>{if(value===null)delete prefs[key];else prefs[key]=value;return true},flush:async()=>{},status:()=>'ok'};
})();

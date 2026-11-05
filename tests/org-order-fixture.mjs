// MULTI-노조사용자 ②-3(D5, S50-13): 시험용 담당조직 묶음 설정. 운영자 프로필로 옮기는 migration
// (supabase/migrations/20261105131500_profile_view_prefs_org_order.sql)과 같은 값이며, 예전에 app/organization-order.js에 있던 공개 이름 그대로다
// (tests/org-order-setting.test.mjs가 migration과 같은지 본다). 화면 코드는 이 값을 갖지 않고 내 프로필 화면 기억(view_prefs.org_order)만 읽는다.
export const OPERATOR_ORG_ORDER = Object.freeze({
  groups: [
    {name: '철도', orgs: ['전국철도노동조합']},
    {name: '지하철', orgs: ['서울교통공사노동조합', '부산지하철노동조합', '대구교통공사노동조합', '인천교통공사노동조합']},
    {name: '민자철도', orgs: ['서해선지부', '신분당선지부', '지티엑스에이운영지부', '공항철도지부']},
    {name: '민간도시철도', orgs: ['메트로9호선노동조합', '서울교통공사9호선지부', '김포도시철도지부', '용인경전철지부']}
  ],
  hidden: ['궤도협의회']
});
export const OPERATOR_REPORT_CALENDAR = '공공운수노조';
// window.KPTUViewPrefs 대역: get(key)만(organization-order.js·report-calendar.mjs가 읽는 문).
export const prefsStub = (prefs = {org_order: OPERATOR_ORG_ORDER, report_calendar: OPERATOR_REPORT_CALENDAR}) => ({get: key => prefs[key]});

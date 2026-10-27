// MTG-사업보고 4단계: 사업 보고 '칸'(app_meetings.activity_kind)의 값·화면 글자를 정하는 유일한 곳(docs/design/business-report.md 3절).
// DB 값은 영어(20261022182319_bizreport_activity_kind의 CHECK 8개), 화면 글자는 여기서만 바꾼다. [기타]는 결정 1(가)로 보인다.
export const REPORT_KINDS=Object.freeze([
  {value:'meeting',label:'회의'},
  {value:'policy',label:'정책'},
  {value:'negotiation',label:'교섭'},
  {value:'press',label:'언론'},
  {value:'assembly',label:'국회'},
  {value:'struggle',label:'투쟁'},
  {value:'education',label:'교육'},
  {value:'other',label:'기타'}
].map(Object.freeze));
export const ALL_KINDS='all';
export const DEFAULT_KIND='meeting';
const KNOWN=new Set(REPORT_KINDS.map(k=>k.value));
export const isReportKind=value=>KNOWN.has(value);
// 행의 칸. 열이 없거나 비어 있으면(옛 응답) '회의', 모르는 값이면 '기타'로 보이게 한다(화면이 깨지지 않게). 저장에는 쓰지 않는다.
export function reportKindOf(row){const v=row?.activity_kind;if(v==null||v==='')return DEFAULT_KIND;return KNOWN.has(v)?v:'other'}
export function reportKindLabel(value){return REPORT_KINDS.find(k=>k.value===value)?.label||'기타'}
// 위쪽 칩 줄: [전체] 다음 여덟 칸.
export const reportKindChips=()=>[{value:ALL_KINDS,label:'전체'},...REPORT_KINDS.map(k=>({value:k.value,label:k.label}))];
// 칩 값으로 거르기: [전체]는 전부, 다른 칩은 그 칸만.
export function filterByReportKind(rows,chip){return (rows||[]).filter(r=>chip===ALL_KINDS||reportKindOf(r)===chip)}

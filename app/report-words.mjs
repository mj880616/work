// MTG-사업보고말바꾸기(2026-10-23 사용자 결정): 사업 보고 입력·결과 창의 화면 글자를 칸(activity_kind)에 따라 정하는 유일한 곳.
// [회의] 칸만 회의 말(회의명·차수·회의 결과·회의자료)을 쓰고, 다른 칸은 칸에 맞는 짧은 말(제목·내용·자료)을 쓴다.
// 순수 함수라 DOM·네트워크가 없다(단위 시험 대상). 칸의 값·칩 글자는 report-kinds.mjs가 정한다.
import {DEFAULT_KIND} from './report-kinds.mjs';

const MEETING=Object.freeze({
  meeting:true,
  nameLabel:'회의명',
  nameMissing:'회의명을 입력해 주세요.',
  resultLegend:'회의 결과',
  textLabel:'회의 결과 원문',
  textPlaceholder:'회의 결과를 원문 그대로 입력하거나 붙여넣으세요. 줄바꿈을 포함해 그대로 저장됩니다.',
  materials:'회의자료',
  materialsEmpty:'회의자료가 없습니다.',
  pickFiles:'회의자료 파일 고르기',
  materialsSaved:'회의자료'
});
const OTHER=Object.freeze({
  meeting:false,
  nameLabel:'제목',
  nameMissing:'제목을 입력해 주세요.',
  resultLegend:'내용',
  textLabel:'원문',
  textPlaceholder:'내용을 원문 그대로 입력하거나 붙여넣으세요. 줄바꿈을 포함해 그대로 저장됩니다.',
  materials:'자료',
  materialsEmpty:'자료가 없습니다.',
  pickFiles:'자료 파일 고르기',
  materialsSaved:'자료'
});

// 칸 값 → 화면 글자 묶음. 모르는 값·빈 값은 [회의](옛 행과 같다).
export function reportWords(kind){return !kind||kind===DEFAULT_KIND?MEETING:OTHER}
export const isMeetingKind=kind=>reportWords(kind).meeting;

// MTG-보고창정리: [차수]·[짧은 이름 — 차수가 없을 때] 줄은 회의를 등록할 때만 필요하다. 다른 칸의 새 기록에는 그리지 않는다.
// 이미 차수·짧은 이름이 들어 있는 다른 칸 기록은 값을 지우지 않으려고 그 기록의 수정 창에서만 보여 준다(values: {round, shortName}).
export function showRoundRows(kind,values={}){
  if(isMeetingKind(kind))return true;
  const round=values.round;
  return (round!=null&&String(round).trim()!=='')||String(values.shortName??'').trim()!=='';
}

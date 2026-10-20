// MEET-결과정리 ①(2026-10-20): 회의 카드·목록·결과 창에 보이는 "회의 시각"을 저장값을 바꾸지 않고 보여 줄 때 정한다.
// 1) 직접 지정한 시각(분 단위로 고른 값, 0시 0분 아님) → 그 시각
// 2) 아니면 회의 결과 글 안의 회의 일시 줄(예: "일시: 2026. 10. 19.(월) 14:00", "14시", "오후 2시")에서 규칙으로 읽은 시각
// 3) 그것도 없으면 시각 없이 날짜만(올린 시각·빈 시각을 회의 시각처럼 보이지 않게)
// "직접 지정이 아님"으로 보는 저장값: 한국 시각 0시 0분(파일로 만들기에서 시각을 못 읽었을 때 넣는 값),
// 초·밀리초가 0이 아닌 값(입력 칸은 분 단위라 사람이 고른 값이 아님 — DB 기본값 now() 등 저장 순간의 시각).
// DOM·네트워크를 쓰지 않는다(단위 검사 대상). AI 추출은 하지 않는다(나중 AI-서버연동).
import {formatSeoulTime,seoulParts} from './meeting-time.js';

const pad=n=>String(n).padStart(2,'0');
const MAX_LINES=40;
// 회의 일시를 적는 줄의 머리말: 일시·일 시·회의 일시·개최 일시·시간·일자·날짜·때.
const LABEL=/(?:^|[\s□■○●◇◆▶▷※*·\-\d.)\]])(?:회의\s*)?(?:개최\s*)?(?:일\s*시|일\s*자|날\s*짜|시\s*간|때)\s*[:：]/;
const DATE_HINT=/(?:20\d{2}|\d{2})\s*[.\-/년]\s*\d{1,2}\s*[.\-/월]\s*\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일|\d{1,2}\s*[./]\s*\d{1,2}\s*\(?\s*[월화수목금토일]/;
// 시각: 14:00 · 14시 · 14시 30분 · 오후 2시 · 오후 2:30 · PM 2:00. "1시간"(걸린 시간)·"14:00:00"의 초는 읽지 않는다.
const TIME=/(오전|오후|새벽|아침|낮|저녁|밤|AM|PM|a\.m\.|p\.m\.)?\s*(?<![\d:.])(\d{1,2})\s*(?::\s*([0-5]\d)(?!\d)|시(?!\s*간)(?:\s*(?:([0-5]?\d)\s*분|(반)))?)/i;

function toClock(m){
  const mer=(m[1]||'').toLowerCase();let h=Number(m[2]);const min=m[3]!=null?Number(m[3]):m[4]!=null?Number(m[4]):m[5]?30:0;
  if(!Number.isInteger(h)||h>24||min>59)return '';
  if(/오후|저녁|밤|pm|p\.m\./.test(mer)){if(h<12)h+=12}
  else if(/낮/.test(mer)){if(h<6)h+=12}
  else if(/오전|새벽|아침|am|a\.m\./.test(mer)){if(h===12)h=0}
  if(h===24&&min===0)h=0;
  if(h>23)return '';
  return `${pad(h)}:${pad(min)}`;
}
function timeIn(line){const m=String(line||'').match(TIME);return m?toClock(m):''}

// 회의 결과 글에서 회의 시각("HH:MM")을 읽는다. 못 찾으면 ''.
// 일시 머리말이 있는 줄을 먼저 보고, 없으면 앞쪽 줄 중 날짜와 시각이 함께 적힌 줄을 본다.
export function meetingTimeFromText(text){
  const lines=String(text||'').replace(/\r\n?/g,'\n').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,MAX_LINES);
  for(const line of lines){if(line.length<=160&&LABEL.test(line)){const t=timeIn(line.slice(line.search(LABEL)));if(t)return t}}
  for(const line of lines.slice(0,10)){if(line.length<=160&&DATE_HINT.test(line)){const t=timeIn(line);if(t)return t}}
  return '';
}

// 저장된 회의 일시가 사람이 직접 고른 시각인지.
export function storedTimeIsSet(value){
  const t=Date.parse(value);if(!Number.isFinite(t))return false;
  if(t%60000!==0)return false;
  const p=seoulParts(new Date(t));
  return !(p.hour===0&&p.minute===0);
}

// 보여 줄 회의 시각: {at: 표시용 시각(ISO, 날짜만이면 그 날 0시), time:'HH:MM'|'' , source:'set'|'text'|'none'}.
export function meetingWhen(m){
  const t=Date.parse(m?.meeting_at);
  if(!Number.isFinite(t))return {at:'',time:'',source:'none'};
  const p=seoulParts(new Date(t)),date=`${p.year}-${pad(p.month+1)}-${pad(p.day)}`;
  if(storedTimeIsSet(m.meeting_at))return {at:new Date(t).toISOString(),date,time:`${pad(p.hour)}:${pad(p.minute)}`,source:'set'};
  const fromText=meetingTimeFromText(m?.transcript_text);
  if(fromText)return {at:new Date(`${date}T${fromText}:00+09:00`).toISOString(),date,time:fromText,source:'text'};
  return {at:date,date,time:'',source:'none'};
}

// 화면 글자: 시각이 있으면 "10. 19. 오후 02:00", 없으면 "10. 19."(시각 없이 날짜만). options는 연도 등 더할 때.
export function formatMeetingWhen(m,options={}){
  const w=meetingWhen(m);if(!w.at)return '';
  return w.time
    ?formatSeoulTime(w.at,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',...options})
    :formatSeoulTime(w.date,{month:'numeric',day:'numeric',...options});
}

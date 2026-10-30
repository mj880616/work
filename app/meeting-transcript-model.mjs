// MTG-녹음초안(2026-10-29 사용자 결정): 사업 보고 › 회의 입력 창의 [녹음·전사 넣기]가 쓰는 순수 함수.
// 전사 글(붙여 넣기·txt 등 파일)을 읽고, 서버(meeting-ai-draft) 답을 회의 기록 초안(일시·참석·결정·공유·후속 할 일)으로 바꾼다.
// 화면·네트워크는 meeting-transcript-draft.js가 맡는다. 여기서는 DOM·네트워크를 쓰지 않는다(단위 검사 대상).
import {parseDate} from './meeting-file-parse.mjs';

const pad=n=>String(n).padStart(2,'0');
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const TEXT_EXT=['txt','md','text','srt','vtt'];
const AUDIO_EXT=['m4a','mp3','wav','aac','amr','3gp','ogg','oga','opus','flac','webm','wma','mp4','mpeg','mpga'];
export const MAX_TRANSCRIPT_FILE=5*1024*1024;
// meeting-ai-draft가 원문을 70,000자에서 자른다. 화면이 먼저 알려 준다.
export const MAX_TRANSCRIPT_CHARS=70000;

export function extOf(name){const m=String(name||'').toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:''}
export function isAudioFile(name,type=''){return /^(audio|video)\//.test(String(type||''))||AUDIO_EXT.includes(extOf(name))}
export function isTranscriptFile(name,type=''){return TEXT_EXT.includes(extOf(name))||(/^text\//.test(String(type||''))&&!isAudioFile(name,type))}

function validDate(y,m,d){
  if(!(y>=2000&&y<=2099&&m>=1&&m<=12&&d>=1&&d<=31))return '';
  const t=new Date(Date.UTC(y,m-1,d));
  return t.getUTCMonth()===m-1&&t.getUTCDate()===d?`${y}-${pad(m)}-${pad(d)}`:'';
}
const validTime=(h,mi)=>h>=0&&h<=23&&mi>=0&&mi<=59?`${pad(h)}:${pad(mi)}`:'';

// 녹음·전사 파일 이름의 날짜·시각. 삼성 녹음 앱 '음성 251029_103012', '20251029_103012', '2025-10-29 10.30' 등.
export function dateFromName(name){
  const s=String(name||'').replace(/\.[a-z0-9]+$/i,'');
  let m=s.match(/(?<!\d)(20\d{2})[-.]?(\d{2})[-.]?(\d{2})(?:[ _T-]+(\d{2})[.:]?(\d{2})(?:[.:]?\d{2})?)?(?!\d)/);
  if(m){const date=validDate(+m[1],+m[2],+m[3]);if(date)return {date,time:m[4]?validTime(+m[4],+m[5]):''}}
  m=s.match(/(?<!\d)(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(?:\d{2})?(?!\d)/);
  if(m){const date=validDate(2000+ +m[1],+m[2],+m[3]);if(date)return {date,time:validTime(+m[4],+m[5])}}
  m=s.match(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/);
  if(m){const date=validDate(2000+ +m[1],+m[2],+m[3]);if(date)return {date,time:''}}
  return {date:'',time:''};
}
// 전사 글 맨 앞 몇 줄에 적힌 날짜(예: '2025년 10월 29일 오전 10:30').
export function dateFromText(text,lines=6){
  const head=String(text||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,lines).join('\n');
  return parseDate(head).date;
}

// 파일 바이트 → 글. BOM으로 UTF-16·UTF-8을 가리고, UTF-8이 깨지면 EUC-KR(옛 한글 txt)로 읽는다.
export function decodeTranscript(bytes,TD=globalThis.TextDecoder){
  const b=bytes instanceof Uint8Array?bytes:new Uint8Array(bytes||[]);
  if(b[0]===0xff&&b[1]===0xfe)return new TD('utf-16le').decode(b.subarray(2));
  if(b[0]===0xfe&&b[1]===0xff)return new TD('utf-16be').decode(b.subarray(2));
  const body=b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf?b.subarray(3):b;
  try{return new TD('utf-8',{fatal:true}).decode(body)}
  catch{try{return new TD('euc-kr').decode(body)}catch{return new TD('utf-8').decode(body)}}
}

// 글 정리: 줄바꿈 통일, 자막 파일(srt·vtt)의 번호·시각 줄 빼기, 빈 줄 여러 개는 하나로.
export function cleanTranscript(text,name=''){
  let lines=String(text||'').replace(/\r\n?/g,'\n').replace(/\u0000/g,'').split('\n');
  const ext=extOf(name);
  if(ext==='srt'||ext==='vtt'){
    const stamp=/^\s*\d{1,2}:\d{2}(?::\d{2})?[.,]\d{1,3}\s*-->/;
    lines=lines.filter(l=>!/^\s*WEBVTT\b/.test(l)&&!/^\s*\d+\s*$/.test(l)&&!stamp.test(l));
  }
  return lines.map(l=>l.replace(/\s+$/,'')).join('\n').replace(/\n{3,}/g,'\n\n').trim();
}

const pending=v=>/확인\s*필요/.test(String(v||''));
// 서버 답 → 초안. 키 이름이 조금 달라도 검수할 내용을 살린다(옛 workflow-ai-v3 정규화와 같은 규칙).
export function normalizeDraft(data){
  const raw=data?.draft??data?.result??null;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  const decisions=typeof raw.decisions==='string'?raw.decisions.trim():'';
  const information=String(typeof raw.information==='string'?raw.information:(typeof raw.info==='string'?raw.info:'')).trim();
  const actions=(Array.isArray(raw.actions)?raw.actions:[]).map(a=>{
    if(typeof a==='string'){const task=a.trim();return task?{task,assignee:'',due:''}:null}
    if(!a||typeof a!=='object')return null;
    const task=String(a.task??a.title??'').trim();if(!task)return null;
    const assignee=String(a.assignee??a.owner??'').trim(),due=String(a.due??a.deadline??'').trim();
    return {task,assignee:pending(assignee)?'':assignee,due:DATE_RE.test(due)?due:''};
  }).filter(Boolean);
  const attendees=(Array.isArray(raw.attendees)?raw.attendees:[]).map(x=>String(x??'').trim()).filter(x=>x&&!pending(x));
  const meetingDate=String(raw.meeting_date??'').trim();
  if(!decisions&&!information&&!actions.length&&!attendees.length)return null;
  return {decisions,information,actions,attendees:[...new Set(attendees)],meetingDate:DATE_RE.test(meetingDate)?meetingDate:''};
}

const LIST=/^\s*(?:[-*•·○●□■▶▷※◇◆]|\d+[.)]|[가-하][.)]|\(\d+\)|\[\d+\])\s*/;
const bullets=text=>String(text||'').split('\n').map(l=>l.trim()).filter(Boolean).map(l=>LIST.test(l)?'- '+l.replace(LIST,''):'- '+l);
// 회의 결과 원문 칸에 넣을 글. 참석 · 결정 · 공유 순. 비어 있는 부분은 쓰지 않는다.
export function draftText(draft){
  if(!draft)return '';
  const parts=[];
  if(draft.attendees?.length)parts.push('참석: '+draft.attendees.join(', '));
  const d=bullets(draft.decisions);if(d.length)parts.push(['결정',...d].join('\n'));
  const i=bullets(draft.information);if(i.length)parts.push(['공유',...i].join('\n'));
  return parts.join('\n\n');
}
// 후속 할 일 줄: 이름(담당이 적혀 있으면 괄호) + 기한(YYYY-MM-DD일 때만).
export function actionRows(draft){
  return (draft?.actions||[]).map(a=>({title:a.assignee?`${a.task} (${a.assignee})`:a.task,due:a.due||''})).filter(a=>a.title.trim());
}
// 이미 쓴 글은 지우지 않는다. 비어 있으면 초안만, 아니면 아래에 덧붙인다.
export function mergeText(existing,addition){
  const a=String(existing||'').replace(/\s+$/,''),b=String(addition||'').trim();
  if(!b)return a;if(!a.trim())return b;
  return a.includes(b)?a:a+'\n\n'+b;
}
// 일시 칸: 파일 이름 날짜 > AI가 글에서 찾은 날짜 > 글 첫 줄 날짜. 시각은 파일 이름 시각, 없으면 지금 칸의 시각.
// 바꿀 것이 없으면 ''(칸을 그대로 둔다).
export function pickMeetingAt({current='',file={},aiDate='',textDate=''}={}){
  const date=[file.date,aiDate,textDate].find(v=>DATE_RE.test(String(v||'')));
  if(!date)return '';
  const keep=String(current||'').split('T')[1]||'';
  const time=file.date===date&&file.time?file.time:(keep.slice(0,5)||'10:00');
  const next=`${date}T${time}`;
  return next===String(current||'').slice(0,16)?'':next;
}

// MTG-녹음초안 2단계: 녹음 파일 → 전사(Edge meeting-transcribe, Gemini). 서버(supabase/functions/meeting-transcribe/model.mjs)와 같은 상한·종류.
export const MAX_AUDIO_FILE=100*1024*1024;
export const MAX_AUDIO_SECONDS=60*60;
export const TRANSCRIBE_EXT=Object.freeze(['m4a','mp4','aac','mp3','wav','ogg','oga','opus','flac','webm','3gp','amr']);
// 올리기 전에 화면이 먼저 거른다. 통과면 ''. seconds는 기기가 읽은 길이(모르면 null — 서버·Gemini가 다시 막는다).
export function audioCheck(name,size,seconds=null){
  if(!TRANSCRIBE_EXT.includes(extOf(name)))return '녹음 파일(m4a·mp3·wav 등)만 전사할 수 있어요.';
  if(!(Number(size)>0))return '빈 파일이에요.';
  if(Number(size)>MAX_AUDIO_FILE)return '녹음 파일은 100MB까지 전사할 수 있어요.';
  if(Number.isFinite(seconds)&&seconds>MAX_AUDIO_SECONDS)return '녹음은 1시간까지 전사할 수 있어요.';
  return '';
}
// '43분 12초', '1시간 2분'. 모르면 ''.
export function durationText(seconds){
  if(!Number.isFinite(seconds)||seconds<=0)return '';
  const s=Math.round(seconds),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;
  if(h)return `${h}시간${m?` ${m}분`:''}`;
  if(m)return `${m}분${r?` ${r}초`:''}`;
  return `${r}초`;
}
export function sizeText(bytes){const n=Number(bytes)||0;return n>=1024*1024?`${(n/1024/1024).toFixed(1)}MB`:`${Math.max(1,Math.round(n/1024))}KB`}
// 서버 실패 코드 → 화면 한 줄(짧게). 모르는 코드는 일반 문구.
// 전사 실패는 원인별로 나눈다(MTG-폰녹음전사): 전사 서비스(Gemini) 실패 · 파일 형식 · 연결 끊김(화면이 받은 시간 초과·네트워크 오류·서버 강제 종료).
// 문구는 서버 model.mjs MESSAGES와 같다(시험이 맞춰 봄).
const TRANSCRIBE_FAIL=Object.freeze({
  not_ready:'녹음 전사는 준비 중이에요.',monthly_limit:'이번 달 녹음 전사 한도에 닿았어요.',busy:'다른 녹음을 전사하는 중이에요. 끝난 뒤 다시 눌러 주세요.',
  too_large:'녹음 파일은 100MB까지 전사할 수 있어요.',too_long:'녹음은 1시간까지 전사할 수 있어요.',bad_type:'녹음 파일(m4a·mp3·wav 등)만 전사할 수 있어요.',
  empty_transcript:'녹음에서 글을 찾지 못했어요.',
  drive_failed:'녹음 파일을 Drive에서 읽거나 저장하지 못했어요.',
  gemini_failed:'전사 서비스(Gemini)가 실패했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_upload:'전사 서비스(Gemini)에 녹음을 올리지 못했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_timeout:'전사 서비스(Gemini) 응답이 늦어 멈췄어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.',
  gemini_file_failed:'전사 서비스가 녹음 파일 형식을 읽지 못했어요. 녹음은 Drive에 그대로 있어요.',
  gemini_rejected:'전사 서비스가 녹음 파일을 받지 않았어요(파일 형식). 녹음은 Drive에 그대로 있어요.',
  bad_format:'녹음 파일이 깨져 읽지 못했어요(파일 형식). 녹음은 Drive에 그대로 있어요.',
});
export const TRANSCRIBE_DISCONNECTED='연결이 끊겨 전사 결과를 받지 못했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.';
const KNOWN_FAIL=new Set(Object.values(TRANSCRIBE_FAIL));
// 화면이 받은 오류가 연결 끊김인지: 시간 초과·네트워크 오류, 또는 서버 함수가 강제로 끝나 정해진 한 줄 없이 온 504·546.
function disconnected(e){
  if(!e||typeof e!=='object')return false;
  if(e.code==='timeout'||e.code==='network_error')return true;
  return (e.status===504||e.status===546)&&!KNOWN_FAIL.has(String(e.message||''));
}
// 서버는 실패마다 정해진 한국어 한 줄(error)을 준다. 아는 줄·코드면 그대로, 연결 끊김은 따로, 아니면 일반 문구.
// 글(서버 줄·코드) 또는 오류 객체(runtime api가 던진 것: message·code·status)를 받는다.
export function transcribeFailText(failure){
  if(disconnected(failure))return TRANSCRIBE_DISCONNECTED;
  const m=String((failure&&typeof failure==='object'?failure.message:failure)||'');
  return TRANSCRIBE_FAIL[m]||(KNOWN_FAIL.has(m)?m:'전사하지 못했어요. 녹음은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.');
}

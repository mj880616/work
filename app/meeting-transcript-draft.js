// MTG-녹음초안(2026-10-29 사용자 결정): 사업 보고 › [회의] 입력 창의 [녹음·전사 넣기].
// 녹음은 각 기기 앱으로 자유롭게 하고, 끝난 전사 글(붙여 넣기·txt 등 파일)을 넣으면 AI가 회의 기록 초안을 채운다.
// - 요약은 기존 Edge meeting-ai-draft의 '새 회의' 길(meeting_id 없음 = 서버에 저장하지 않음)을 그대로 쓴다. DB·Edge 변경 없음.
// - 채우는 곳은 입력 창의 기존 칸뿐이다: 일시(#meetingAt), 회의 결과 원문(#meetingTranscript: 참석·결정·공유),
//   후속 할 일(task-workflow.js의 입력 줄 + [추가]를 그대로 눌러 같은 주인이 줄을 그린다). 저장은 명진이 [사업 보고 저장]으로 한다(자동 저장 없음).
// - 이 모듈은 #mtdBar·#mtdPanel 두 곳만 그린다. 녹음 파일 전사는 서버 전사 길이 생긴 뒤 연다(지금은 안내만).
// - 기기 저장 없음: 넣은 전사 글은 창이 열려 있는 동안 화면에만 있다.
import {bindDropTarget} from './meeting-compact.js';
import {toMeetingISO} from './meeting-time.js';
import {isMeetingKind} from './report-words.mjs';
import {MAX_TRANSCRIPT_FILE,MAX_TRANSCRIPT_CHARS,isAudioFile,isTranscriptFile,dateFromName,dateFromText,decodeTranscript,cleanTranscript,normalizeDraft,draftText,actionRows,mergeText,pickMeetingAt} from './meeting-transcript-model.mjs';

(()=>{
'use strict';
if(window.__KPTU_MEETING_TRANSCRIPT_DRAFT__)return;
window.__KPTU_MEETING_TRANSCRIPT_DRAFT__=true;
const $=s=>document.querySelector(s);
const AUDIO_LATER='녹음 파일 전사는 다음 단계에서 열려요. 지금은 녹음 앱의 텍스트 변환 글을 붙여 넣거나 txt 파일로 넣어 주세요.';
let epoch=0,busy=false,fileInfo={date:'',time:''},fileName='';

function install(){
  if($('#mtdBar'))return true;
  const label=$('#meetingTranscript')?.closest('label');
  if(!label)return false;
  label.insertAdjacentHTML('beforebegin',`<div id="mtdBar" class="mtd-bar"><button id="mtdOpen" class="secondary mtd-open" type="button" aria-expanded="false" aria-controls="mtdPanel">녹음·전사 넣기</button><span id="mtdStatus" class="mtd-status" role="status" aria-live="polite"></span></div>
<section id="mtdPanel" class="mtd-panel" aria-label="녹음·전사 넣기" hidden>
<div class="mtd-file-line"><button id="mtdPick" class="secondary" type="button">파일</button><input id="mtdFile" type="file" accept=".txt,.md,.srt,.vtt,text/plain,audio/*" hidden><span id="mtdFileName" class="mtd-note">전사 글 txt를 고르거나 끌어 놓기</span></div>
<textarea id="mtdText" rows="6" aria-label="전사 글" placeholder="녹음 앱의 텍스트 변환 글을 그대로 붙여 넣으세요."></textarea>
<div class="mtd-actions"><button id="mtdCancel" class="secondary" type="button">닫기</button><button id="mtdRun" class="secondary mtd-run" type="button">초안 채우기</button></div>
</section>`);
  $('#mtdOpen').onclick=()=>toggle(!isOpen());
  $('#mtdCancel').onclick=()=>toggle(false);
  $('#mtdPick').onclick=()=>$('#mtdFile').click();
  $('#mtdFile').addEventListener('change',()=>{const input=$('#mtdFile'),file=input.files?.[0];input.value='';if(file)void takeFile(file)});
  $('#mtdRun').onclick=()=>void run();
  $('#mtdText').addEventListener('input',()=>{if(!$('#mtdText').value.trim()){fileName='';fileInfo={date:'',time:''};paintFile()}});
  // 패널 안에 끌어 놓은 파일은 회의자료(창 전체 끌어 놓기)가 아니라 전사로 받는다(bindDropTarget이 전파를 멈춘다).
  bindDropTarget($('#mtdPanel'),files=>void takeFile(files[0]),()=>!busy);
  return true;
}
const isOpen=()=>!$('#mtdPanel')?.hidden;
function toggle(open){
  const panel=$('#mtdPanel'),btn=$('#mtdOpen');if(!panel||!btn)return;
  panel.hidden=!open;btn.setAttribute('aria-expanded',String(open));
  if(open)$('#mtdText')?.focus();
}
function status(text,kind=''){const el=$('#mtdStatus');if(!el)return;el.textContent=text||'';el.className='mtd-status'+(kind?' '+kind:'')}
function paintFile(){const el=$('#mtdFileName');if(el)el.textContent=fileName||'전사 글 txt를 고르거나 끌어 놓기'}
// 진행 중인 요약은 버린다(늦게 온 답이 다른 창·다른 칸을 채우지 않게).
function stop(){epoch++;busy=false;const run=$('#mtdRun');if(run){run.disabled=false;run.textContent='초안 채우기'}}
function reset(){
  stop();fileName='';fileInfo={date:'',time:''};
  const text=$('#mtdText');if(text)text.value='';
  paintFile();status('');toggle(false);
}

async function takeFile(file){
  if(!file||busy)return;
  toggle(true);
  if(isAudioFile(file.name,file.type)){status(AUDIO_LATER,'error');return}
  if(!isTranscriptFile(file.name,file.type)){status('전사 글은 txt 파일로 넣어 주세요.','error');return}
  if(file.size>MAX_TRANSCRIPT_FILE){status('전사 글 파일은 5MB까지 넣을 수 있어요.','error');return}
  const mine=epoch;
  try{
    const text=cleanTranscript(decodeTranscript(new Uint8Array(await file.arrayBuffer())),file.name);
    if(mine!==epoch)return;
    if(!text){status('파일에 글이 없어요.','error');return}
    $('#mtdText').value=text;fileName=file.name;fileInfo=dateFromName(file.name);paintFile();
    status(`${text.length.toLocaleString('ko-KR')}자를 읽었어요. [초안 채우기]를 누르세요.`);
  }catch(e){if(mine===epoch){console.warn('transcript file read failed',e);status('파일을 읽지 못했어요.','error')}}
}

function addAction(row){
  const title=$('#meetingActionTitle'),due=$('#meetingActionDue'),add=$('#meetingActionAdd');
  if(!title||!add)return false;
  title.value=row.title;
  if(due){due.value=row.due||'';due.dispatchEvent(new Event('change',{bubbles:true}))}
  add.click();
  return true;
}

async function run(){
  if(busy)return;
  const text=cleanTranscript($('#mtdText')?.value||'',fileName);
  if(!text){status('전사 글을 붙여 넣거나 파일을 넣어 주세요.','error');$('#mtdText')?.focus();return}
  const rt=window.KPTURuntime,context=rt?.context?.read?.();
  const workspaceId=context?.workspace?.id;
  if(!rt?.api||!workspaceId){status('로그인 상태를 확인하지 못했어요.','error');return}
  const mine=++epoch,btn=$('#mtdRun');
  busy=true;if(btn){btn.disabled=true;btn.textContent='요약 중…'}
  status(text.length>MAX_TRANSCRIPT_CHARS?`글이 길어 앞 ${MAX_TRANSCRIPT_CHARS.toLocaleString('ko-KR')}자만 요약해요. 요약 중…`:'요약 중… 1분쯤 걸릴 수 있어요.');
  const at=$('#meetingAt')?.value||'';
  try{
    const data=await rt.api('/functions/v1/meeting-ai-draft',{method:'POST',body:{
      workspace_id:workspaceId,project_id:null,
      title:$('#meetingTitle')?.value.trim()||'회의',
      meeting_at:at?toMeetingISO(at):new Date().toISOString(),
      transcript_text:text.slice(0,MAX_TRANSCRIPT_CHARS)
    }});
    // 창을 닫았거나 다시 연 뒤에 온 답은 버린다.
    if(mine!==epoch||$('#meetingModal')?.classList.contains('hidden'))return;
    const draft=normalizeDraft(data);
    if(!draft)throw new Error('invalid_meeting_draft');
    const next=pickMeetingAt({current:at,file:fileInfo,aiDate:draft.meetingDate,textDate:dateFromText(text)});
    if(next&&$('#meetingAt'))$('#meetingAt').value=next;
    const area=$('#meetingTranscript');
    if(area){area.value=mergeText(area.value,draftText(draft));area.dispatchEvent(new Event('input',{bubbles:true}))}
    const rows=actionRows(draft);let added=0;
    for(const row of rows)if(addAction(row))added++;
    const warn=(data?.warnings||[]).length;
    status(`초안을 채웠어요${added?` · 후속 할 일 ${added}개`:''}${warn?` · 확인할 것 ${warn}건`:''}. 고친 뒤 [사업 보고 저장]을 누르세요.`,'ok');
    toggle(false);
  }catch(e){
    if(mine!==epoch)return;
    console.error('meeting transcript draft failed',e);
    status(e?.code==='session_required'?'로그인이 만료됐어요. 다시 로그인해 주세요.':'초안을 만들지 못했어요. 넣은 글은 그대로 있어요. 잠시 뒤 다시 눌러 주세요.','error');
  }finally{
    if(mine===epoch){busy=false;if(btn){btn.disabled=false;btn.textContent='초안 채우기'}}
  }
}

// 창이 열릴 때(team.js openMeetingModal이 칸 글자를 칠하며 알림)와 칸을 바꿀 때. [회의] 칸에서만 보인다.
window.addEventListener('kptu:report-entry-kind',e=>{
  if(!install())return;
  const modal=$('#meetingModal'),opening=!!modal?.classList.contains('hidden');
  if(opening)reset();
  const meeting=isMeetingKind(e.detail?.kind);
  $('#mtdBar').hidden=!meeting;
  if(!meeting){stop();toggle(false)}
});
install();
})();

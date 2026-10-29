// MTG-녹음초안(2026-10-29 사용자 결정): 사업 보고 › [회의] 입력 창의 [녹음·전사 넣기].
// 녹음은 각 기기 앱으로 자유롭게 하고, 끝난 전사 글(붙여 넣기·txt 등 파일)을 넣으면 AI가 회의 기록 초안을 채운다.
// - 요약은 기존 Edge meeting-ai-draft의 '새 회의' 길(meeting_id 없음 = 서버에 저장하지 않음)을 그대로 쓴다. DB·Edge 변경 없음.
// - 채우는 곳은 입력 창의 기존 칸뿐이다: 일시(#meetingAt), 회의 결과 원문(#meetingTranscript: 참석·결정·공유),
//   후속 할 일(task-workflow.js의 입력 줄 + [추가]를 그대로 눌러 같은 주인이 줄을 그린다). 저장은 명진이 [사업 보고 저장]으로 한다(자동 저장 없음).
// - 이 모듈은 #mtdBar·#mtdPanel 두 곳만 그린다.
// - 2단계(녹음 파일 → 전사): 녹음 파일을 고르면 [전사] → Edge meeting-transcribe가 명진 Drive에 올리고 Gemini로 전사해 글을 돌려준다.
//   글은 전사 칸(#mtdText)에 넣고 바로 위 [초안 채우기]와 같은 흐름을 이어 부른다. 서버는 전사 글을 저장하지 않는다.
//   [이 회의에 녹음 붙이기]를 켜 두면 [사업 보고 저장] 뒤(kptu:record-saved) 그 회의 자료로 녹음 링크를 붙인다.
//   붙이지 않은 녹음은 서버가 30일 뒤 Drive 휴지통으로 옮긴다(기기에는 아무것도 남기지 않음).
// - 기기 저장 없음: 넣은 전사 글·고른 녹음은 창이 열려 있는 동안 화면에만 있다.
import {bindDropTarget} from './meeting-compact.js';
import {waitInlineHtml} from './wait-state.js';
import {toMeetingISO} from './meeting-time.js';
import {isMeetingKind} from './report-words.mjs';
import {MAX_TRANSCRIPT_FILE,MAX_TRANSCRIPT_CHARS,isAudioFile,isTranscriptFile,dateFromName,dateFromText,decodeTranscript,cleanTranscript,normalizeDraft,draftText,actionRows,mergeText,pickMeetingAt,audioCheck,durationText,sizeText,transcribeFailText} from './meeting-transcript-model.mjs';

(()=>{
'use strict';
if(window.__KPTU_MEETING_TRANSCRIPT_DRAFT__)return;
window.__KPTU_MEETING_TRANSCRIPT_DRAFT__=true;
const $=s=>document.querySelector(s);
const FN='/functions/v1/meeting-transcribe';
let epoch=0,busy=false,fileInfo={date:'',time:''},fileName='';
// 고른 녹음(화면에만)과 끝난 전사 작업. attachJob: [사업 보고 저장] 뒤 그 회의에 붙일 작업 id.
let audio=null,audioSeconds=null,audioJob='',attachJob='';

function install(){
  if($('#mtdBar'))return true;
  const label=$('#meetingTranscript')?.closest('label');
  if(!label)return false;
  label.insertAdjacentHTML('beforebegin',`<div id="mtdBar" class="mtd-bar"><button id="mtdOpen" class="secondary mtd-open" type="button" aria-expanded="false" aria-controls="mtdPanel">녹음·전사 넣기</button><span id="mtdStatus" class="mtd-status" role="status" aria-live="polite"></span></div>
<section id="mtdPanel" class="mtd-panel" aria-label="녹음·전사 넣기" hidden>
<div class="mtd-file-line"><button id="mtdPick" class="secondary" type="button">파일</button><input id="mtdFile" type="file" accept=".txt,.md,.srt,.vtt,text/plain,audio/*" hidden><span id="mtdFileName" class="mtd-note">전사 글 txt·녹음 파일을 고르거나 끌어 놓기</span></div>
<div id="mtdAudio" class="mtd-audio" hidden><button id="mtdTranscribe" class="secondary" type="button">전사</button><label class="mtd-attach"><input id="mtdAttach" type="checkbox"> 이 회의에 녹음 붙이기</label><span id="mtdWait" class="mtd-wait"></span></div>
<textarea id="mtdText" rows="6" aria-label="전사 글" placeholder="녹음 앱의 텍스트 변환 글을 그대로 붙여 넣으세요."></textarea>
<div class="mtd-actions"><button id="mtdCancel" class="secondary" type="button">닫기</button><button id="mtdRun" class="secondary mtd-run" type="button">초안 채우기</button></div>
</section>`);
  $('#mtdOpen').onclick=()=>toggle(!isOpen());
  $('#mtdCancel').onclick=()=>toggle(false);
  $('#mtdPick').onclick=()=>$('#mtdFile').click();
  $('#mtdFile').addEventListener('change',()=>{const input=$('#mtdFile'),file=input.files?.[0];input.value='';if(file)void takeFile(file)});
  $('#mtdRun').onclick=()=>void run();
  $('#mtdTranscribe').onclick=()=>void transcribe();
  $('#mtdText').addEventListener('input',()=>{if(!$('#mtdText').value.trim()){fileName='';fileInfo={date:'',time:''};paintFile()}});
  $('#mtdAttach').addEventListener('change',syncAttach);
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
function paintFile(){const el=$('#mtdFileName');if(el)el.textContent=fileName||'전사 글 txt·녹음 파일을 고르거나 끌어 놓기'}
function paintAudio(){
  const box=$('#mtdAudio');if(!box)return;
  box.hidden=!audio;
  const btn=$('#mtdTranscribe');if(btn){btn.disabled=busy||!audio||!!audioJob;btn.textContent=audioJob?'전사 끝':'전사'}
  const wait=$('#mtdWait');if(wait)wait.innerHTML=busy&&audio&&!audioJob?waitInlineHtml():'';
}
function clearAudio(){audio=null;audioSeconds=null;audioJob='';const a=$('#mtdAttach');if(a)a.checked=false;paintAudio()}
// 진행 중인 요약은 버린다(늦게 온 답이 다른 창·다른 칸을 채우지 않게).
function stop(){epoch++;busy=false;const run=$('#mtdRun');if(run){run.disabled=false;run.textContent='초안 채우기'}paintAudio()}
function reset(){
  stop();fileName='';fileInfo={date:'',time:''};attachJob='';clearAudio();
  const text=$('#mtdText');if(text)text.value='';
  paintFile();status('');toggle(false);
}

async function takeFile(file){
  if(!file||busy)return;
  toggle(true);
  if(isAudioFile(file.name,file.type)){await takeAudio(file);return}
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

// 기기가 읽은 녹음 길이(초). 못 읽으면 null(서버·Gemini가 다시 막는다). 기기에 남기지 않는다.
function readSeconds(file){
  return new Promise(resolve=>{
    let url='',done=false;const el=document.createElement('audio');
    const end=v=>{if(done)return;done=true;clearTimeout(timer);el.removeAttribute('src');try{el.load()}catch{}if(url)URL.revokeObjectURL(url);resolve(Number.isFinite(v)&&v>0?v:null)};
    const timer=setTimeout(()=>end(null),8000);
    el.preload='metadata';el.onloadedmetadata=()=>end(el.duration);el.onerror=()=>end(null);
    try{url=URL.createObjectURL(file);el.src=url}catch{end(null)}
  });
}
async function takeAudio(file){
  const mine=epoch;
  clearAudio();
  const early=audioCheck(file.name,file.size);
  if(early){status(early,'error');return}
  const seconds=await readSeconds(file);
  if(mine!==epoch)return;
  const late=audioCheck(file.name,file.size,seconds);
  if(late){status(late,'error');return}
  audio=file;audioSeconds=seconds;
  const el=$('#mtdFileName');if(el)el.textContent=[file.name,durationText(seconds),sizeText(file.size)].filter(Boolean).join(' · ');
  paintAudio();
  status('[전사]를 누르면 글로 바꾼 뒤 초안까지 채워요.');
}
async function transcribe(){
  if(busy||!audio||audioJob)return;
  const rt=window.KPTURuntime,workspaceId=rt?.context?.read?.()?.workspace?.id;
  if(!rt?.api||!workspaceId){status('로그인 상태를 확인하지 못했어요.','error');return}
  const file=audio,seconds=audioSeconds,mine=++epoch;
  busy=true;paintAudio();const runBtn=$('#mtdRun');if(runBtn)runBtn.disabled=true;
  try{
    const config=await rt.api(FN+'?action=config',{method:'POST',body:{workspace_id:workspaceId}});
    if(mine!==epoch)return;
    if(!config?.ready)throw new Error(transcribeFailText('not_ready'));
    status('녹음을 올리는 중…');
    const up=await rt.api(FN+'?action=upload',{method:'POST',body:file,singleFlight:false,timeoutMs:600000,headers:{
      'x-workspace-id':workspaceId,'x-file-name':encodeURIComponent(file.name),...(seconds?{'x-duration-sec':String(Math.ceil(seconds))}:{})
    }});
    if(mine!==epoch)return;
    if(!up?.job_id)throw new Error('');
    status(seconds&&seconds>600?'전사 중… 녹음이 길어 몇 분 걸릴 수 있어요.':'전사 중…');
    const done=await rt.api(FN+'?action=transcribe',{method:'POST',body:{job_id:up.job_id},singleFlight:false,timeoutMs:420000});
    if(mine!==epoch||$('#meetingModal')?.classList.contains('hidden'))return;
    const text=cleanTranscript(String(done?.text||''),file.name);
    if(!text)throw new Error(transcribeFailText('empty_transcript'));
    audioJob=up.job_id;
    if($('#mtdAttach')?.checked)attachJob=audioJob;
    $('#mtdText').value=text;fileName=file.name;fileInfo=dateFromName(file.name);
    busy=false;paintAudio();
    // 끝나면 기존 '전사 글 → 회의 기록 초안' 흐름을 그대로 잇는다.
    await run();
  }catch(e){
    if(mine!==epoch)return;
    console.warn('meeting transcribe failed',e?.status||'',e?.code||'');
    status(e?.code==='session_required'?'로그인이 만료됐어요. 다시 로그인해 주세요.':transcribeFailText(e?.message),'error');
  }finally{
    if(mine===epoch||!busy){busy=false;paintAudio();const r=$('#mtdRun');if(r&&r.textContent!=='요약 중…')r.disabled=false}
  }
}
// [이 회의에 녹음 붙이기]: 전사가 끝난 뒤 켜거나 끌 수도 있다.
function syncAttach(){attachJob=audioJob&&$('#mtdAttach')?.checked?audioJob:''}
// [사업 보고 저장]이 회의를 만든 뒤(team.js saveMeeting). 실패해도 회의는 그대로이고 녹음은 Drive에 남는다(30일 뒤 정리).
window.addEventListener('kptu:record-saved',e=>{
  const id=e.detail?.kind==='meeting'?e.detail?.id:'',job=attachJob;
  if(!id||!job)return;
  attachJob='';
  window.KPTURuntime?.api?.(FN+'?action=attach',{method:'POST',body:{job_id:job,meeting_id:id},singleFlight:false})
    .then(()=>window.dispatchEvent(new CustomEvent('kptu:meetings-changed',{detail:{meeting_id:id}})))
    .catch(err=>console.warn('meeting recording attach failed',err?.status||''));
});

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

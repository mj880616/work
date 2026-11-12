// MTG-녹음초안(2026-10-29 사용자 결정): 사업 보고 › [회의] 입력 창의 [녹음·전사 넣기].
// 녹음은 각 기기 앱으로 자유롭게 하고, 끝난 전사 글(붙여 넣기·txt 등 파일)을 넣으면 AI가 회의 기록 초안을 채운다.
// - 요약은 기존 Edge meeting-ai-draft의 '새 회의' 길(meeting_id 없음 = 서버에 저장하지 않음)을 쓴다. 긴 글은 나눠 요약(stage part·merge, S48-64).
// - 전사 전문은 '회의록 전문' 칸(app_meetings.notes)에 넣어 [사업 보고 저장] 때 회의와 함께 남긴다(S48-64, 명진 지시 '전사 전문 저장 허용').
// - 채우는 곳은 입력 창의 기존 칸뿐이다: 일시(#meetingAt), 참석인원(#meetingAttendees, 비어 있을 때만), 회의 결과 원문(#meetingTranscript: 참석·결정·공유),
//   AI가 찾은 후속 할 일은 입력 줄에 넣지 않는다(MTG-할일자동생성금지): [사업 보고 저장] 뒤 그 보고의 챙길 것 후보로만 올린다. 저장은 명진이 [사업 보고 저장]으로 한다(자동 저장 없음).
//   예외(REC-한회의로잇기 PR-5, 설계 1-4·3-3절 (라)): [녹음 요약하기] 전에 같은 날 회의록 전문이 있는 [회의] 보고가 있으면 한 번 묻고, 명진이 고른
//   [그 보고에 잇기]면 이 글을 서버가 그 보고에 이어 붙여 저장한다(물음·잇기의 주인은 meeting-join.js, 이 창은 닫는다). [새로 만들기]는 지금 그대로.
// - 이 모듈은 #mtdBar·#mtdPanel 두 곳만 그린다.
// - S61-5 REC-전사삭제(명진 11/13 '회의 전사 기능은 아예 웹2에서 삭제'): 녹음 파일 → 전사([전사]·[이 회의에 녹음 붙이기])와
//   노트북·폰 녹음이 이 창에 전사 글을 넣던 길(fill·fillResult)은 뺐다. 녹음 파일은 녹음 띠가 자료실 '회의 녹음' 폴더에 저장한다.
//   다른 곳에서 받은 전사 글(붙여 넣기·txt)을 요약하는 [녹음 요약하기]는 그대로다.
// - 기기 저장 없음: 넣은 전사 글·고른 녹음은 창이 열려 있는 동안 화면에만 있다.
import {bindDropTarget} from './meeting-compact.js';
import {toMeetingISO} from './meeting-time.js';
import {isMeetingKind} from './report-words.mjs';
import {MAX_TRANSCRIPT_FILE,MAX_TRANSCRIPT_CHARS,DRAFT_TIMEOUT_MS,splitTranscript,partsText,keepTranscript,draftFailText,isAudioFile,isTranscriptFile,dateFromName,dateFromText,decodeTranscript,cleanTranscript,normalizeDraft,draftText,actionRows,mergeText,attendeesLine,pickMeetingAt} from './meeting-transcript-model.mjs';

(()=>{
'use strict';
if(window.__KPTU_MEETING_TRANSCRIPT_DRAFT__)return;
window.__KPTU_MEETING_TRANSCRIPT_DRAFT__=true;
const $=s=>document.querySelector(s);
let epoch=0,busy=false,fileInfo={date:'',time:''},fileName='';
// REC-한회의로잇기 PR-5: 이 창에서 잇기 물음에 [새로 만들기]를 골랐음(같은 창에서 다시 [녹음 요약하기]를 눌러도 다시 묻지 않음). 창을 열 때 비운다.
let joinNew=false;

function install(){
  if($('#mtdBar'))return true;
  const label=$('#meetingTranscript')?.closest('label');
  if(!label)return false;
  label.insertAdjacentHTML('beforebegin',`<div id="mtdBar" class="mtd-bar"><button id="mtdOpen" class="secondary mtd-open" type="button" aria-expanded="false" aria-controls="mtdPanel">녹음·전사 넣기</button><span id="mtdStatus" class="mtd-status" role="status" aria-live="polite"></span></div>
<section id="mtdPanel" class="mtd-panel" aria-label="녹음·전사 넣기" hidden>
<div class="mtd-file-line"><button id="mtdPick" class="secondary" type="button">파일</button><input id="mtdFile" type="file" accept=".txt,.md,.srt,.vtt,text/plain" hidden><span id="mtdFileName" class="mtd-note">전사 글 txt를 고르거나 끌어 놓기</span></div>
<textarea id="mtdText" rows="6" aria-label="전사 글" placeholder="녹음 앱의 텍스트 변환 글을 그대로 붙여 넣으세요."></textarea>
<div class="mtd-actions"><button id="mtdCancel" class="secondary" type="button">닫기</button><button id="mtdRun" class="secondary mtd-run" type="button">녹음 요약하기</button></div>
</section>`);
  $('#mtdOpen').onclick=()=>toggle(!isOpen());
  $('#mtdCancel').onclick=()=>toggle(false);
  $('#mtdPick').onclick=()=>$('#mtdFile').click();
  $('#mtdFile').addEventListener('change',()=>{const input=$('#mtdFile'),file=input.files?.[0];input.value='';if(file)void takeFile(file)});
  $('#mtdRun').onclick=()=>void run({ask:true});
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
function stop(){epoch++;busy=false;const run=$('#mtdRun');if(run){run.disabled=false;run.textContent='녹음 요약하기'}}
function reset(){
  stop();fileName='';fileInfo={date:'',time:''};todoRows=[];joinNew=false;
  const text=$('#mtdText');if(text)text.value='';
  paintFile();status('');toggle(false);
}

async function takeFile(file){
  if(!file||busy)return;
  toggle(true);
  if(isAudioFile(file.name,file.type)){status('녹음 파일은 전사하지 않아요. 다른 곳에서 받은 전사 글(txt)을 넣어 주세요.','error');return}
  if(!isTranscriptFile(file.name,file.type)){status('전사 글은 txt 파일로 넣어 주세요.','error');return}
  if(file.size>MAX_TRANSCRIPT_FILE){status('전사 글 파일은 5MB까지 넣을 수 있어요.','error');return}
  const mine=epoch;
  try{
    const text=cleanTranscript(decodeTranscript(new Uint8Array(await file.arrayBuffer())),file.name);
    if(mine!==epoch)return;
    if(!text){status('파일에 글이 없어요.','error');return}
    $('#mtdText').value=text;fileName=file.name;fileInfo=dateFromName(file.name);paintFile();
    status(`${text.length.toLocaleString('ko-KR')}자를 읽었어요. [녹음 요약하기]를 누르세요.`);
  }catch(e){if(mine===epoch){console.warn('transcript file read failed',e);status('파일을 읽지 못했어요.','error')}}
}

// MTG-할일자동생성금지(요청함 11/11 15:25, 명진 "회의결과가 할일을 자동으로 만드는 거 그러지마"): AI가 찾은 후속 할 일은 '후속 할 일' 입력 줄에
// 넣지 않는다(그 줄은 [사업 보고 저장] 때 Google 할 일이 된다). 화면에만 들고 있다가 저장 뒤 그 보고의 챙길 것 후보로 올린다(todo-radar-data.js).
// 할 일은 잊지 말기·보고 상세에서 [할 일로]를 눌러야 생긴다. 명진이 입력 줄에 직접 쓴 할 일은 지금처럼 저장 때 만들어진다.
let todoRows=[];
window.addEventListener('kptu:record-saved',e=>{
  const d=e.detail||{},id=d.kind==='meeting'?d.id:'',rows=todoRows;
  if(!id||!rows.length)return;
  todoRows=[];
  void (async()=>{
    let r;
    try{r=await (await import('./todo-radar-data.js')).addMeetingCandidates(id,rows,{day:d.day,projectId:d.project_id})}catch{r={ok:false}}
    if(r?.ok){if(r.added)window.dispatchEvent(new CustomEvent('kptu:todo-radar-changed',{detail:{reload:true}}));return}
    console.warn('meeting todo candidates failed',r?.missing?'missing':'');
    try{(await import('./small-notice.js')).notify('할 일 후보를 잊지 말기에 올리지 못했어요. 사업 보고에서 [후속 할 일 만들기]를 눌러 주세요.',{error:true})}catch{}
  })();
});

// S48-64(REC-전사원문저장): 전사 글은 요약 전에 '회의록 전문' 칸(#meetingNotes = app_meetings.notes)에 먼저 넣는다.
// 요약이 실패해도 [사업 보고 저장]을 누르면 전문이 회의와 함께 남는다. 이미 쓴 글은 지우지 않고 아래에 덧붙인다.
function keepFull(text){
  const notes=$('#meetingNotes');if(!notes||!text)return;
  const next=keepTranscript(notes.value,text);
  if(next!==notes.value){notes.value=next;notes.dispatchEvent(new Event('input',{bubbles:true}))}
}
// 서버 요약 한 번. stage: ''(한 번에) | 'part'(긴 글의 한 조각) | 'merge'(조각 요약 합치기).
function askDraft(rt,workspaceId,{text,stage='',part=0,parts=0}){
  const at=$('#meetingAt')?.value||'';
  return rt.api('/functions/v1/meeting-ai-draft',{method:'POST',singleFlight:false,timeoutMs:DRAFT_TIMEOUT_MS,body:{
    workspace_id:workspaceId,project_id:null,
    title:$('#meetingTitle')?.value.trim()||'회의',
    meeting_at:at?toMeetingISO(at):new Date().toISOString(),
    transcript_text:text,
    ...(stage?{stage,part_no:part,part_count:parts}:{})
  }});
}

// 요약 답 → 입력 창 칸(일시·결과 원문·참석인원). 후속 할 일은 칸에 넣지 않고 후보로 들고 있다.
function applyDraft(data,text,at){
  const draft=normalizeDraft(data);
  if(!draft)throw new Error('invalid_meeting_draft');
  const next=pickMeetingAt({current:at,file:fileInfo,aiDate:draft.meetingDate,textDate:dateFromText(text)});
  if(next&&$('#meetingAt'))$('#meetingAt').value=next;
  const area=$('#meetingTranscript');
  if(area){area.value=mergeText(area.value,draftText(draft));area.dispatchEvent(new Event('input',{bubbles:true}))}
  // MTG-참석인원칸(S56-31): 참석을 찾았고 '참석인원' 칸이 비어 있으면 채운다(이미 쓴 값은 두고, 원문 안 '참석:' 줄도 그대로).
  const who=$('#meetingAttendees'),line=attendeesLine(draft);
  if(who&&line&&!who.value.trim()){who.value=line;who.dispatchEvent(new Event('input',{bubbles:true}))}
  const found=actionRows(draft);todoRows=[...todoRows,...found];
  const warn=(data?.warnings||[]).length;
  status(`초안을 채웠어요${found.length?` · 할 일 후보 ${found.length}개는 저장하면 잊지 말기에`:''}${warn?` · 확인할 것 ${warn}건`:''} · 전사 전문은 '회의록 전문' 칸에. 수정한 뒤 [사업 보고 저장]을 누르세요.`,'ok');
  toggle(false);
}

// ask = 사람이 [녹음 요약하기]를 누름(PR-5 (라) 물음을 거친다).
async function run({ask=false}={}){
  if(busy)return false;
  let ok=false;
  const text=cleanTranscript($('#mtdText')?.value||'',fileName);
  if(!text){status('전사 글을 붙여 넣거나 파일을 넣어 주세요.','error');$('#mtdText')?.focus();return false}
  const rt=window.KPTURuntime,context=rt?.context?.read?.();
  const workspaceId=context?.workspace?.id;
  if(!rt?.api||!workspaceId){status('로그인 상태를 확인하지 못했어요.','error');return false}
  if(ask&&!joinNew&&window.KPTUMeetingJoin?.askTranscript){
    const how=await askJoin(text);
    if(how==='joined'){joined();return false}
    if(how!=='new')return false; // 물음을 닫음·시작하지 못함·창이 닫힘 — 글은 그대로
    joinNew=true;
  }
  const mine=++epoch,btn=$('#mtdRun');
  keepFull(text);
  busy=true;if(btn){btn.disabled=true;btn.textContent='요약 중…'}
  const pieces=splitTranscript(text);
  const cutNote=text.length>MAX_TRANSCRIPT_CHARS?` 글이 길어 앞 ${MAX_TRANSCRIPT_CHARS.toLocaleString('ko-KR')}자만 요약해요.`:'';
  const at=$('#meetingAt')?.value||'';
  const gone=()=>mine!==epoch||$('#meetingModal')?.classList.contains('hidden');
  try{
    let data;
    if(pieces.length<=1){
      status(`요약 중… 1분쯤 걸릴 수 있어요.${cutNote}`);
      data=await askDraft(rt,workspaceId,{text:pieces[0]||text});
    }else{
      // 긴 전사본: 조각마다 요약 → 조각 요약을 합쳐 한 번 더 요약. 조각 하나가 실패하면 멈춘다(넣은 글·전문 칸은 그대로).
      const drafts=[];
      for(let i=0;i<pieces.length;i++){
        status(`긴 녹음이라 나눠 요약하는 중… ${i+1}/${pieces.length}${cutNote}`);
        const part=normalizeDraft(await askDraft(rt,workspaceId,{text:pieces[i],stage:'part',part:i+1,parts:pieces.length}));
        if(gone())return false;
        if(part)drafts.push(part);
      }
      if(!drafts.length)throw new Error('invalid_meeting_draft');
      status('나눠 요약한 것을 합치는 중…');
      data=await askDraft(rt,workspaceId,{text:partsText(drafts),stage:'merge',parts:pieces.length});
    }
    // 창을 닫았거나 다시 연 뒤에 온 답은 버린다.
    if(gone())return false;
    applyDraft(data,text,at);
    ok=true;
  }catch(e){
    if(mine!==epoch)return false;
    console.error('meeting transcript draft failed',e?.code||e?.status||'');
    status(`${draftFailText(e)} 전사 전문은 '회의록 전문' 칸에 들어 있어요.`,'error');
  }finally{
    if(mine===epoch){busy=false;if(btn){btn.disabled=false;btn.textContent='녹음 요약하기'}}
  }
  return ok;
}

// REC-한회의로잇기 PR-5 (라): 묻는 동안 [녹음 요약하기]를 잠근다. 돌려줌: 'new' · 'joined' · 'later'(물음을 닫음·시작하지 못함) · 'gone'(창을 닫았거나 다시 엶).
async function askJoin(text){
  const mine=++epoch,btn=$('#mtdRun');
  busy=true;if(btn){btn.disabled=true;btn.textContent='확인 중…'}
  let how='new';
  try{how=await window.KPTUMeetingJoin.askTranscript({text,at:$('#meetingAt')?.value||'',records:[],anchor:btn})}
  catch(e){console.warn('meeting join ask failed',e?.name||'');how='new'}
  if(mine!==epoch||$('#meetingModal')?.classList.contains('hidden'))return 'gone';
  busy=false;if(btn){btn.disabled=false;btn.textContent='녹음 요약하기'}
  if(how==='later')status('전사 글은 그대로 있어요. [녹음 요약하기]를 누르면 다시 물어요.');
  return how;
}
// [그 보고에 잇기]: 이 글은 서버가 그 보고에 이어 붙인다(진행·끝은 맨 위 줄). 이 창의 전사 글·할 일 후보를 비우고 창을 닫는다
// (다른 칸에 쓴 글이 있으면 창의 닫기 물음이 그대로 묻는다 — team.js requestMeetingClose).
function joined(){
  reset();
  document.querySelector('#meetingModal [data-close="meetingModal"]')?.click();
}

// REC-한회의로잇기 PR-0: 입력 창의 쓰던 글 확인(team.js가 닫기·새로 열기 전에 본다). 요약 중, 전사 글 칸에 남은 글.
// 전사 글 칸은 요약이 끝나면 접히지만 글은 그대로 남으므로, 요약을 채운 뒤에도 '쓰던 글'로 센다(채운 결과는 저장 전까지 쓰던 글).
function hasDraft(){return busy||!!$('#mtdText')?.value.trim()}
window.KPTUMeetingTranscriptDraft={hasDraft};

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

import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {formatSeoulTime} from './meeting-time.js';
import {disconnectWithUndo} from './basket-record-delete.js';
import {createAnchoredMenu} from './anchored-menu.js';
import {aiSummaryAllowed,aiSummaryMarkup,newAiState,placeAiSummary,requestLinkSummary} from './basket-ai-summary.js';
import {previewText,markdownSource,writtenText} from './note-preview.mjs';
import {attachmentsLabel} from './record-file-line.mjs';
import {dayCell} from './org-record-rows.mjs'; // UI-기록카드하나로: 글 기록 줄과 같은 날짜 칸 글

const PAGE_SIZE=100;
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const contextFor=rt=>typeof rt.context?.read==='function'?(rt.context.read()||{}):(globalThis.window?.__KPTU_BOOT_CONTEXT__||{});
const scope=rt=>{const c=contextFor(rt);return `${c?.user?.id||''}:${c?.workspace?.id||''}`;};
const changed=()=>new Error('업무 공간이나 로그인이 바뀌었어요. 다시 확인해 주세요.');
// Match the applied PostgreSQL btrim character set, including NEL and BOM.
const onlyWhitespace=/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$/u;
// BASKET-연결요약선택: a blank summary on connect is allowed; the database keeps NULL and screens show the note's opening text.
export const isBlankLinkSummary=value=>value===undefined||value===null||(typeof value==='string'&&onlyWhitespace.test(value));
export const EXCERPT_LENGTH=120;
export const noteExcerpt=text=>previewText(text,EXCERPT_LENGTH);
export function validateLinkSummary(value){
  if(typeof value!=='string'||onlyWhitespace.test(value))throw Error('기록 요약을 입력해 주세요.');
  if(value.includes('\0')||value.isWellFormed?.()===false)throw Error('기록 요약의 글자를 확인해 주세요.');
  if([...value].length>2000)throw Error('기록 요약은 2,000자까지 쓸 수 있어요.');
  return value;
}
export async function readRecordPages(path,rt=window.KPTURuntime){
  const owner=scope(rt),rows=[];
  for(let offset=0;;offset+=PAGE_SIZE){
    const page=await rt.api(`${path}&limit=${PAGE_SIZE}&offset=${offset}`);
    if(owner!==scope(rt))throw changed();
    if(!Array.isArray(page))throw Error('기록을 확인하지 못했어요. 다시 시도해 주세요.');
    rows.push(...page);if(page.length<PAGE_SIZE)return rows;
  }
}
// UI-기록아이콘: noteKinds ['basket','note'] also returns links made from a note (app_notes kind=note, linked by the same
// app_basket_confirm_links through the note's [연결하기]); each row then carries note_kind and the note's title. The default stays
// basket updates only, so every other reader (journal, drive summary, dates) is unchanged. No new table, policy or RPC.
// REF-참고묶음 (docs/design/ref-bundle.md 4절): kind 'bundle' reads the confirmed links to reference bundles (bundle_id) with the same
// one read and the same owner/workspace checks, for the coming 참고 screen. Without kind 'bundle' nothing changes: organization and
// project links only, so a reference link never reaches an organization or project record list.
// ORG-기록첨부: withFiles also reads the note's attachments (same read, same checks) for the record lists' picture/file strip (record-files.js).
export async function readLinkRecords({kind,targetIds,linkId,weekStart,weekEnd,dateOnly=false,noteKinds=['basket'],withFiles=false}={},rt=window.KPTURuntime){
  const context=contextFor(rt),workspaceId=context?.workspace?.id;
  if(!context?.user?.id||!workspaceId)throw changed();
  if(kind&&!['organization','project','bundle'].includes(kind))throw Error('연결할 곳을 확인해 주세요.');
  if(targetIds&&!targetIds.length)return [];
  const kinds=noteKinds.filter(k=>['basket','note'].includes(k));if(!kinds.length)return [];const withNotes=kinds.includes('note');
  const owner=scope(rt),encode=encodeURIComponent,bundle=kind==='bundle',target=kind==='organization'?'organization_id':bundle?'bundle_id':'project_id';
  const columns=`organization_id,project_id${bundle?',bundle_id':''}`;
  const fields=dateOnly?`id,workspace_id,note_id,${columns},status,note:app_notes!inner(id,workspace_id,occurred_at)`:`id,workspace_id,summary,origin,note_id,${columns},status,note:app_notes!inner(id,workspace_id,occurred_at,raw_text${withNotes?',kind,title,metadata':''}${withFiles?',attachments':''})`;
  const places=bundle?'bundle_id=not.is.null':'or=(organization_id.not.is.null,project_id.not.is.null)';
  const base=`/rest/v1/app_record_links?workspace_id=eq.${encode(workspaceId)}&note.workspace_id=eq.${encode(workspaceId)}&note.kind=${kinds.length===1?'eq.'+kinds[0]:'in.('+kinds.join(',')+')'}&status=eq.confirmed&note_id=not.is.null&${places}&select=${fields}&order=id.asc`;
  const batches=targetIds?Array.from({length:Math.ceil(targetIds.length/PAGE_SIZE)},(_,i)=>targetIds.slice(i*PAGE_SIZE,(i+1)*PAGE_SIZE)):[null];
  const rows=[];
  for(const ids of batches){
    const path=base+(ids?`&${target}=in.(${ids.map(encode).join(',')})`:'')+(linkId?`&id=eq.${encode(linkId)}`:'')+(weekStart?`&note.occurred_at=gte.${encode(weekStart)}`:'')+(weekEnd?`&note.occurred_at=lt.${encode(weekEnd)}`:'');
    const page=await readRecordPages(path,rt);
    if(owner!==scope(rt))throw changed();
    for(const row of page){
      const note=row.note;
      if(row.workspace_id!==workspaceId||row.status!=='confirmed'||!row.note_id||!note||note.workspace_id!==workspaceId||note.id!==row.note_id)continue;
      if(bundle?(!row.bundle_id||row.organization_id||row.project_id):(!row.organization_id&&!row.project_id))continue;
      if(linkId&&row.id!==linkId||kind&&!row[target]||targetIds&&!targetIds.includes(row[target]))continue;
      if(weekStart&&Date.parse(note.occurred_at)<Date.parse(weekStart)||weekEnd&&Date.parse(note.occurred_at)>=Date.parse(weekEnd))continue;
      const noteKind=withNotes&&note.kind==='note'?'note':'basket';if(!kinds.includes(noteKind))continue;
      rows.push({id:row.id,...(dateOnly?{}:{summary:row.summary??null,origin:row.origin??null,raw_text:note.raw_text}),note_id:row.note_id,organization_id:row.organization_id,project_id:row.project_id,...(bundle?{bundle_id:row.bundle_id}:{}),occurred_at:note.occurred_at,type:'basket',...(withNotes?{note_kind:noteKind,title:note.title??null,note_folder:folderMeta(note.metadata)}:{}),...(withFiles&&!dateOnly?{attachments:Array.isArray(note.attachments)?note.attachments:[]}:{})});
    }
  }
  return rows;
}
// S69 보드잠금가림 전수: a note line keeps only the note's folder place (metadata.folder_id / old name metadata.folder) so the lock check
// (feature-lock.js noteHidden, the one judgement) can hide it. Nothing else from metadata is kept on the row.
const folderMeta=meta=>{if(!meta||typeof meta!=='object'||Array.isArray(meta))return null;const out={};if(meta.folder_id!=null)out.folder_id=meta.folder_id;if(typeof meta.folder==='string')out.folder=meta.folder;return Object.keys(out).length?out:null;};
// A note line whose note sits in a PIN-locked folder (while locked) shows only '잠김': no summary (written from the note), title, text or files.
// Screen hiding only, like every note-folder lock — the server owner boundary stays as it is.
export const LOCKED_RECORD_TEXT='잠김';
export const recordLocked=row=>isNoteRecord(row)&&!!row?.note_folder&&!!(typeof window!=='undefined'&&window.KPTUFeatureLock?.noteHidden?.({metadata:row.note_folder}));
// Copy of a row for any screen that draws a record's own fields (sheet, bundle line, file strip): locked note lines lose every note-derived field.
export const shownRecord=row=>recordLocked(row)?{...row,summary:LOCKED_RECORD_TEXT,title:LOCKED_RECORD_TEXT,raw_text:'',attachments:[],locked:true}:row;
// UI-연결요약수정: clearing a saved summary back to NULL is not possible yet (app_basket_update_link_summary needs 1+ characters).
export const SUMMARY_BLANK_TEXT='요약을 비워 저장하는 기능은 아직 준비 중이에요. 글을 남기거나 [취소]를 눌러 주세요.';
// UI-연결요약수정: in a multi-line box Enter is a new line and Ctrl+Enter (Cmd+Enter on a Mac) saves. An Enter that only ends a
// Korean IME composition is ignored. The coming common Enter-save rule (UI-엔터저장) uses the same keys.
export const SUMMARY_ERROR_TEXT=Object.freeze({
  NOT_FOUND:'이 연결 기록을 찾거나 열 수 없어요.',
  PERMISSION_DENIED:'이 기록 요약을 수정할 권한이 없어요.',
  FUNCTION_UNAVAILABLE:'요약 수정 기능이 아직 준비되지 않았어요.',
  INVALID_INPUT:'기록 요약의 글자와 길이를 확인해 주세요.',
  SUMMARY_CHANGED:'다른 곳에서 요약이 바뀌었어요. 최신 내용을 확인해 주세요.',
  RESULT_UNKNOWN:'결과를 확인하지 못했어요. 최신 내용을 확인해 주세요.',
});
export async function updateLinkSummary(id,expected,summary,rt=window.KPTURuntime){
  validateLinkSummary(summary);
  try{
    const result=await rt.api('/rest/v1/rpc/app_basket_update_link_summary',{method:'POST',body:{p_link_id:id,p_expected_summary:expected,p_summary:summary}});
    return result?.ok===true||result?.ok===false&&SUMMARY_ERROR_TEXT[result.error]?result:{ok:false,error:'RESULT_UNKNOWN'};
  }catch(error){
    const message=error?.message||'';
    if(error?.status===404||/PGRST202|Could not find the function|function .*app_basket_update_link_summary.*does not exist/i.test(message))return {ok:false,error:'FUNCTION_UNAVAILABLE'};
    if([401,403].includes(Number(error?.status))||error?.code==='42501')return {ok:false,error:'PERMISSION_DENIED'};
    return {ok:false,error:'RESULT_UNKNOWN'};
  }
}
// RECORD-기록하나로(S71-71, 사용자 결정 2026-11-26 "조직 보고로 한 번 편입되면 걍 조직 기록이야 / 업데이트고 잊지말기고 원문이고 뭐고 없어
// 걍 메뉴도 다 통일"): 기록 줄은 어디서 왔든(직접 쓴 기록·사진·파일·업데이트·잊지 말기·노트에서 연결) 같은 줄 하나 — 출처 표시(아이콘·'노트 연결')도,
// 원문으로 가는 이동도 없다(S71-57 '잊지 말기 연결' 표시 삭제를 노트 연결까지 넓힘). 지난 기록 전부 같다(화면 규칙, 연결 데이터는 그대로).
// noteMark는 노트 화면 쪽(record-sheet.js의 노트 제목 등)이 쓴다.
const NOTE_ICON='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3.5 2.5h6l3 3v8h-9z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M9.5 2.5v3h3M5.5 8.5h5M5.5 11h3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
export const isNoteRecord=row=>row?.note_kind==='note';
export function noteMark(className='record-mark'){return `<span class="${className}" data-record-mark="note" role="img" aria-label="노트">${NOTE_ICON}</span>`;}
// A note record shows the summary written when it was linked, else the note's title, else its opening text.
// BUG-미리보기기호: every line is shown as plain letters (no #·|·** marks, no &#x20; entities); the stored text is unchanged.
export const recordText=row=>recordLocked(row)?LOCKED_RECORD_TEXT:row.summary!=null?previewText(row.summary):(isNoteRecord(row)&&String(row.title||'').trim()?previewText(row.title):noteExcerpt(row.raw_text));
// ORG-기록첨부표시이름(S61-2): 목록 줄에 보이는 글. 요약·글이 없고 사진·파일만 있는 기록은 '사진 3장'·'파일 2개'(readLinkRecords withFiles의 attachments), 그것도 없으면 '요약 없음'.
export const recordShownText=row=>recordText(row)||attachmentsLabel(row?.attachments)||'요약 없음';
// Every record line is text only (no link to the original); its ⋯ is the one record menu RECORD_ACTIONS below.
// BUG-미리보기기호: the written text a record's [더보기] opens as headings and tables (only when it carries marks the line removed).
const recordSourceText=row=>recordLocked(row)?LOCKED_RECORD_TEXT:row.summary!=null?row.summary:(isNoteRecord(row)&&String(row.title||'').trim()?row.title:row.raw_text);
export const recordMarkdownSource=row=>markdownSource(recordSourceText(row));
// EDIT-번호모양보존: a text with no markdown marks that was written over several lines opens as written ("1)" "(1)" indentation and blank lines stay).
export const recordWrittenSource=row=>{const text=recordSourceText(row);return !markdownSource(text)&&/\n/.test(String(text??'').trim())?writtenText(text):'';};
// extra: html put inside the record under its line (ORG-기록첨부: the picture/file strip, record-files.js).
// UI-기록카드하나로(S70-42, 사용자 11/25 "사진이 있는거랑 글자가 있는거랑 먼가 통일감이 없음"): 글 기록 줄과 같은 틀 [날짜 칸 'MM.DD.' | 본문 | ⋯].
// 본문 = 글(또는 사진만인 기록의 한 줄) + 그 아래 extra(기록 띠: 작은 사진·파일 이름, record-files.js). 긴 날짜·시각은 날짜 칸 title로만.
export function linkRecordHtml(row,{extra=''}={}){
  const ok=Number.isFinite(Date.parse(row.occurred_at)),date=ok?formatSeoulTime(row.occurred_at,{year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric'}):'',day=ok?dayCell(row):'';
  const kind=row.organization_id?'organization':'project',note=isNoteRecord(row);
  return `<div class="basket-link-record" data-basket-link="${escape(row.id)}" data-basket-link-note="${escape(row.note_id)}" data-basket-link-kind="${kind}" data-basket-link-note-kind="${note?'note':'basket'}"><div class="basket-link-line"><span class="basket-link-day"><time${ok?` datetime="${escape(new Date(row.occurred_at).toISOString())}" title="${escape(date)}"`:''}>${escape(day)}</time></span><div class="basket-link-main"><div class="basket-link-open"><p data-link-summary-text${recordMarkdownSource(row)?` data-md-raw="${escape(recordMarkdownSource(row))}"`:''}${recordWrittenSource(row)?` data-written-raw="${escape(recordWrittenSource(row))}"`:''}>${escape(recordShownText(row))}</p></div>${extra}</div><button type="button" class="basket-link-more" data-basket-link-menu="${escape(row.id)}" aria-label="기록 메뉴" aria-haspopup="true" aria-expanded="false" aria-controls="basketLinkMenu"><span class="more-dots" aria-hidden="true">⋯</span></button></div><p data-link-action-status role="status" aria-live="polite" hidden></p></div>`;
}

// RECORD-기록하나로(S71-71): 기록 줄 ⋯ 한 벌 = [수정][메모][삭제] — 조직 관리 직접 쓴 기록(workplace-detail.js)·연결 기록(아래 메뉴)·
// 사업 관리 기록(project-system-v3.js)이 모두 이 표를 그린다. 날짜는 [수정] 안에서 고친다(날짜 고치는 칸을 따로 두지 않음). 출처별 항목(원문 보기·노트 열기·
// 원문 삭제·연결 해제·요약 수정)은 없다. 줄 밀기 칸(공용 row-swipe)은 이 중 [수정][삭제].
export const RECORD_ACTIONS=Object.freeze([Object.freeze(['edit','수정']),Object.freeze(['memo','메모']),Object.freeze(['delete','삭제'])]);
export function recordMenuHtml(attr,{memo='메모',danger='basket-link-danger'}={}){return RECORD_ACTIONS.map(([a,t])=>`<button type="button"${a==='delete'?` class="${danger}"`:''} data-${attr}="${a}">${escape(a==='memo'?memo:t)}</button>`).join('');}
// 연결 기록의 메모 자리: 노트 연결은 그 노트(memo target note), 그 밖 연결 기록은 그 연결 줄(record_link — DB 대상 종류).
export const linkMemoTarget=row=>row?.note_kind==='note'||row?.dataset?.basketLinkNoteKind==='note'?{type:'note',id:row.note_id||row.dataset?.basketLinkNote}:{type:'record_link',id:row?.id||row?.dataset?.basketLink};
let memosNowRef=null;
const linkMemoLabel=row=>{if(!row)return '메모';const t=linkMemoTarget(row),n=(memosNowRef?.()||[]).filter(m=>m.target_type===t.type&&m.target_id===t.id).length;return n?`메모 ${n}`:'메모';};
void import('./memo-store.js').then(m=>{memosNowRef=m.memosNow;}).catch(()=>{});
// 기록 ⋯ [메모]: 기록 창(record-sheet.js) = 이 기록 글 + 메모 칸. 원문(잊지 말기·업데이트 글)은 보이지 않는다 — 기록 글만.
// openRecordSheet는 부르는 화면이 넘긴다(record-sheet.js가 이 파일을 불러 쓰므로 여기서 부르면 순환 참조).
export function openLinkMemo(row,{place='',trigger=null,openRecordSheet}={}){
  if(!row||recordLocked(row)||typeof openRecordSheet!=='function')return false;
  const text=String(recordSourceText(row)??''),t=linkMemoTarget(row);
  return openRecordSheet({row:{raw_text:text,summary:null},title:'기록',meta:[place,dayCell(row)].filter(Boolean).join(' · '),trigger,memo:{...t,title:[place,previewText(text,60)].filter(Boolean).join(' · ')}});
}
// One menu panel for every mounted record host (created on first use inside the open dialog).
const mountedHosts=new Map();let linkMenu=null;
const hostOf=trigger=>[...mountedHosts.keys()].find(host=>host.contains(trigger));
function recordMenu(host){
  if(linkMenu)return linkMenu;
  linkMenu=createAnchoredMenu({id:'basketLinkMenu',className:'basket-link-menu',label:'기록 관리',historyKey:'kptuBasketLinkMenu',parent:host.closest('.modal')||document.body,
    key:trigger=>trigger.dataset.basketLinkMenu,canOpen:trigger=>!!hostOf(trigger)&&!trigger.disabled,
    // RECORD-기록하나로: 연결 줄도 직접 쓴 기록과 같은 [수정][메모][삭제](recordMenuHtml 한 곳).
    render:id=>recordMenuHtml('basket-link-action',{memo:linkMemoLabel([...document.querySelectorAll('[data-basket-link]')].find(el=>el.dataset.basketLink===id))}),
    onAction:(button,active)=>{const host=hostOf(active.trigger);mountedHosts.get(host)?.(button.dataset.basketLinkAction,active.id);}});
  return linkMenu;
}

// S70-65 UI-밀기메뉴통일: 줄 밀기 칸(담당조직 기록 창의 연결 줄 [수정][삭제])이 ⋯ 메뉴와 같은 길을 부른다 — name은 ⋯ 항목 이름(edit·delete, RECORD_ACTIONS).
export function linkRowAction(host,name,id){mountedHosts.get(host)?.(name,id);}
// MENU-자리나머지: 기록 줄을 그리는 쪽(업무 기록 창 workplace-detail.js 등)이 줄을 다시 그린 뒤 열린 기록 메뉴를 새 ⋯에 붙인다(anchored-menu keepMenus에 넘김).
export const linkMenuFollower={get active(){return linkMenu?.active||null},follow(find){linkMenu?.follow(find)}};

// One delegated editor per detail host; drafts and exact previous strings are
// memory-only. A conflict/unknown result always needs explicit user confirmation.
// UI-연결요약수정: organization detail (#wdUpdates) and project detail (the record list) both mount this one editor; project
// detail opens it from its own ⋯ menu through edit(id). Rows are re-read with both note kinds so a note link saves too.
// Overwrite rule (D11, docs/design/ai-server.md): the only summary writer is app_basket_update_link_summary, a compare-and-set
// on the exact previous summary. [AI 요약] never saves and never replaces typed text without [이걸로 바꾸기]; any automatic
// filler must send expected NULL, so a summary a person saved (non-NULL) makes it fail with SUMMARY_CHANGED instead of overwriting.
const LINK_KINDS=['basket','note'];
export function mountLinkSummaryEditor(host,{getRecord,getName=()=>'',isCurrent=()=>true,onUpdated=()=>{},onRemoved=()=>{},onBig=null,openRecordSheet=null},rt=window.KPTURuntime){
  const states=new Map();let epoch=0;
  const valid=(state,run,owner)=>run===epoch&&states.get(state.id)===state&&owner===scope(rt)&&isCurrent()&&host.isConnected;
  function clear(){epoch++;states.clear();host.querySelectorAll('[data-link-summary-form]').forEach(form=>form.remove());host.querySelectorAll('.basket-link-record [data-basket-link-menu]').forEach(button=>button.disabled=false);host.querySelectorAll('[data-link-action-status]').forEach(status=>{status.textContent='';status.hidden=true;});}
  function formFor(id){return [...host.querySelectorAll('[data-link-summary-form]')].find(form=>form.dataset.linkSummaryForm===id);}
  function open(id){
    if(!isCurrent())return;const record=getRecord(id);if(!record||recordLocked(record))return; // 잠긴 폴더 노트: 원문·요약 수정 칸을 열지 않는다
    const existing=formFor(id);if(existing){existing.querySelector('textarea')?.focus();return;}
    const row=[...host.querySelectorAll('[data-basket-link]')].find(row=>row.dataset.basketLink===id);if(!row)return;
    const state={id,expected:record.summary??null,busy:false,needsReview:false,latest:null,ai:newAiState(),aiTarget:null};states.set(id,state);
    row.insertAdjacentHTML('beforeend',`<form data-enter-save data-link-summary-form="${escape(id)}"><label>내용<textarea data-link-summary-input rows="3"></textarea></label><p data-link-summary-status role="status" aria-live="polite"></p><div data-link-summary-latest hidden></div><button type="button" class="secondary" data-link-summary-current hidden>최신 요약 확인</button><div class="basket-link-actions">${onBig?'<button type="button" class="secondary" data-link-summary-big aria-haspopup="dialog" aria-label="크게" title="큰 창에서 수정"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>':''}<button type="button" class="ghost" data-link-summary-cancel>취소</button><button type="submit" class="primary" data-link-summary-save aria-keyshortcuts="Control+Enter" title="Ctrl+Enter로 저장">저장</button></div></form>`);
    const form=formFor(id),input=form.querySelector('textarea');input.value=String(recordSourceText(record)??'');input.focus(); // 기록에 보이는 글 그대로에서 고친다(저장은 이 연결 줄 글만 — 원문은 그대로)
    void aiGate(state,form,record);
  }
  // AI-서버연동 S4: [AI 요약] appears only for a note the server would summarize (not archived, not AI-excluded, not a diary).
  async function aiGate(state,form,record){
    const run=epoch,owner=scope(rt),workspaceId=contextFor(rt)?.workspace?.id,target=record.organization_id?{kind:'organization',id:record.organization_id}:record.project_id?{kind:'project',id:record.project_id}:null;
    if(!target||!record.note_id||!workspaceId)return;
    let note=null;
    try{const rows=await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(record.note_id)}&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,kind,archived_at,ai_export_allowed&limit=1`);note=Array.isArray(rows)&&rows.length===1&&rows[0]?.id===record.note_id?rows[0]:null;}catch{note=null;}
    if(!note||!valid(state,run,owner)||!form.isConnected||!aiSummaryAllowed({...note,raw_text:record.raw_text}))return;
    state.aiTarget={noteId:record.note_id,...target};
    const box=document.createElement('div');box.dataset.linkSummaryAiBox='';form.querySelector('label')?.after(box);paintAi(state,form);
  }
  function paintAi(state,form,focus=''){
    const box=form.querySelector('[data-link-summary-ai-box]');if(!box)return;
    box.innerHTML=aiSummaryMarkup(state.ai,state.id,'data-link-summary',escape);
    box.querySelectorAll('button').forEach(el=>{el.disabled=state.busy||(el.hasAttribute('data-link-summary-ai-run')&&state.ai.busy);});
    if(focus)(focus==='input'?form.querySelector('textarea'):box.querySelector(`[data-link-summary-ai-${focus}]`))?.focus();
  }
  async function runAi(state,form){
    if(state.ai.busy||!state.aiTarget)return;
    const run=epoch,owner=scope(rt),seq=++state.ai.run;
    Object.assign(state.ai,{busy:true,status:'',retry:false,proposal:''});paintAi(state,form);
    const result=await requestLinkSummary({noteId:state.aiTarget.noteId,targetKind:state.aiTarget.kind,targetId:state.aiTarget.id},{rt});
    if(!valid(state,run,owner)||state.ai.run!==seq||!form.isConnected)return;
    state.ai.busy=false;
    const keep=!document.activeElement||document.activeElement===document.body||form.contains(document.activeElement);
    if(!result.ok){state.ai.status=result.message;state.ai.retry=result.retry;paintAi(state,form,keep?'run':'');return;}
    const input=form.querySelector('textarea'),placed=placeAiSummary(input.value,result.summary,'저장');
    if(placed.fill!==null)input.value=placed.fill;
    state.ai.proposal=placed.proposal;state.ai.status=placed.status;paintAi(state,form,keep?(placed.fill!==null?'input':'apply'):'');
  }
  function applyAi(state,form,use){
    if(!state.ai.proposal)return;
    if(use){form.querySelector('textarea').value=state.ai.proposal;state.ai.status='제안으로 바꿨어요. 아직 저장 전이에요. 수정한 뒤 [저장]을 눌러 주세요.';}else state.ai.status='';
    state.ai.proposal='';paintAi(state,form,use?'input':'run');
  }
  async function latest(state,form,run,owner){
    try{
      const records=await readLinkRecords({linkId:state.id,noteKinds:LINK_KINDS},rt);if(!valid(state,run,owner))return;
      const fresh=records[0];if(!fresh){form.querySelector('[data-link-summary-status]').textContent=SUMMARY_ERROR_TEXT.NOT_FOUND;return;}
      state.latest=fresh;const box=form.querySelector('[data-link-summary-latest]');box.hidden=false;box.textContent=`최신 요약: ${fresh.summary??'요약 없음'}`;
      form.querySelector('[data-link-summary-current]').hidden=false;
    }catch{if(valid(state,run,owner)){const box=form.querySelector('[data-link-summary-latest]');box.hidden=false;box.textContent='최신 요약을 불러오지 못했어요. 다시 저장을 눌러 확인해 주세요.';}}
  }
  async function save(form){
    const state=states.get(form.dataset.linkSummaryForm);if(!state||state.busy||!isCurrent())return;
    const run=epoch,owner=scope(rt),input=form.querySelector('textarea'),status=form.querySelector('[data-link-summary-status]');
    if(state.needsReview){await latest(state,form,run,owner);return;}
    if(isBlankLinkSummary(input.value)){status.textContent=SUMMARY_BLANK_TEXT;input.focus();return;}
    let summary;try{summary=validateLinkSummary(input.value);}catch(error){status.textContent=error.message;input.focus();return;}
    const invalidate=()=>{if(owner===scope(rt))window.dispatchEvent(new Event('kptu:basket-links-changed'));};
    let acknowledged=false;
    state.busy=true;form.querySelectorAll('button,textarea').forEach(el=>el.disabled=true);status.textContent='저장 중…';
    try{
      const result=await updateLinkSummary(state.id,state.expected,summary,rt);acknowledged=result.ok===true;if(!valid(state,run,owner)){if(acknowledged||result.error==='RESULT_UNKNOWN')invalidate();return;}
      if(!result.ok){status.textContent=SUMMARY_ERROR_TEXT[result.error]||SUMMARY_ERROR_TEXT.RESULT_UNKNOWN;
        if(['SUMMARY_CHANGED','RESULT_UNKNOWN'].includes(result.error)){state.needsReview=true;await latest(state,form,run,owner);}
        if(result.error==='RESULT_UNKNOWN')invalidate();
        return;
      }
      const fresh=(await readLinkRecords({linkId:state.id,noteKinds:LINK_KINDS},rt))[0];if(!valid(state,run,owner)){invalidate();return;}
      if(!fresh){status.textContent=SUMMARY_ERROR_TEXT.NOT_FOUND;state.needsReview=true;invalidate();return;}
      await onUpdated(fresh);if(!valid(state,run,owner)){invalidate();return;}
      states.delete(state.id);form.remove();window.dispatchEvent(new Event('kptu:basket-links-changed'));
    }catch{
      if(!valid(state,run,owner)){if(acknowledged)invalidate();return;}
      if(valid(state,run,owner)){status.textContent=SUMMARY_ERROR_TEXT.RESULT_UNKNOWN;state.needsReview=true;await latest(state,form,run,owner);invalidate();}
    }finally{
      if(valid(state,run,owner)){state.busy=false;form.querySelectorAll('button,textarea').forEach(el=>el.disabled=false);paintAi(state,form);}
    }
  }
  // RECORD-기록하나로: 기록 [삭제] = 이 연결 줄 하나만 지운다(되돌리기 알림, basket-record-delete.js disconnectWithUndo). 원문 노트·업데이트는
  // 그대로 두고 고치지 않는다(다른 곳에 연결된 같은 원문 줄도 그대로). Results never paint after clear/dispose.
  const acting=new Set();
  const rowsFor=(attr,value)=>[...host.querySelectorAll('[data-basket-link]')].filter(row=>row.dataset[attr]===value);
  function setRowBusy(rows,value){rows.forEach(row=>row.querySelectorAll('[data-basket-link-menu]').forEach(el=>el.disabled=value));}
  function say(id,message){const status=rowsFor('basketLink',id)[0]?.querySelector('[data-link-action-status]');if(status){status.textContent=message||'';status.hidden=!message;}}
  async function remove(id){
    const row=rowsFor('basketLink',id)[0];if(!row||!isCurrent())return;
    const key=`link:${id}`;if(acting.has(key))return;
    if(formFor(id)){say(id,'수정을 먼저 저장하거나 취소해 주세요.');return;}
    const record=getRecord(id);if(!record)return;
    const run=epoch,owner=scope(rt),valid=()=>run===epoch&&owner===scope(rt)&&isCurrent()&&host.isConnected;
    acting.add(key);setRowBusy([row],true);say(id,'처리 중…');
    let result;
    try{result=await disconnectWithUndo(record,{name:getName(),rt,isCurrent:valid,record:true,anchor:row.querySelector('[data-basket-link-menu]')});}
    catch{result={status:'unknown',message:'결과를 확인하지 못했어요. 목록을 다시 불러와 실제 상태를 확인해 주세요.'};}
    finally{acting.delete(key);}
    if(!valid()||result.status==='stale')return;
    const live=rowsFor('basketLink',id);
    if(['deleted','missing'].includes(result.status)){
      const next=live.at(-1)?.nextElementSibling?.querySelector?.('button');
      live.forEach(el=>{states.delete(el.dataset.basketLink);el.remove();});
      onRemoved({status:result.status,linkId:id,noteId:null});
      if(next)next.focus();
      return;
    }
    setRowBusy(live,false);say(id,result.status==='cancelled'?'':result.message);
    live[0]?.querySelector('[data-basket-link-menu]')?.focus();
  }
  function action(name,id){
    const row=rowsFor('basketLink',id)[0];if(!row||!isCurrent())return;
    if(name==='edit'){open(id);return;}
    if(name==='memo'){openLinkMemo(getRecord(id),{place:getName(),trigger:row.querySelector('[data-basket-link-menu]'),openRecordSheet});return;}
    if(name==='delete')void remove(id);
  }
  function click(event){
    const button=event.target.closest?.('button');if(!button||!host.contains(button))return;
    if(button.dataset.basketLinkMenu){if(!button.disabled)recordMenu(host).open(button);return;}
    const form=button.closest('[data-link-summary-form]'),state=form&&states.get(form.dataset.linkSummaryForm);if(!state||state.busy)return;
    if(button.hasAttribute('data-link-summary-big')){onBig?.(form.querySelector('textarea'));return;}
    if(button.hasAttribute('data-link-summary-ai-run')){void runAi(state,form);return;}
    if(button.hasAttribute('data-link-summary-ai-apply')||button.hasAttribute('data-link-summary-ai-dismiss')){applyAi(state,form,button.hasAttribute('data-link-summary-ai-apply'));return;}
    if(button.hasAttribute('data-link-summary-cancel')){states.delete(state.id);form.remove();}
    if(button.hasAttribute('data-link-summary-current')&&state.latest){state.expected=state.latest.summary;state.needsReview=false;form.querySelector('[data-link-summary-status]').textContent='최신 내용을 확인했어요. 작성 중인 글을 저장하려면 저장을 눌러 주세요.';button.hidden=true;form.querySelector('textarea').focus();}
  }
  function submit(event){const form=event.target.closest?.('[data-link-summary-form]');if(form&&host.contains(form)){event.preventDefault();void save(form);}}
  host.addEventListener('click',click);host.addEventListener('submit',submit);mountedHosts.set(host,action);
  return {clear,hasDraft:()=>states.size>0,edit:id=>open(id),dispose(){clear();if(linkMenu?.active&&host.contains(linkMenu.active.trigger))linkMenu.close(()=>{},false);if(mountedHosts.get(host)===action)mountedHosts.delete(host);host.removeEventListener('click',click);host.removeEventListener('submit',submit);}};
}

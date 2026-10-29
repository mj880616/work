import {emptyHtml} from './wait-state.js';
import './enter-save.js'; // UI-엔터저장: shared Enter-to-save rule for the data-enter-save roots below
import {createAnchoredMenu} from './anchored-menu.js';
import {dueText,bindDue,paintDue} from './meeting-compact.js';
let twUser=null,twBound=false;
const twRuntime=()=>window.KPTURuntime;
async function twApi(path,options={}){const rt=twRuntime();if(!rt?.api)throw new Error('공용 런타임을 불러오지 못했습니다.');return rt.api(path,options)}
async function twLoadContext(){const rt=twRuntime(),shared=rt?.context?.read?.()||window.__KPTU_BOOT_CONTEXT__;if(shared?.user?.id){twUser=shared.user;return true}try{twUser=await twApi('/auth/v1/user');return Boolean(twUser?.id)}catch{return false}}
// UI-회의결과창정리: 후속 할 일은 입력 한 줄(입력칸 + [기한 ▾] + [추가])로 넣고, 넣은 할 일은 할 일 화면과 같은 줄(동그라미·이름·기한·⋯)로 보인다.
// 저장 전 초안이라 동그라미는 표시만 하고, ⋯에서 수정(입력 줄로 다시 올림)·삭제한다. 회의 결과 저장(team.js)이 이 줄들과 입력 줄을 함께 읽는다.
let twSeq=0,twMenu=null;
const twEsc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const twLine=()=>({title:document.querySelector('#meetingActionTitle'),due:document.querySelector('#meetingActionDue')});
function twEmpty(list){if(!list.querySelector('.meeting-action-row'))list.innerHTML=emptyHtml()}
function twActionRow(title,due){const id='a'+(++twSeq),row=document.createElement('div');row.className='gt-row gt-side-row pending meeting-action-row';row.dataset.meetingAction=id;row.dataset.title=title;row.dataset.due=due||'';row.innerHTML=`<span class="gt-check" aria-hidden="true"></span><button class="gt-main" type="button" data-meeting-action-edit="${id}"><b>${twEsc(title)}</b>${due?`<div class="gt-meta"><span class="gt-due">${twEsc(dueText(due))}</span></div>`:''}</button><button class="icon-btn gt-menu-trigger" type="button" data-meeting-action-menu="${id}" aria-label="할 일 관리: ${twEsc(title)}" aria-expanded="false" aria-controls="meetingActionMenu"><span class="more-dots" aria-hidden="true">⋯</span></button>`;return row}
function twAddAction(){const {title,due}=twLine(),list=document.querySelector('#meetingActionList');if(!title||!list)return;const text=title.value.trim();if(!text){title.focus();return}list.querySelector('[data-wait-empty]')?.remove();list.appendChild(twActionRow(text,due?.value||''));title.value='';if(due){due.value='';paintDue(due)}title.focus()}
function twEditAction(row){const {title,due}=twLine();if(!row||!title)return;const list=row.parentElement;title.value=row.dataset.title||'';if(due){due.value=row.dataset.due||'';paintDue(due)}row.remove();if(list)twEmpty(list);document.querySelector('#meetingActionLine')?.classList.remove('hidden');title.focus()}
function twRemoveAction(row){const list=row?.parentElement;row?.remove();if(list)twEmpty(list);twLine().title?.focus()}
function twEnsureMenu(){if(twMenu)return twMenu;twMenu=createAnchoredMenu({id:'meetingActionMenu',className:'gt-task-menu',label:'후속 할 일 관리',historyKey:'kptuMeetingActionMenu',parent:document.querySelector('#meetingModal'),key:trigger=>trigger.dataset.meetingActionMenu,render:()=>'<button type="button" data-meeting-action-do="edit">수정</button><button type="button" class="gt-menu-danger" data-meeting-action-do="delete">삭제</button>',onAction:(button,active)=>{const row=document.querySelector(`#meetingActionList [data-meeting-action="${CSS.escape(active.id)}"]`);if(button.dataset.meetingActionDo==='edit')twEditAction(row);else twRemoveAction(row)}});return twMenu}
function twResetMeetingActions(){const list=document.querySelector('#meetingActionList');if(!list)return;twMenu?.close();list.innerHTML='';twEmpty(list);const {title,due}=twLine();if(title)title.value='';if(due){due.value='';paintDue(due)}document.querySelector('#meetingActionLine')?.classList.remove('hidden')}
// MEET-결과정리 ④: 차수 칸은 만들기 창을 여는 openMeetingModal(team.js)이 비우고 고른 종류의 다음 차수를 제안한다. 여기서 다시 비우면 그 제안이 지워진다.
function twResetMeetingExtras(){const s=document.querySelector('#meetingSeriesName'),f=document.querySelector('#meetingFiles');if(s)s.value='';if(f)f.value='';twResetMeetingActions()}
function twBind(){if(twBound)return;twBound=true;const {title,due}=twLine();bindDue(due);document.querySelector('#addMeetingAction')?.addEventListener('click',()=>{document.querySelector('#meetingActionLine')?.classList.remove('hidden');twLine().title?.focus()});document.querySelector('#meetingActionAdd')?.addEventListener('click',twAddAction);document.querySelector('#meetingActionList')?.addEventListener('click',e=>{const menu=e.target.closest('[data-meeting-action-menu]');if(menu){twEnsureMenu().open(menu);return}const edit=e.target.closest('[data-meeting-action-edit]');if(edit)twEditAction(edit.closest('.meeting-action-row'))});document.addEventListener('click',e=>{if(e.target.closest('#newMeetingBtn'))twResetMeetingExtras()},false)}
async function twInit(){if(!(await twLoadContext()))return false;twResetMeetingActions();twBind();return true}
window.__KPTU_TASK_WORKFLOW_MEETING_UI_ONLY__=true;
window.__KPTU_TASK_WORKFLOW_READY__=twInit().catch(err=>{console.error('task workflow init',err);return false});

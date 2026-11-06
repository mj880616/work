// S51-28 LIB-화면정리 ②(요청 11/06 01:26, 명진 'ㅇㅋ', 시안 docs/design/mockups/library-category-edit.html): '목록 고치기' 창 공용 부품 — 줄 모양(HTML만, 순수 함수).
// 모양 하나: 맨 위 '새 ○○ 이름 [추가]' 칸 → 줄마다 ⠿ 손잡이 · 이름(누르면 그 자리 고침, [완료]·엔터) · 수 · ⋯(작은 메뉴). 고정 줄은 자물쇠 그림 + '고정' 표시만.
// 큰 버튼·빨강·긴 안내문은 없다(지우기는 ⋯ 메뉴의 보통 글자, 누르면 한 번 묻기 — UI-지우기빨강빼기). 끌기·메뉴·창 자리는 list-edit.js, 모양은 list-edit.css.
// 쓰는 곳: 자료실 분류 고치기(document-category-editor.js), 담당조직 쟁의 단계 고치기(org-dispute-stage-ui.js).
import {iconHtml} from './tree-icons.js';
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const attrs=obj=>Object.entries(obj||{}).filter(([,v])=>v!==undefined&&v!==null&&v!==false).map(([k,v])=>v===true?` ${k}`:` ${k}="${esc(v)}"`).join('');

// 맨 위 추가 칸. name: 칸 이름(보이는 placeholder·읽어 주는 이름). formAttrs: 부른 쪽 표시(예 {'data-dce-add':true}).
export function leAddHtml({name,value='',limit=20,disabled=false,inputId='',formAttrs={},inputAttrs={},button='추가'}){
  return `<form class="le-add" data-enter-save${attrs(formAttrs)}><input type="text" class="le-input"${inputId?` id="${esc(inputId)}"`:''}${attrs(inputAttrs)} maxlength="${Math.max(1,limit)}" placeholder="${esc(name)}" aria-label="${esc(name)}" value="${esc(value)}" autocomplete="off"${disabled?' disabled':''}><button type="submit" class="le-add-btn" data-enter-save-submit${disabled?' disabled':''}>${esc(button)}</button></form>`;
}

// 줄 하나. id: 줄 값. label: 읽어 주는 온이름(소분류는 '주간보고 › 확정본'). shown: 보이는 이름. meta: 수 글자.
// drag: ⠿ 손잡이로 끌 수 있음(reorder-drag.js 약속: data-reorder-id·data-reorder-handle). locked: 자물쇠 '고정'(이름·메뉴 없음).
// sub: 들여 쓴 줄(손잡이 자리는 비움). extra: 이름 뒤 작은 표시 HTML(예 '기본' 꼬리표). rowAttrs: 부른 쪽 표시.
export function leRowHtml({id,label,shown=label,meta='',drag=false,locked=false,sub=false,disabled=false,extra='',rowAttrs={}}){
  const cls=`le-row${sub?' le-sub':''}${locked?' le-locked':''}`;
  const handle=drag&&!disabled?`<button type="button" class="le-handle" data-reorder-handle aria-label="${esc(label)} 순서 바꾸기(끌거나 위·아래 화살표)">⠿</button>`:'<span class="le-handle le-handle-off" aria-hidden="true"></span>';
  const name=locked?`<span class="le-name">${esc(shown)}</span>`:`<button type="button" class="le-name" data-le-rename="${esc(id)}" aria-label="${esc(label)} 이름 고치기"${disabled?' disabled':''}>${esc(shown)}</button>`;
  const end=locked?`<span class="le-lock">${iconHtml('lock',{size:12})}고정</span>`:`<button type="button" class="le-more" data-le-menu="${esc(id)}" aria-label="${esc(label)} 더보기" aria-haspopup="true" aria-expanded="false"${disabled?' disabled':''}><span class="more-dots" aria-hidden="true">⋯</span></button>`;
  return `<li class="${cls}"${drag?` data-reorder-id="${esc(id)}"`:''} data-le-row="${esc(id)}"${attrs(rowAttrs)}>${handle}${name}${extra}${meta!==''?`<span class="le-meta">${esc(meta)}</span>`:''}${end}</li>`;
}

// 그 자리 고치기 줄(이름 바꾸기·소분류 만들기). 엔터 = [완료], Esc = 그만(부른 쪽이 keydown으로).
export function leInlineHtml({id='',label,value='',limit=20,sub=false,button='완료',disabled=false,formAttrs={},inputAttrs={}}){
  return `<li class="le-row le-editing${sub?' le-sub':''}"${id?` data-le-row="${esc(id)}"`:''}><span class="le-handle le-handle-off" aria-hidden="true"></span><form class="le-inline" data-enter-save${attrs(formAttrs)}><input type="text" class="le-input" maxlength="${Math.max(1,limit)}" value="${esc(value)}" aria-label="${esc(label)}" placeholder="${esc(label)}" autocomplete="off"${attrs(inputAttrs)}${disabled?' disabled':''}><button type="submit" class="le-done" data-enter-save-submit${disabled?' disabled':''}>${esc(button)}</button></form></li>`;
}

// ⋯ 메뉴 항목(글자만, 같은 색). items: [{key,label}].
export const leMenuHtml=items=>items.map(i=>`<button type="button" data-le-act="${esc(i.key)}">${esc(i.label)}</button>`).join('');

// 줄 하나를 끌어 놓은 자리(그 줄을 뺀 목록 기준 index)로 옮긴 새 순서. ids: 끌 수 있는 줄 순서.
export function leMove(ids,id,index){
  const rest=ids.filter(x=>x!==id);if(rest.length===ids.length)return [...ids];
  const at=Math.max(0,Math.min(rest.length,Number.isInteger(index)?index:rest.length));rest.splice(at,0,id);return rest;
}
// 키보드 위·아래 한 칸.
export function leStep(ids,id,dir){const i=ids.indexOf(id);if(i<0)return [...ids];return leMove(ids,id,Math.max(0,Math.min(ids.length-1,i+(dir<0?-1:1))));}

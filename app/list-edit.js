// S51-28 LIB-화면정리 ②: '목록 고치기' 창 공용 부품 — 움직임. 줄 모양은 list-edit.mjs, 모양은 list-edit.css.
// - ⋯ 작은 메뉴: 공용 anchored-menu.js(누른 자리 아래, Esc·바깥·뒤로가기 닫힘). 항목은 부른 쪽 items(id), 고르면 onAct(id, key, trigger).
// - ⠿ 끌어 순서 바꾸기: 공용 reorder-drag.js(마우스는 손잡이, 폰은 꾹 눌러 끌기, 키보드는 손잡이에서 위·아래). onMove(id, index)·onStep(id, dir).
// 창마다 한 번 mountListEdit(host)를 부른다. 다시 그려도(host.innerHTML) 메뉴·끌기는 그대로 붙어 있다(이벤트를 host에 둠).
import {createAnchoredMenu} from './anchored-menu.js';
import {mountReorder} from './reorder-drag.js';
import {leMenuHtml} from './list-edit.mjs';

export function mountListEdit(host,{key,label,items,onAct,onMove=null,onStep=null,canDrag=()=>true}){
  if(!host||host._listEdit)return host?._listEdit;
  const menu=createAnchoredMenu({id:`${key}Menu`,className:'le-menu',label,historyKey:`kptuListEdit_${key}`,
    parent:trigger=>trigger.closest('dialog,.modal')||document.body,
    key:t=>t.dataset.leMenu,render:id=>leMenuHtml(items(id)),
    onAction:(button,previous)=>onAct(previous.id,button.dataset.leAct,previous.trigger),actDetached:true});
  host.addEventListener('click',e=>{const b=e.target.closest('[data-le-menu]');if(b&&host.contains(b)&&!b.disabled){e.preventDefault();menu.open(b)}});
  if(onMove)mountReorder(host,{listSelector:'[data-reorder-list]',itemSelector:'[data-reorder-id]',handleSelector:'[data-reorder-handle]',
    onDrop:({id,index})=>onMove(id,index),onStep:(id,dir)=>onStep?.(id,dir),canDrag});
  host._listEdit={menu};
  return host._listEdit;
}

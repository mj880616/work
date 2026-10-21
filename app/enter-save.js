// UI-엔터저장: one shared Enter-to-save rule for every add/edit window and side edit panel.
// A window or panel opts in by declaration only: put data-enter-save on its root, and mark its save button
// with data-enter-save-submit (or give the root's attribute a selector: data-enter-save="#saveBtn").
//   one-line field (title, 차수, time, due…)   Enter = save (PC and phone)
//   many-line field (textarea, contenteditable) Enter = new line; Ctrl+Enter (Cmd+Enter on Mac) = save on PC only
// Never while Korean is being composed, never twice for one press, never when the save button is disabled or busy,
// and never from a select, checkbox, button, date picker, an open autocomplete list, or a field that already used
// the Enter (defaultPrevented). A field can opt out with data-enter-save="off"; an <input> that holds several lines'
// worth of meaning can ask for the many-line rule with data-enter-save="multiline".
// The save button shows a small hint on PC while a field in the window is focused: ↵ or Ctrl+↵ (⌘↵ on Mac).

const ONE_LINE_TYPES=new Set(['','text','search','email','url','tel','number','password']);

// 'single' | 'multi' | null (Enter is not ours here).
export function fieldKind(el){
  if(!el||el.nodeType!==1)return null;
  const own=el.getAttribute('data-enter-save');
  if(own==='off')return null;
  if(el.closest?.('[data-enter-save="off"]'))return null;
  const tag=el.tagName;
  if(tag==='TEXTAREA')return el.readOnly||el.disabled?null:'multi';
  if(el.isContentEditable)return 'multi';
  if(tag!=='INPUT')return null;
  if(el.readOnly||el.disabled)return null;
  const type=(el.getAttribute('type')||'').toLowerCase();
  if(!ONE_LINE_TYPES.has(type))return null; // date/time pickers, checkbox, radio, file, range, color, buttons
  if(el.getAttribute('list'))return null;    // a native suggestion list uses Enter to pick
  if(el.getAttribute('aria-expanded')==='true'||el.getAttribute('aria-activedescendant'))return null; // open autocomplete
  return own==='multiline'?'multi':'single';
}

const isMac=()=>typeof navigator!=='undefined'&&/Mac|iPhone|iPad|iPod/.test(navigator.platform||navigator.userAgent||'');

// The pure decision for one keydown. `pc` is true on a device with a fine pointer and hover (a real keyboard).
export function enterAction(event,kind,{pc=true}={}){
  if(!event||event.key!=='Enter'||!kind)return false;
  if(event.isComposing||event.keyCode===229)return false; // Korean (or any IME) still composing
  if(event.repeat||event.defaultPrevented)return false;
  if(event.shiftKey||event.altKey)return false;
  const mod=!!(event.ctrlKey||event.metaKey);
  if(kind==='single')return true;
  return mod&&pc;
}

export function hintText(kind,{pc=true,mac=isMac()}={}){
  if(!pc||!kind)return '';
  return kind==='single'?'↵':(mac?'⌘↵':'Ctrl+↵');
}

export function saveButtonFor(root){
  if(!root)return null;
  const sel=root.getAttribute('data-enter-save');
  if(sel&&sel!=='off'&&sel!=='multiline'&&sel.trim()){
    try{const inside=root.querySelector(sel);if(inside)return inside;return root.ownerDocument.querySelector(sel)}catch{return null}
  }
  return [...root.querySelectorAll('[data-enter-save-submit]')].find(b=>b.closest('[data-enter-save]:not([data-enter-save="off"]):not([data-enter-save="multiline"])')===root)||null;
}

export function buttonReady(button){
  if(!button||!button.isConnected)return false;
  if(button.disabled||button.getAttribute('aria-disabled')==='true'||button.getAttribute('aria-busy')==='true')return false;
  if(button.closest('.hidden,[hidden],[inert]'))return false;
  return button.getClientRects?.().length!==0;
}

export const containerOf=el=>el?.closest?.('[data-enter-save]:not([data-enter-save="off"]):not([data-enter-save="multiline"])')||null;

export function installEnterSave(doc=globalThis.document){
  if(!doc||doc.__kptuEnterSave)return;doc.__kptuEnterSave=true;
  const win=doc.defaultView;
  const pcQuery=win?.matchMedia?.('(hover:hover) and (pointer:fine)');
  const pc=()=>!!pcQuery?.matches;
  const pending=new WeakSet();
  let hinted=null;
  const clearHint=()=>{hinted?.removeAttribute('data-enter-hint');hinted=null};
  const paintHint=target=>{
    const root=containerOf(target),button=root&&saveButtonFor(root),text=button?hintText(fieldKind(target),{pc:pc()}):'';
    if(hinted&&hinted!==button)clearHint();
    if(!button||!text){clearHint();return}
    button.setAttribute('data-enter-hint',text);hinted=button;
  };
  doc.addEventListener('focusin',e=>paintHint(e.target));
  doc.addEventListener('focusout',e=>{if(!e.relatedTarget)queueMicrotask(()=>{if(!containerOf(doc.activeElement))clearHint()})});
  doc.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    const target=e.target,root=containerOf(target);if(!root)return;
    const kind=fieldKind(target);
    if(!enterAction(e,kind,{pc:pc()}))return;
    const button=saveButtonFor(root);if(!buttonReady(button)||pending.has(button))return;
    e.preventDefault();
    pending.add(button);
    // Let other Enter listeners on this same press finish first (the time cell tidies 930 → 09:30 on Enter).
    win.setTimeout(()=>{pending.delete(button);if(buttonReady(button))button.click()},0);
  });
}

if(typeof document!=='undefined')installEnterSave(document);

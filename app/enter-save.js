// UI-엔터저장: one shared Enter-to-save rule for every add/edit window and side edit panel.
// Opt in by declaration only, never by a per-screen key handler:
//   data-enter-save              on the window/panel/form root. Its save button is the descendant marked
//                                data-enter-save-submit, or the selector given as the value (data-enter-save="#saveBtn"),
//                                or for a <form> its submit button. Roots may nest (an inline "add a line" row inside a
//                                window): the nearest root wins.
//   data-enter-field="off"       on a field or a region: Enter is not ours there (big editors, pickers with their own Enter).
//   data-enter-field="single"    a <textarea> that holds one line (Enter saves, the line never gets a break).
//   data-enter-field="multi"     an <input> that should follow the many-line rule.
//   data-enter-save-submit="nohint" an icon-only save button: same rule, no visible hint.
// Rule:
//   one-line field (title, 차수, time, due…)   Enter = save (PC and phone)
//   many-line field (textarea, contenteditable) Enter = new line; Ctrl+Enter (Cmd+Enter on Mac) = save
//   A phone's on-screen keyboard has no Ctrl/Cmd, so there Enter in a many-line field only ever adds a line. A touch
//   device with a real keyboard (tablet, touch laptop) gets the PC shortcut; only the hint is limited to PC.
// Never while Korean is being composed (isComposing / keyCode 229 — Chrome then sends a second, plain Enter once the
// syllable is committed, and only that one saves, so nothing is left over), never twice for one press (repeat, and one
// pending click per button), never when the save button is disabled, aria-disabled or aria-busy, and never from a
// select, checkbox, radio, button, file or date picker, an input with an open suggestion list, or when another listener
// already used the Enter (defaultPrevented).
// While a field in a root is focused on PC, its save button carries data-enter-hint (↵, Ctrl+↵ or ⌘↵); ui-standard.css
// draws it.

const ONE_LINE_TYPES=new Set(['','text','search','email','url','tel','number','password']);

// 'single' | 'multi' | null (Enter is not ours here).
export function fieldKind(el){
  if(!el||el.nodeType!==1)return null;
  if(el.closest('[data-enter-field="off"]'))return null;
  const want=el.getAttribute('data-enter-field');
  const tag=el.tagName;
  if(tag==='TEXTAREA'){if(el.readOnly||el.disabled)return null;return want==='single'?'single':'multi'}
  if(el.isContentEditable)return 'multi';
  if(tag!=='INPUT'||el.readOnly||el.disabled)return null;
  const type=(el.getAttribute('type')||'').toLowerCase();
  if(!ONE_LINE_TYPES.has(type))return null; // date/datetime pickers, checkbox, radio, file, range, color, buttons, hidden
  if(el.getAttribute('list'))return null;    // a native suggestion list picks with Enter
  if(el.getAttribute('aria-expanded')==='true'||el.getAttribute('aria-activedescendant'))return null; // open autocomplete
  return want==='multi'?'multi':'single';
}

// The decision for one keydown.
export function enterAction(event,kind){
  if(!event||event.key!=='Enter'||!kind)return false;
  if(event.isComposing||event.keyCode===229)return false;
  if(event.repeat||event.defaultPrevented)return false;
  if(event.shiftKey||event.altKey)return false;
  if(kind==='single')return true;
  return !!(event.ctrlKey||event.metaKey);
}

export const isMacPlatform=nav=>/Mac|iPhone|iPad|iPod/.test(nav?.platform||nav?.userAgent||'');

export function hintText(kind,{pc=true,mac=false}={}){
  if(!pc||!kind)return '';
  return kind==='single'?'↵':(mac?'⌘↵':'Ctrl+↵');
}

export const containerOf=el=>el?.closest?.('[data-enter-save]')||null;

export function saveButtonFor(root){
  if(!root)return null;
  const sel=(root.getAttribute('data-enter-save')||'').trim();
  if(sel){try{return root.querySelector(sel)||root.ownerDocument.querySelector(sel)}catch{return null}}
  const own=[...root.querySelectorAll('[data-enter-save-submit]')].find(b=>containerOf(b)===root);
  if(own)return own;
  if(root.tagName==='FORM')return [...root.querySelectorAll('button[type="submit"],input[type="submit"]')].find(b=>containerOf(b)===root)||null;
  return null;
}

export function shown(button){
  if(!button||!button.isConnected||button.closest('.hidden,[hidden],[inert]'))return false;
  return !button.getClientRects||button.getClientRects().length>0;
}

export function buttonReady(button){
  if(!shown(button))return false;
  return !(button.disabled||button.getAttribute('aria-disabled')==='true'||button.getAttribute('aria-busy')==='true');
}

export function installEnterSave(doc=globalThis.document){
  if(!doc||doc.__kptuEnterSave)return;doc.__kptuEnterSave=true;
  const win=doc.defaultView||globalThis;
  const pcQuery=win.matchMedia?.('(hover:hover) and (pointer:fine)');
  const pc=()=>!!pcQuery?.matches;
  const mac=isMacPlatform(win.navigator);
  const pending=new WeakSet();
  let hinted=null;
  const clearHint=()=>{hinted?.removeAttribute('data-enter-hint');hinted=null};
  // The hint follows the last focused field of a root and stays while focus is anywhere in that root: pressing the save
  // button (or a checkbox, a picker button) must not shrink the button under the pointer between press and release.
  const paintHint=target=>{
    const root=containerOf(target),button=root&&saveButtonFor(root),kind=fieldKind(target);
    if(button&&!kind&&hinted===button)return;
    const text=button&&button.getAttribute('data-enter-save-submit')!=='nohint'?hintText(kind,{pc:pc(),mac}):'';
    if(!button||!text){clearHint();return}
    if(hinted!==button)clearHint();
    button.setAttribute('data-enter-hint',text);hinted=button;
  };
  doc.addEventListener('focusin',e=>paintHint(e.target));
  doc.addEventListener('focusout',e=>{if(!e.relatedTarget)setTimeout(()=>{const root=containerOf(doc.activeElement);if(!root||saveButtonFor(root)!==hinted)clearHint()},0)});
  doc.addEventListener('keydown',e=>{
    if(e.key!=='Enter')return;
    const target=e.target,root=containerOf(target);if(!root)return;
    const kind=fieldKind(target);
    if(!enterAction(e,kind))return;
    const button=saveButtonFor(root);
    // A root whose save button is not on screen (a detail in read mode, an editor still closed) is not a save target.
    if(!shown(button))return;
    // From here the press is ours: a one-line field never takes a line break and never falls back to the browser's
    // own form submit, even while the button waits (disabled or busy) for the save before it.
    e.preventDefault();
    if(!buttonReady(button)||pending.has(button))return;
    pending.add(button);
    // Let other Enter listeners of this same press finish first (a time cell tidies 930 → 09:30 on Enter), then do what a
    // click does: focus leaves the field (its change handlers run, e.g. the event end follows the start), the button is
    // pressed. If the window is still open with the button focused (a failed check, a panel that stays), go back to the field.
    setTimeout(()=>{
      pending.delete(button);if(!buttonReady(button))return;
      button.focus({preventScroll:true});button.click();
      if(doc.activeElement===button&&target.isConnected&&!target.disabled&&shown(target))target.focus({preventScroll:true});
    },0);
  });
}

if(typeof document!=='undefined')installEnterSave(document);

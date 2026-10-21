// UI-엔터저장: the shared Enter-to-save rule (app/enter-save.js). Plain objects stand in for the DOM.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fieldKind,enterAction,hintText,isMacPlatform,saveButtonFor,containerOf,buttonReady,installEnterSave} from '../app/enter-save.js';

// A tiny element: attributes, a parent chain for closest(), and querySelectorAll over children for [attr] selectors.
class El{
  constructor(tag,attrs={},children=[]){this.nodeType=1;this.tagName=tag.toUpperCase();this.attrs={...attrs};this.children=[];this.parent=null;this.disabled=!!attrs.disabled;this.readOnly=!!attrs.readonly;this.isContentEditable=attrs.contenteditable==='true';this.clicks=0;this.isConnected=true;this.rects=1;children.forEach(c=>this.append(c));}
  append(c){c.parent=this;this.children.push(c);return c}
  getAttribute(n){return n in this.attrs?String(this.attrs[n]):null}
  setAttribute(n,v){this.attrs[n]=String(v)}
  removeAttribute(n){delete this.attrs[n]}
  hasAttribute(n){return n in this.attrs}
  matches(sel){return sel.split(',').some(one=>match(this,one.trim()))}
  closest(sel){for(let el=this;el;el=el.parent)if(el.matches(sel))return el;return null}
  all(){return this.children.flatMap(c=>[c,...c.all()])}
  querySelectorAll(sel){return this.all().filter(el=>el.matches(sel))}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null}
  getClientRects(){return {length:this.rects}}
  click(){this.clicks++}
  get ownerDocument(){return {querySelector:()=>null}}
}
// Supports: tag, .class, #id, [attr], [attr="v"], tag[attr="v"], and :not(...)-free combinations used here.
function match(el,sel){
  const m=sel.match(/^([a-z]*)((?:\.[\w-]+|#[\w-]+|\[[^\]]+\])*)$/i);if(!m)return false;
  if(m[1]&&el.tagName!==m[1].toUpperCase())return false;
  for(const part of m[2].match(/\.[\w-]+|#[\w-]+|\[[^\]]+\]/g)||[]){
    if(part[0]==='.'){if(!(el.getAttribute('class')||'').split(/\s+/).includes(part.slice(1)))return false}
    else if(part[0]==='#'){if(el.getAttribute('id')!==part.slice(1))return false}
    else{const [,name,value]=part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);if(!el.hasAttribute(name))return false;if(value!==undefined&&el.getAttribute(name)!==value)return false}
  }
  return true;
}
const key=(o={})=>({key:'Enter',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,isComposing:false,keyCode:13,repeat:false,defaultPrevented:false,...o});

test('한 줄 칸과 여러 줄 칸 구분', () => {
  for (const type of [undefined,'text','search','email','url','tel','number','password']) assert.equal(fieldKind(new El('input',type?{type}:{})),'single',String(type));
  assert.equal(fieldKind(new El('textarea')),'multi');
  assert.equal(fieldKind(new El('div',{contenteditable:'true'})),'multi');
  assert.equal(fieldKind(new El('textarea',{'data-enter-field':'single'})),'single');
  assert.equal(fieldKind(new El('input',{'data-enter-field':'multi'})),'multi');
});

test('고르기·체크·버튼·날짜 고르기·자동완성 목록·끈 칸에서는 엔터 저장 안 함', () => {
  for (const type of ['checkbox','radio','button','submit','file','range','color','date','datetime-local','month','week','time','hidden'])
    assert.equal(fieldKind(new El('input',{type})),null,type);
  for (const tag of ['select','button','a','div']) assert.equal(fieldKind(new El(tag)),null,tag);
  assert.equal(fieldKind(new El('input',{list:'kinds'})),null,'datalist');
  assert.equal(fieldKind(new El('input',{'aria-expanded':'true'})),null,'open combobox');
  assert.equal(fieldKind(new El('input',{'aria-expanded':'false'})),'single','closed combobox');
  assert.equal(fieldKind(new El('input',{'aria-activedescendant':'opt-2'})),null,'list item highlighted');
  assert.equal(fieldKind(new El('input',{disabled:true})),null);
  assert.equal(fieldKind(new El('textarea',{readonly:true})),null);
  const off=new El('div',{'data-enter-field':'off'},[new El('textarea')]);
  assert.equal(fieldKind(off.children[0]),null,'region opted out');
  assert.equal(fieldKind(null),null);
});

test('한 줄 칸: 엔터 = 저장(PC·폰), Shift·Alt+엔터는 아님', () => {
  assert.equal(enterAction(key(),'single'),true);
  assert.equal(enterAction(key({ctrlKey:true}),'single'),true);
  assert.equal(enterAction(key({metaKey:true}),'single'),true);
  assert.equal(enterAction(key({shiftKey:true}),'single'),false);
  assert.equal(enterAction(key({altKey:true}),'single'),false);
});

test('여러 줄 칸: 엔터·Shift+엔터 = 줄바꿈, Ctrl/Cmd+엔터 = 저장', () => {
  assert.equal(enterAction(key(),'multi'),false);
  assert.equal(enterAction(key({shiftKey:true}),'multi'),false);
  assert.equal(enterAction(key({ctrlKey:true}),'multi'),true);
  assert.equal(enterAction(key({metaKey:true}),'multi'),true);
  assert.equal(enterAction(key({ctrlKey:true,shiftKey:true}),'multi'),false);
  assert.equal(enterAction(key({ctrlKey:true,altKey:true}),'multi'),false);
});

test('한글 조합 중 엔터·되풀이·이미 쓰인 엔터·다른 키는 저장 안 함', () => {
  for (const kind of ['single','multi']) for (const o of [{isComposing:true},{keyCode:229},{isComposing:true,ctrlKey:true},{keyCode:229,ctrlKey:true},{repeat:true,ctrlKey:true},{defaultPrevented:true,ctrlKey:true},{key:'a',ctrlKey:true},{key:'NumpadEnter'}])
    assert.equal(enterAction(key(o),kind),false,kind+' '+JSON.stringify(o));
  assert.equal(enterAction(key(),null),false);
  assert.equal(enterAction(null,'single'),false);
});

test('저장 버튼 안내: PC만, 한 줄은 ↵, 여러 줄은 Ctrl+↵(Mac ⌘↵)', () => {
  assert.equal(hintText('single'),'↵');
  assert.equal(hintText('multi'),'Ctrl+↵');
  assert.equal(hintText('multi',{mac:true}),'⌘↵');
  assert.equal(hintText('single',{pc:false}),'');
  assert.equal(hintText('multi',{pc:false}),'');
  assert.equal(hintText(null),'');
  assert.equal(isMacPlatform({platform:'MacIntel'}),true);
  assert.equal(isMacPlatform({platform:'Win32'}),false);
  assert.equal(isMacPlatform({platform:'',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)'}),true);
});

test('저장 버튼 찾기: 표시한 버튼, 가까운 묶음 우선, form은 제출 버튼', () => {
  const inner=new El('div',{'data-enter-save':''},[new El('input'),new El('button',{'data-enter-save-submit':'',id:'add'})]);
  const outer=new El('div',{'data-enter-save':''},[new El('input'),inner,new El('button',{'data-enter-save-submit':'',id:'save'})]);
  assert.equal(containerOf(inner.children[0]),inner);
  assert.equal(saveButtonFor(inner).getAttribute('id'),'add');
  assert.equal(saveButtonFor(outer).getAttribute('id'),'save','the inner row\'s button is not the window\'s');
  const form=new El('form',{'data-enter-save':''},[new El('input'),new El('button',{type:'button'}),new El('button',{type:'submit',id:'go'})]);
  assert.equal(saveButtonFor(form).getAttribute('id'),'go');
  const bySelector=new El('div',{'data-enter-save':'[data-basket-save]'},[new El('textarea'),new El('div',{},[new El('button',{'data-basket-save':''})])]);
  assert.ok(saveButtonFor(bySelector).hasAttribute('data-basket-save'));
  assert.equal(saveButtonFor(new El('div',{'data-enter-save':''})),null);
});

test('저장 중·꺼짐·숨김 버튼은 누르지 않음', () => {
  const b=()=>new El('button');
  assert.equal(buttonReady(b()),true);
  assert.equal(buttonReady(Object.assign(b(),{disabled:true})),false);
  assert.equal(buttonReady(new El('button',{'aria-busy':'true'})),false);
  assert.equal(buttonReady(new El('button',{'aria-disabled':'true'})),false);
  assert.equal(buttonReady(Object.assign(b(),{rects:0})),false);
  assert.equal(buttonReady(Object.assign(b(),{isConnected:false})),false);
  const hidden=new El('div',{class:'hidden'},[b()]);assert.equal(buttonReady(hidden.children[0]),false);
  assert.equal(buttonReady(null),false);
});

// The installed listener on a fake document: preventDefault, one click per press, the busy guard, phone vs PC.
function harness({pc=true}={}){
  const listeners={};const timers=[];
  const doc={addEventListener:(t,fn)=>{(listeners[t]||=[]).push(fn)},activeElement:null,defaultView:{matchMedia:()=>({matches:pc}),navigator:{platform:'Win32'}}};
  const realTimeout=globalThis.setTimeout;globalThis.setTimeout=fn=>{timers.push(fn);return timers.length};
  installEnterSave(doc);
  globalThis.setTimeout=realTimeout;
  const fire=(type,target,o={})=>{const e={...key(o),type,target,prevented:false,preventDefault(){this.prevented=true;this.defaultPrevented=true}};(listeners[type]||[]).forEach(fn=>fn(e));return e};
  const flush=()=>{const realT=globalThis.setTimeout;globalThis.setTimeout=fn=>{timers.push(fn);return 0};while(timers.length)timers.shift()();globalThis.setTimeout=realT};
  return {fire,flush,timers,doc,withTimers:fn=>{const realT=globalThis.setTimeout;globalThis.setTimeout=f=>{timers.push(f);return 0};try{return fn()}finally{globalThis.setTimeout=realT}}};
}
function dialog(){
  const title=new El('input'),body=new El('textarea'),save=new El('button',{'data-enter-save-submit':''}),check=new El('input',{type:'checkbox'});
  const root=new El('div',{'data-enter-save':''},[title,body,check,save]);
  return {root,title,body,save,check};
}

test('설치된 규칙: 한 줄 엔터는 한 번만 저장하고, 기본 동작(줄바꿈·폼 제출)을 막음', () => {
  const h=harness(),d=dialog();
  const e=h.withTimers(()=>h.fire('keydown',d.title));
  assert.equal(e.prevented,true);
  const again=h.withTimers(()=>h.fire('keydown',d.title));
  assert.equal(again.prevented,true,'a second press before the click still takes no line break');
  h.flush();
  assert.equal(d.save.clicks,1,'one press, one save');
  h.withTimers(()=>h.fire('keydown',d.title,{isComposing:true}));h.flush();
  assert.equal(d.save.clicks,1,'composing Enter does nothing');
  h.withTimers(()=>h.fire('keydown',d.title));d.save.disabled=true;h.flush();
  assert.equal(d.save.clicks,1,'button went busy before the click: no save');
});

test('설치된 규칙: 저장 중이면 누르지 않고, 여러 줄은 PC Ctrl+엔터만, 체크 칸은 무시', () => {
  const h=harness({pc:true}),d=dialog();
  d.save.disabled=true;
  const busy=h.withTimers(()=>h.fire('keydown',d.title));h.flush();
  assert.equal(busy.prevented,true);assert.equal(d.save.clicks,0);
  d.save.disabled=false;
  const plain=h.withTimers(()=>h.fire('keydown',d.body));h.flush();
  assert.equal(plain.prevented,false,'Enter in the many-line field is a new line');assert.equal(d.save.clicks,0);
  h.withTimers(()=>h.fire('keydown',d.body,{ctrlKey:true}));h.flush();
  assert.equal(d.save.clicks,1);
  const box=h.withTimers(()=>h.fire('keydown',d.check));h.flush();
  assert.equal(box.prevented,false);assert.equal(d.save.clicks,1);
});

test('설치된 규칙(폰): 한 줄 엔터는 저장, 여러 줄 엔터는 줄바꿈 그대로, 안내 없음', () => {
  const h=harness({pc:false}),d=dialog();
  h.withTimers(()=>h.fire('keydown',d.title));h.flush();
  assert.equal(d.save.clicks,1);
  for (const o of [{},{shiftKey:true}]) { const multi=h.withTimers(()=>h.fire('keydown',d.body,o));h.flush();assert.equal(multi.prevented,false,JSON.stringify(o)); }
  assert.equal(d.save.clicks,1);
  h.fire('focusin',d.body);assert.equal(d.save.getAttribute('data-enter-hint'),null);
  // A tablet with a real keyboard: Ctrl/Cmd+Enter is the same shortcut as on PC (an on-screen keyboard has no Ctrl/Cmd).
  h.withTimers(()=>h.fire('keydown',d.body,{metaKey:true}));h.flush();
  assert.equal(d.save.clicks,2);
});

test('설치된 규칙: 저장 버튼이 화면에 없으면(읽기 모드) 엔터를 건드리지 않음', () => {
  const h=harness(),d=dialog();d.save.rects=0;
  const e=h.withTimers(()=>h.fire('keydown',d.title));h.flush();
  assert.equal(e.prevented,false);assert.equal(d.save.clicks,0);
  const outside=new El('input');
  assert.equal(h.withTimers(()=>h.fire('keydown',outside)).prevented,false,'a field outside any root');
});

test('설치된 규칙: 초점 칸에 따라 저장 버튼 안내가 바뀌고, PC가 아니면 안내 없음', () => {
  const h=harness({pc:true}),d=dialog();
  h.fire('focusin',d.title);assert.equal(d.save.getAttribute('data-enter-hint'),'↵');
  h.fire('focusin',d.body);assert.equal(d.save.getAttribute('data-enter-hint'),'Ctrl+↵');
  h.fire('focusin',d.check);assert.equal(d.save.getAttribute('data-enter-hint'),null);
  const icon=new El('button',{'data-enter-save-submit':'nohint'}),editor=new El('div',{'data-enter-save':''},[new El('textarea'),icon]);
  h.fire('focusin',editor.children[0]);assert.equal(icon.getAttribute('data-enter-hint'),null);
  const p=harness({pc:false}),e=dialog();
  p.fire('focusin',e.title);assert.equal(e.save.getAttribute('data-enter-hint'),null);
});

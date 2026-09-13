(()=>{
  'use strict';
  if(window.KPTURichCopy)return;

  const UI_SELECTOR=[
    '.unit-tools','.row-tools','.program-rowbar','.program-row-delete','.table-copy-wrap',
    '.editbar','.jump','.attachment-nav','.kptu-copy-btn','.kptu-copy-wrap',
    'button','input','textarea','select','script','style','noscript'
  ].join(',');
  const KEEP_STYLES=['font-family','font-size','font-weight','font-style','text-decoration','text-align','line-height','color','background-color','white-space','vertical-align'];
  const IS_RAIL_1007=location.pathname.includes('/rail-council/2026-1007-delegates/');

  function flash(btn){
    if(!btn)return;
    const old=btn.textContent;
    btn.textContent='복사됨';
    btn.disabled=true;
    setTimeout(()=>{btn.textContent=old;btn.disabled=false},1100);
  }

  function cleanClone(source){
    const clone=source.cloneNode(true);
    clone.querySelectorAll(UI_SELECTOR).forEach(n=>n.remove());
    clone.removeAttribute?.('contenteditable');
    clone.querySelectorAll('[contenteditable]').forEach(n=>n.removeAttribute('contenteditable'));
    clone.querySelectorAll('[hidden]').forEach(n=>n.removeAttribute('hidden'));

    const srcNodes=[source,...source.querySelectorAll('*')];
    const dstNodes=[clone,...clone.querySelectorAll('*')];
    for(let i=0;i<Math.min(srcNodes.length,dstNodes.length);i++){
      const s=srcNodes[i],d=dstNodes[i];
      if(!(s instanceof Element)||!(d instanceof Element))continue;
      const cs=getComputedStyle(s);
      const style=[];
      KEEP_STYLES.forEach(k=>{const v=cs.getPropertyValue(k);if(v)style.push(`${k}:${v}`)});
      if(['TH','TD'].includes(d.tagName)){
        style.push('border:1.2pt solid #000','padding:5px 7px');
      }
      if(d.tagName==='TABLE'){
        style.push('border-collapse:collapse','width:100%','border:1.2pt solid #000');
        d.setAttribute('border','1');
        d.setAttribute('rules','all');
        d.setAttribute('frame','box');
        d.setAttribute('cellspacing','0');
        d.setAttribute('cellpadding','0');
      }
      if(['P','H1','H2','H3','H4','H5','H6'].includes(d.tagName))style.push('margin-top:0','margin-bottom:8pt');
      d.removeAttribute('class');d.removeAttribute('id');d.removeAttribute('data-editor');
      d.setAttribute('style',style.join(';'));
    }
    return clone;
  }

  function plainTextFrom(clone){
    const host=document.createElement('div');
    host.style.cssText='position:fixed;left:-99999px;top:0;width:800px;opacity:0;pointer-events:none;white-space:normal';
    const c=clone.cloneNode(true);
    host.append(c);document.body.append(host);
    let text=host.innerText||host.textContent||'';
    host.remove();
    return text.replace(/\u00a0/g,' ').replace(/\n{3,}/g,'\n\n').trim();
  }

  async function writeRich(html,text){
    if(navigator.clipboard?.write&&window.ClipboardItem){
      try{
        await navigator.clipboard.write([new ClipboardItem({
          'text/html':new Blob([html],{type:'text/html'}),
          'text/plain':new Blob([text],{type:'text/plain'})
        })]);
        return true;
      }catch(e){}
    }

    const holder=document.createElement('div');
    holder.contentEditable='true';
    holder.setAttribute('aria-hidden','true');
    holder.style.cssText='position:fixed;left:-99999px;top:0;width:800px;opacity:.01;pointer-events:none;';
    holder.innerHTML=html;
    document.body.append(holder);
    const sel=window.getSelection(),range=document.createRange();
    range.selectNodeContents(holder);sel.removeAllRanges();sel.addRange(range);
    let ok=false;
    try{ok=document.execCommand('copy')}catch(e){}
    sel.removeAllRanges();holder.remove();
    if(ok)return true;
    if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);return true}catch(e){}}
    return false;
  }

  async function copyElement(source,btn){
    if(!source)return;
    const clone=cleanClone(source);
    const html=`<div style="font-family:'Malgun Gothic','Noto Sans KR',sans-serif;line-height:1.65">${clone.outerHTML}</div>`;
    const text=plainTextFrom(clone);
    const ok=await writeRich(html,text);
    if(ok)flash(btn);else alert('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요.');
  }

  function sectionFor(btn){
    return btn.closest('.section,.decision,.attachment,.editable-target,section,article');
  }

  function tableFor(btn){
    const wrap=btn.closest('.table-copy-wrap')?.previousElementSibling;
    if(wrap?.matches('.table-wrap'))return wrap.querySelector('table');
    return btn.closest('.section,.decision,section,article')?.querySelector('table');
  }

  function addBtn(parent,label,target,cls='kptu-copy-btn'){
    const b=document.createElement('button');
    b.type='button';b.className=cls;b.textContent=label;b.dataset.kptuRichCopy='1';
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();copyElement(target,b)});
    parent.append(b);return b;
  }

  function enhancePressRelease(){
    document.querySelectorAll('.editbar').forEach(bar=>{
      if(bar.querySelector('.kptu-copy-btn'))return;
      let target=null,label='단락 복사';
      if(bar.id==='editMsg'||bar.querySelector('#editBodyBtn')){target=document.getElementById('pressMain');label='본문 복사'}
      const id=bar.dataset.editor;
      if(id){target=document.getElementById(id+'Content');const eb=bar.querySelector('.edit-attachment');label=(eb?.textContent||'붙임').replace(/\s*수정\s*$/,'')+' 복사'}
      if(target)addBtn(bar,label,target);
    });
  }

  function enhanceRailWholeCopy(){
    if(!IS_RAIL_1007)return;
    const actions=document.querySelector('.page-actions');
    if(!actions)return;
    let b=document.getElementById('railWholeCopy');
    if(!b){
      b=document.createElement('button');
      b.type='button';b.id='railWholeCopy';b.className='action-btn';b.textContent='전체 문서 복사';
      b.addEventListener('click',async e=>{
        e.preventDefault();e.stopPropagation();
        const plan=document.getElementById('editablePlan');
        if(!plan)return;
        const source=document.createElement('div');
        source.style.cssText='position:fixed;left:-99999px;top:0;width:900px;opacity:.01;pointer-events:none;background:#fff;color:#000;padding:0';
        const title=document.createElement('h1');
        title.textContent=document.querySelector('.hero h1')?.textContent||document.title;
        source.append(title);
        const subtitle=document.querySelector('.hero p');
        if(subtitle){const p=document.createElement('p');p.textContent=subtitle.textContent;source.append(p)}
        [...plan.children].forEach(node=>source.append(node.cloneNode(true)));
        document.body.append(source);
        try{await copyElement(source,b)}finally{source.remove()}
      });
    }
    const printBtn=actions.querySelector('#printBtn');
    const editBtn=actions.querySelector('#railEditToggle');
    if(printBtn){
      if(printBtn.nextElementSibling!==b)printBtn.after(b);
    }else if(editBtn){
      actions.insertBefore(b,editBtn);
    }else if(!b.parentElement){
      actions.append(b);
    }
  }

  function enhanceGenericSections(){
    if(IS_RAIL_1007)return;
    document.querySelectorAll('.section,.decision').forEach(sec=>{
      if(sec.querySelector(':scope > h2 .unit-btn.copy')||sec.querySelector(':scope > .kptu-copy-wrap'))return;
      const h=sec.querySelector(':scope > h2');if(!h)return;
      const wrap=document.createElement('div');wrap.className='kptu-copy-wrap';
      addBtn(wrap,'단락 복사',sec);
      sec.insertBefore(wrap,sec.firstChild);
    });
  }

  function enhanceTables(){
    document.querySelectorAll('.table-wrap').forEach(w=>{
      if(w.nextElementSibling?.matches('.table-copy-wrap')||w.nextElementSibling?.matches('.kptu-copy-wrap.table'))return;
      const table=w.querySelector('table');if(!table)return;
      const wrap=document.createElement('div');wrap.className='kptu-copy-wrap table';
      addBtn(wrap,'표 전체 복사',table);
      w.after(wrap);
    });
  }

  function interceptExisting(){
    document.addEventListener('click',e=>{
      const btn=e.target.closest('.unit-btn.copy,.table-copy-btn');
      if(!btn)return;
      e.preventDefault();e.stopImmediatePropagation();
      const target=btn.matches('.table-copy-btn')?tableFor(btn):sectionFor(btn);
      copyElement(target,btn);
    },true);
  }

  function installStyle(){
    if(document.getElementById('kptu-rich-copy-style'))return;
    const s=document.createElement('style');s.id='kptu-rich-copy-style';
    s.textContent=`.kptu-copy-wrap{display:flex;justify-content:flex-end;gap:6px;margin:-4px 0 8px}.kptu-copy-wrap.table{margin:8px 0 2px}.kptu-copy-btn{border:1px solid #c7d3dd;background:#fff;color:#294b69;border-radius:8px;padding:6px 9px;font:inherit;font-size:11px;font-weight:800;cursor:pointer;white-space:nowrap}.editbar .kptu-copy-btn{order:2}.editbar .editmsg{order:0}@media print{.kptu-copy-wrap,.kptu-copy-btn,#railWholeCopy,.unit-tools,.row-tools,.rail-section-edit,.unit-btn.edit,.unit-btn.copy,.table-copy-wrap,.table-copy-btn,.editbar{display:none!important}}`;
    document.head.append(s);
  }

  function enhance(){installStyle();enhanceRailWholeCopy();enhancePressRelease();enhanceGenericSections();enhanceTables()}
  interceptExisting();
  window.KPTURichCopy={copyElement,enhance};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance);else enhance();
  new MutationObserver(()=>{clearTimeout(window.__kptuCopyTimer);window.__kptuCopyTimer=setTimeout(enhance,120)}).observe(document.documentElement,{subtree:true,childList:true});
})();
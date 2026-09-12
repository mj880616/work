(()=>{
  if(window.__KPTU_MEETING_ASSIGNEE_PICKER__)return;
  window.__KPTU_MEETING_ASSIGNEE_PICKER__=true;
  const TEAM='__team__';
  const selector='#mrdTaskAssignee,#meetingTaskAssignee,.meeting-action-assignee';

  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function isDetailEdit(sel){return sel.id==='mrdTaskAssignee'&&/수정/.test(document.querySelector('#mrdTaskSave')?.textContent||'')}
  function memberOptions(sel){return [...sel.options].filter(o=>o.value&&o.value!==TEAM).map(o=>({value:o.value,label:o.textContent.trim()}))}
  function ensureTeamOption(sel){
    const edit=isDetailEdit(sel);
    sel.querySelector(`option[value="${TEAM}"]`)?.remove();
    if(edit)return;
    const o=document.createElement('option');o.value=TEAM;o.textContent='팀 전체';
    if(sel.options.length>0)sel.options[0].insertAdjacentElement('afterend',o);else sel.appendChild(o);
  }
  function labelFor(sel){
    if(sel.value===TEAM)return `팀 전체 (${memberOptions(sel).length}명)`;
    return sel.selectedOptions?.[0]?.textContent?.trim()||'담당자 선택';
  }
  function closeAll(except=null){document.querySelectorAll('.map-picker.open').forEach(x=>{if(x!==except)x.classList.remove('open')})}
  function rebuild(sel){
    if(!sel?.isConnected)return;
    ensureTeamOption(sel);
    let wrap=sel.nextElementSibling;
    if(!wrap?.classList.contains('map-picker')){
      wrap=document.createElement('div');wrap.className='map-picker';
      wrap.innerHTML='<button class="map-picker-btn" type="button" aria-expanded="false"><span>담당자 선택</span><i>⌄</i></button><div class="map-picker-menu"></div>';
      sel.insertAdjacentElement('afterend',wrap);
      wrap.querySelector('.map-picker-btn').addEventListener('click',e=>{
        e.preventDefault();e.stopPropagation();
        const willOpen=!wrap.classList.contains('open');closeAll(wrap);wrap.classList.toggle('open',willOpen);e.currentTarget.setAttribute('aria-expanded',String(willOpen));
        if(willOpen)rebuild(sel);
      });
      wrap.querySelector('.map-picker-menu').addEventListener('click',e=>{
        const b=e.target.closest('[data-map-value]');if(!b)return;
        sel.value=b.dataset.mapValue;sel.dispatchEvent(new Event('change',{bubbles:true}));
        wrap.classList.remove('open');wrap.querySelector('.map-picker-btn').setAttribute('aria-expanded','false');rebuild(sel);
      });
      sel.classList.add('map-native-select');
    }
    const edit=isDetailEdit(sel), members=memberOptions(sel);
    const items=[];
    if(!edit)items.push({value:TEAM,label:`팀 전체`,sub:`현재 팀원 ${members.length}명에게 각각 배정`});
    items.push(...members.map(x=>({...x,sub:''})));
    wrap.querySelector('.map-picker-btn span').textContent=labelFor(sel);
    wrap.querySelector('.map-picker-menu').innerHTML=items.length?items.map(x=>`<button type="button" data-map-value="${esc(x.value)}" class="${sel.value===x.value?'active':''}"><span>${esc(x.label)}</span>${x.sub?`<small>${esc(x.sub)}</small>`:''}</button>`).join(''):'<div class="map-picker-empty">선택할 팀원이 없습니다.</div>';
  }
  function enhance(){document.querySelectorAll(selector).forEach(rebuild)}

  if(!document.querySelector('#mapPickerStyle')){
    const s=document.createElement('style');s.id='mapPickerStyle';s.textContent=`
.map-native-select{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;margin:0!important;padding:0!important}
.map-picker{position:relative;width:100%;font-weight:700;color:#26313d}
.map-picker-btn{width:100%!important;min-height:40px!important;height:40px!important;padding:0 11px!important;border:1px solid #cfd7df!important;border-radius:10px!important;background:#fff!important;color:#26313d!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;font-size:12px!important;text-align:left!important}
.map-picker-btn i{font-style:normal;color:#71808d;font-size:12px}
.map-picker-menu{display:none;position:absolute;z-index:140;left:0;right:0;top:calc(100% + 5px);max-height:190px;overflow:auto;padding:5px;background:#fff;border:1px solid #d8dfe6;border-radius:10px;box-shadow:0 10px 28px rgba(23,37,52,.16)}
.map-picker.open .map-picker-menu{display:grid;gap:2px}
.map-picker-menu button{width:100%!important;min-height:34px!important;height:auto!important;padding:6px 8px!important;border:0!important;border-radius:7px!important;background:#fff!important;color:#35414d!important;text-align:left!important;display:block!important;font-size:11px!important;font-weight:750!important;line-height:1.25!important}
.map-picker-menu button.active,.map-picker-menu button:active{background:#edf3f8!important;color:#1d3557!important}
.map-picker-menu small{display:block;margin-top:2px;color:#7d8995;font-size:9px;font-weight:600}
.map-picker-empty{padding:9px;color:#7d8995;font-size:11px}
@media(max-width:700px){.map-picker-btn{min-height:38px!important;height:38px!important;font-size:11.5px!important}.map-picker-menu{max-height:170px}.map-picker-menu button{min-height:32px!important;padding:6px 8px!important;font-size:10.5px!important}}
`;
    document.head.appendChild(s);
  }

  const originalFetch=window.fetch.bind(window);
  window.fetch=async function(input,init={}){
    const url=typeof input==='string'?input:(input?.url||'');
    const method=String(init.method||'GET').toUpperCase();
    if(url.includes('/rest/v1/app_tasks')&&method==='POST'&&typeof init.body==='string'){
      let payload=null;try{payload=JSON.parse(init.body)}catch{}
      if(payload&&!Array.isArray(payload)&&payload.source_type==='meeting'&&payload.assignee_id===TEAM){
        const activeSelect=[...document.querySelectorAll(selector)].find(s=>s.value===TEAM);
        const members=activeSelect?memberOptions(activeSelect).map(x=>x.value):[];
        if(members.length){
          let first=null;
          for(const uid of members){
            const r=await originalFetch(input,{...init,body:JSON.stringify({...payload,assignee_id:uid})});
            if(!first)first=r;
            if(!r.ok)return r;
          }
          return first;
        }
      }
    }
    return originalFetch(input,init);
  };

  document.addEventListener('click',e=>{if(!e.target.closest('.map-picker'))closeAll()});
  const mo=new MutationObserver(()=>{clearTimeout(mo.t);mo.t=setTimeout(enhance,25)});
  mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  setTimeout(enhance,0);
})();

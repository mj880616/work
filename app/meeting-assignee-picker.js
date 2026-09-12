(()=>{
  if(window.__KPTU_MEETING_ASSIGNEE_PICKER_V2__)return;
  window.__KPTU_MEETING_ASSIGNEE_PICKER_V2__=true;
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
    if(sel.options.length)sel.options[0].insertAdjacentElement('afterend',o);else sel.appendChild(o);
  }
  function labelFor(sel){
    if(sel.value===TEAM)return `팀 전체 (${memberOptions(sel).length}명)`;
    return sel.selectedOptions?.[0]?.textContent?.trim()||'담당자 선택';
  }
  function closeAll(except=null){document.querySelectorAll('.map-picker.open').forEach(x=>{if(x!==except){x.classList.remove('open');x.querySelector('.map-picker-btn')?.setAttribute('aria-expanded','false')}})}
  function bindLabelGuard(sel,wrap){
    const label=sel.closest('label');
    if(!label||label.dataset.mapGuard==='1')return;
    label.dataset.mapGuard='1';
    label.addEventListener('click',e=>{
      if(e.target===label||e.target.closest('.map-picker'))e.preventDefault();
    },true);
  }
  function rebuild(sel){
    if(!sel?.isConnected)return;
    ensureTeamOption(sel);
    sel.classList.add('map-native-select');
    sel.setAttribute('tabindex','-1');
    sel.setAttribute('aria-hidden','true');
    let wrap=sel.nextElementSibling;
    if(!wrap?.classList.contains('map-picker')){
      wrap=document.createElement('div');wrap.className='map-picker';
      wrap.innerHTML='<button class="map-picker-btn" type="button" aria-expanded="false"><span>담당자 선택</span><i>⌄</i></button><div class="map-picker-menu"></div>';
      sel.insertAdjacentElement('afterend',wrap);
      bindLabelGuard(sel,wrap);
      wrap.querySelector('.map-picker-btn').addEventListener('click',e=>{
        e.preventDefault();e.stopPropagation();
        const willOpen=!wrap.classList.contains('open');closeAll(wrap);wrap.classList.toggle('open',willOpen);e.currentTarget.setAttribute('aria-expanded',String(willOpen));
        if(willOpen)rebuild(sel);
      });
      wrap.querySelector('.map-picker-menu').addEventListener('click',e=>{
        const b=e.target.closest('[data-map-value]');if(!b)return;
        e.preventDefault();e.stopPropagation();
        sel.value=b.dataset.mapValue;sel.dispatchEvent(new Event('change',{bubbles:true}));
        wrap.classList.remove('open');wrap.querySelector('.map-picker-btn').setAttribute('aria-expanded','false');rebuild(sel);
      });
    }else bindLabelGuard(sel,wrap);
    const edit=isDetailEdit(sel),members=memberOptions(sel),items=[];
    if(!edit)items.push({value:TEAM,label:'팀 전체',sub:`현재 팀원 ${members.length}명에게 각각 배정`});
    items.push(...members.map(x=>({...x,sub:''})));
    wrap.querySelector('.map-picker-btn span').textContent=labelFor(sel);
    wrap.querySelector('.map-picker-menu').innerHTML=items.length?items.map(x=>`<button type="button" data-map-value="${esc(x.value)}" class="${sel.value===x.value?'active':''}"><span>${esc(x.label)}</span>${x.sub?`<small>${esc(x.sub)}</small>`:''}</button>`).join(''):'<div class="map-picker-empty">선택할 팀원이 없습니다.</div>';
  }
  function enhance(){document.querySelectorAll(selector).forEach(rebuild)}

  if(!document.querySelector('#mapPickerStyleV2')){
    document.querySelector('#mapPickerStyle')?.remove();
    const s=document.createElement('style');s.id='mapPickerStyleV2';s.textContent=`
.map-native-select{display:none!important;visibility:hidden!important;pointer-events:none!important;appearance:none!important;-webkit-appearance:none!important}
.map-picker{position:relative;width:100%;font-weight:700;color:#26313d;margin:0}
.map-picker-btn{width:100%!important;min-height:34px!important;height:34px!important;padding:0 9px!important;border:1px solid #cfd7df!important;border-radius:9px!important;background:#fff!important;color:#26313d!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:7px!important;font-size:11px!important;text-align:left!important;line-height:1!important}
.map-picker-btn i{font-style:normal;color:#71808d;font-size:10px}
.map-picker-menu{display:none;position:absolute;z-index:240;left:0;right:0;top:calc(100% + 4px);max-height:148px;overflow:auto;padding:4px;background:#fff;border:1px solid #d8dfe6;border-radius:9px;box-shadow:0 8px 22px rgba(23,37,52,.16)}
.map-picker.open .map-picker-menu{display:grid;gap:1px}
.map-picker-menu button{width:100%!important;min-height:28px!important;height:auto!important;padding:5px 7px!important;border:0!important;border-radius:6px!important;background:#fff!important;color:#35414d!important;text-align:left!important;display:block!important;font-size:10.5px!important;font-weight:750!important;line-height:1.2!important}
.map-picker-menu button.active,.map-picker-menu button:active{background:#edf3f8!important;color:#1d3557!important}
.map-picker-menu small{display:block;margin-top:1px;color:#7d8995;font-size:8.5px;font-weight:600}
.map-picker-empty{padding:7px;color:#7d8995;font-size:10px}
#meetingRoundDetailModal .mrd-task-form label:has(.map-picker),#meetingModal label:has(.map-picker){gap:4px!important}
@media(max-width:700px){.map-picker-btn{min-height:33px!important;height:33px!important;font-size:10.5px!important}.map-picker-menu{max-height:136px}.map-picker-menu button{min-height:27px!important;padding:4px 7px!important;font-size:10px!important}}
`;
    document.head.appendChild(s);
  }

  const originalFetch=window.fetch.bind(window);
  if(!window.__KPTU_MEETING_TEAM_FETCH_V2__){
    window.__KPTU_MEETING_TEAM_FETCH_V2__=true;
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
  }

  document.addEventListener('click',e=>{if(!e.target.closest('.map-picker'))closeAll()});
  const mo=new MutationObserver(()=>{clearTimeout(mo.t);mo.t=setTimeout(enhance,20)});
  mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  setInterval(enhance,700);
  setTimeout(enhance,0);
})();

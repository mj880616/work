(()=>{
  if(window.__KPTU_DUE_DATE_CALENDAR__)return;
  window.__KPTU_DUE_DATE_CALENDAR__=true;

  function dateOnly(v){
    if(!v)return '';
    const s=String(v);
    const m=s.match(/^(\d{4}-\d{2}-\d{2})/);
    if(m)return m[1];
    const d=new Date(v);
    if(Number.isNaN(d.getTime()))return '';
    const p=n=>String(n).padStart(2,'0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  }

  function isDueInput(el){
    if(!(el instanceof HTMLInputElement))return false;
    if(el.type==='hidden')return false;
    const key=[el.id,el.name,el.className].join(' ').toLowerCase();
    if(/due|deadline|기한/.test(key))return true;
    const label=el.closest('label');
    const labelText=label?.childNodes?.[0]?.textContent?.trim()||label?.textContent?.trim()||'';
    return /^기한\b/.test(labelText);
  }

  function enhance(el){
    if(!isDueInput(el))return;
    if(el.type!=='date'){
      const v=dateOnly(el.value);
      try{el.type='date'}catch(_){}
      if(v)el.value=v;
    }else if(el.value){
      const v=dateOnly(el.value);if(v&&v!==el.value)el.value=v;
    }
    el.setAttribute('aria-label',el.getAttribute('aria-label')||'기한 날짜');
    if(!el.dataset.dueCalendar){
      el.dataset.dueCalendar='1';
      const open=()=>{try{el.showPicker?.()}catch(_){}};
      el.addEventListener('click',open);
      el.addEventListener('focus',open);
    }
  }

  function scan(root=document){
    root.querySelectorAll?.('input').forEach(enhance);
  }

  const s=document.createElement('style');
  s.id='dueDateCalendarStyle';
  s.textContent=`
input[data-due-calendar="1"]{
  cursor:pointer!important;
}
input[data-due-calendar="1"]::-webkit-calendar-picker-indicator{
  opacity:1!important;
  cursor:pointer!important;
}
`;
  document.head.appendChild(s);

  scan();
  const mo=new MutationObserver(ms=>{
    for(const m of ms){
      m.addedNodes.forEach(n=>{
        if(n.nodeType!==1)return;
        if(n.matches?.('input'))enhance(n);
        scan(n);
      });
    }
  });
  mo.observe(document.documentElement,{childList:true,subtree:true});
  window.addEventListener('kptu:tasks-changed',()=>scan());
})();

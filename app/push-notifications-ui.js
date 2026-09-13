(()=>{
  'use strict';
  if(window.__KPTU_PUSH_UI__)return;
  window.__KPTU_PUSH_UI__=true;
  const rt=window.KPTURuntime;
  const endpoint=action=>`/functions/v1/push-notifications?action=${encodeURIComponent(action)}`;
  const isNativeAndroid=/KPTUAndroid\//i.test(navigator.userAgent||'');
  const supported=()=>('Notification' in window)&&('serviceWorker' in navigator)&&('PushManager' in window);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function vapidBytes(value){
    const pad='='.repeat((4-value.length%4)%4),base64=(value+pad).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64),out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
    return out;
  }

  function style(){
    if(document.querySelector('#pushUiStyle'))return;
    const s=document.createElement('style');s.id='pushUiStyle';s.textContent=`
      .push-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.push-copy{min-width:0}.push-copy b{display:block;font-size:13px}.push-copy p{margin:4px 0 0;color:var(--muted);font-size:11px;line-height:1.45}.push-actions{display:flex;gap:6px;flex:0 0 auto}.push-state{margin-top:8px;font-size:10.5px;color:var(--muted)}.push-state.ok{color:#3f7042}.push-state.warn{color:#8a5b17}.push-state.error{color:#a33b45}@media(max-width:700px){.push-row{align-items:flex-start;flex-direction:column}.push-actions{width:100%}.push-actions button{flex:1}}
    `;document.head.appendChild(s);
  }

  function panel(){
    const grid=document.querySelector('#profileView .ps-profile-grid');if(!grid)return null;
    let p=document.querySelector('#pushSettingsPanel');
    if(!p){
      p=document.createElement('article');p.className='panel';p.id='pushSettingsPanel';
      p.innerHTML='<div class="push-row"><div class="push-copy"><h3 style="margin:0">푸시 알림</h3><p>새 메시지와 새 할 일 배정을 기기 알림으로 받습니다.</p></div><div class="push-actions"><button id="pushEnableBtn" class="secondary" type="button">알림 허용</button><button id="pushDisableBtn" class="ghost hidden" type="button">해제</button></div></div><div id="pushState" class="push-state">상태 확인 중…</div>';
      const first=grid.firstElementChild;first?.insertAdjacentElement('afterend',p)||grid.appendChild(p);
      p.querySelector('#pushEnableBtn').onclick=enable;
      p.querySelector('#pushDisableBtn').onclick=disable;
    }
    return p;
  }

  function setState(text,kind=''){
    const el=document.querySelector('#pushState');if(!el)return;el.className='push-state'+(kind?' '+kind:'');el.textContent=text;
  }

  async function registration(){
    let reg=await navigator.serviceWorker.getRegistration('./');
    if(!reg)reg=await navigator.serviceWorker.register('./sw.js?v=2',{scope:'./'});
    await navigator.serviceWorker.ready;
    return reg;
  }

  async function status(){
    panel();
    if(isNativeAndroid&&!supported()){
      document.querySelector('#pushEnableBtn')?.classList.add('hidden');
      document.querySelector('#pushDisableBtn')?.classList.add('hidden');
      setState('현재 Android 앱은 웹 푸시를 지원하지 않아 네이티브 알림 연결이 추가로 필요합니다.','warn');
      return;
    }
    if(!supported()){
      document.querySelector('#pushEnableBtn')?.classList.add('hidden');
      setState('이 환경에서는 푸시 알림을 사용할 수 없습니다.','warn');return;
    }
    if(!rt?.session||!(await rt.session.ensure()))return;
    try{
      const d=await rt.api(endpoint('status'));
      const enabled=!!d?.enabled;
      const on=document.querySelector('#pushEnableBtn'),off=document.querySelector('#pushDisableBtn');
      if(on){on.classList.toggle('hidden',enabled);on.textContent=Notification.permission==='denied'?'알림 차단됨':'알림 허용'}
      off?.classList.toggle('hidden',!enabled);
      if(Notification.permission==='denied')setState('브라우저 또는 기기 설정에서 이 사이트의 알림 권한을 허용해야 합니다.','warn');
      else setState(enabled?'이 기기에서 푸시 알림을 받고 있습니다.':'이 기기에서는 푸시 알림이 꺼져 있습니다.',enabled?'ok':'');
    }catch(e){setState(e.message||String(e),'error')}
  }

  async function enable(){
    if(!supported())return status();
    const btn=document.querySelector('#pushEnableBtn');if(btn)btn.disabled=true;
    try{
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){setState('알림 권한이 허용되지 않았습니다.','warn');return}
      const key=await rt.api(endpoint('public-key'));
      if(!key?.public_key)throw new Error('푸시 공개키를 불러오지 못했습니다.');
      const reg=await registration();
      let sub=await reg.pushManager.getSubscription();
      if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(key.public_key)});
      const j=sub.toJSON(),keys=j.keys||{};
      await rt.api(endpoint('subscribe'),{method:'POST',body:{endpoint:j.endpoint||sub.endpoint,p256dh:keys.p256dh,auth:keys.auth,user_agent:navigator.userAgent}});
      setState('이 기기에서 푸시 알림을 받도록 설정했습니다.','ok');
      await status();
    }catch(e){setState(e.message||String(e),'error')}
    finally{if(btn)btn.disabled=false}
  }

  async function disable(){
    const btn=document.querySelector('#pushDisableBtn');if(btn)btn.disabled=true;
    try{
      const reg=await navigator.serviceWorker.getRegistration('./'),sub=await reg?.pushManager?.getSubscription();
      await rt.api(endpoint('unsubscribe'),{method:'POST',body:{endpoint:sub?.endpoint||''}});
      if(sub)await sub.unsubscribe();
      setState('이 기기의 푸시 알림을 해제했습니다.');
      await status();
    }catch(e){setState(e.message||String(e),'error')}
    finally{if(btn)btn.disabled=false}
  }

  function boot(){
    style();panel();
    window.KPTURouter?.on?.('profile',()=>setTimeout(status,50));
    window.addEventListener('kptu:session-changed',()=>setTimeout(status,300));
    setTimeout(status,500);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

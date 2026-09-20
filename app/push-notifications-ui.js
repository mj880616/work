(()=>{
  'use strict';
  if(window.__KPTU_PUSH_UI__)return;
  window.__KPTU_PUSH_UI__=true;
  const rt=window.KPTURuntime;
  const endpoint=action=>`/functions/v1/push-notifications?action=${encodeURIComponent(action)}`;
  const isNativeAndroid=/KPTUAndroid\//i.test(navigator.userAgent||'');
  const webSupported=()=>('Notification' in window)&&('serviceWorker' in navigator)&&('PushManager' in window);
  let nativeSyncRequested=false,nativeBusy=false;

  function vapidBytes(value){
    const pad='='.repeat((4-value.length%4)%4),base64=(value+pad).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(base64),out=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);
    return out;
  }
  function nativeBridge(){return isNativeAndroid?window.KPTUNativePush:null}
  function nativeConfigured(){try{return !!nativeBridge()?.isConfigured?.()}catch{return false}}
  function nativePermission(){try{return !!nativeBridge()?.permissionGranted?.()}catch{return false}}
  function nativeVersion(){try{return String(nativeBridge()?.appVersion?.()||'')}catch{return''}}

  function style(){
    if(document.querySelector('#pushUiStyle'))return;
    const s=document.createElement('style');s.id='pushUiStyle';s.textContent=`
      .push-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.push-copy{min-width:0}.push-copy b{display:block;font-size:13px}.push-copy p{margin:4px 0 0;color:var(--muted);font-size:11px;line-height:1.45}.push-actions{display:flex;gap:6px;flex:0 0 auto}.push-state{margin-top:8px;font-size:10.5px;line-height:1.5;color:var(--muted)}.push-state.ok{color:#3f7042}.push-state.warn{color:#8a5b17}.push-state.error{color:#a33b45}.push-device{display:inline-flex;margin-left:5px;padding:2px 6px;border-radius:999px;background:#eef3f6;color:#607282;font-size:9px;font-weight:800}@media(max-width:700px){.push-row{align-items:flex-start;flex-direction:column}.push-actions{width:100%}.push-actions button{flex:1}}
    `;document.head.appendChild(s);
  }

  function panel(){
    const grid=document.querySelector('#profileView .ps-profile-grid');if(!grid)return null;
    let p=document.querySelector('#pushSettingsPanel');
    if(!p){
      p=document.createElement('article');p.className='panel';p.id='pushSettingsPanel';
      p.innerHTML='<div class="push-row"><div class="push-copy"><h3 style="margin:0">푸시 알림 <span id="pushDevice" class="push-device"></span></h3><p>새 메시지·할 일 배정·가입 승인 등 필요한 알림을 기기에서 받습니다.</p></div><div class="push-actions"><button id="pushEnableBtn" class="secondary" type="button">알림 허용</button><button id="pushDisableBtn" class="ghost hidden" type="button">해제</button></div></div><div id="pushState" class="push-state">상태 확인 중…</div>';
      const first=grid.firstElementChild;first?.insertAdjacentElement('afterend',p)||grid.appendChild(p);
      p.querySelector('#pushEnableBtn').onclick=enable;
      p.querySelector('#pushDisableBtn').onclick=disable;
    }
    const device=p.querySelector('#pushDevice');if(device)device.textContent=isNativeAndroid?'Android 앱':'웹';
    return p;
  }
  function setState(text,kind=''){const el=document.querySelector('#pushState');if(!el)return;el.className='push-state'+(kind?' '+kind:'');el.textContent=text}
  function setButtons(enabled,blocked=false){const on=document.querySelector('#pushEnableBtn'),off=document.querySelector('#pushDisableBtn');if(on){on.classList.toggle('hidden',enabled);on.disabled=blocked||nativeBusy;on.textContent=blocked?'알림 설정 필요':'알림 허용'}off?.classList.toggle('hidden',!enabled)}

  async function registration(){let reg=await navigator.serviceWorker.getRegistration('./');if(!reg)reg=await navigator.serviceWorker.register('./sw.js?v=2',{scope:'./'});await navigator.serviceWorker.ready;return reg}

  async function nativeStatus(){
    const bridge=nativeBridge();
    if(!bridge){setButtons(false,true);setState('이 버전의 Android 앱에는 네이티브 푸시가 없습니다. 앱을 최신 버전으로 업데이트해 주세요.','warn');return}
    if(!nativeConfigured()){setButtons(false,true);setState(`Android 앱 ${nativeVersion()||''}에 푸시 모듈은 있으나 Firebase 연결정보가 아직 설정되지 않았습니다.`,'warn');return}
    if(!rt?.session||!(await rt.session.ensure()))return;
    try{
      const d=await rt.api(endpoint('status'));
      const permission=nativePermission();
      const enabled=!!d?.native_enabled&&permission;
      setButtons(enabled,!permission&&false);
      if(!permission){setState('Android 알림 권한이 꺼져 있습니다. ‘알림 허용’을 눌러 기기 권한을 켜 주세요.','warn');return}
      if(!d?.native_server_configured){setState('기기 알림 권한은 켜져 있지만 발송 서버의 Firebase 인증이 아직 연결되지 않았습니다.','warn')}
      else setState(enabled?'이 Android 기기에서 푸시 알림을 받고 있습니다.':'Android 푸시 토큰을 등록하는 중입니다.',enabled?'ok':'');
      if(permission&&!nativeSyncRequested){nativeSyncRequested=true;try{bridge.requestToken?.()}catch{nativeSyncRequested=false}}
    }catch(e){setState(e.message||String(e),'error')}
  }

  async function webStatus(){
    if(!webSupported()){setButtons(false,true);setState('이 환경에서는 푸시 알림을 사용할 수 없습니다.','warn');return}
    if(!rt?.session||!(await rt.session.ensure()))return;
    try{
      const d=await rt.api(endpoint('status')),enabled=!!d?.web_enabled;
      const blocked=Notification.permission==='denied';setButtons(enabled,blocked);
      if(blocked)setState('브라우저 또는 기기 설정에서 이 사이트의 알림 권한을 허용해야 합니다.','warn');
      else setState(enabled?'이 기기에서 웹 푸시 알림을 받고 있습니다.':'이 기기에서는 푸시 알림이 꺼져 있습니다.',enabled?'ok':'');
    }catch(e){setState(e.message||String(e),'error')}
  }
  async function status(){panel();return isNativeAndroid?nativeStatus():webStatus()}

  async function enable(){
    const btn=document.querySelector('#pushEnableBtn');if(btn)btn.disabled=true;
    if(isNativeAndroid){
      try{
        const bridge=nativeBridge();if(!bridge||!nativeConfigured())return nativeStatus();
        nativeBusy=true;setState('Android 알림 권한과 기기 토큰을 확인 중입니다…');bridge.enable?.();
      }catch(e){nativeBusy=false;setState(e.message||String(e),'error');if(btn)btn.disabled=false}
      return;
    }
    if(!webSupported())return status();
    try{
      const permission=await Notification.requestPermission();if(permission!=='granted'){setState('알림 권한이 허용되지 않았습니다.','warn');return}
      const key=await rt.api(endpoint('public-key'));if(!key?.public_key)throw new Error('푸시 공개키를 불러오지 못했습니다.');
      const reg=await registration();let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(key.public_key)});
      const j=sub.toJSON(),keys=j.keys||{};await rt.api(endpoint('subscribe'),{method:'POST',body:{endpoint:j.endpoint||sub.endpoint,p256dh:keys.p256dh,auth:keys.auth,user_agent:navigator.userAgent}});await status();
    }catch(e){setState(e.message||String(e),'error')}finally{if(btn)btn.disabled=false}
  }

  async function disable(){
    const btn=document.querySelector('#pushDisableBtn');if(btn)btn.disabled=true;
    try{
      if(isNativeAndroid){await rt.api(endpoint('native-unsubscribe'),{method:'POST',body:{}});try{nativeBridge()?.disable?.()}catch{}nativeSyncRequested=false;nativeBusy=false;setState('이 Android 기기의 푸시 알림을 해제했습니다.');setTimeout(status,250);return}
      const reg=await navigator.serviceWorker.getRegistration('./'),sub=await reg?.pushManager?.getSubscription();await rt.api(endpoint('unsubscribe'),{method:'POST',body:{endpoint:sub?.endpoint||''}});if(sub)await sub.unsubscribe();await status();
    }catch(e){setState(e.message||String(e),'error')}finally{if(btn)btn.disabled=false}
  }

  window.addEventListener('kptu:native-push',async e=>{
    if(!isNativeAndroid)return;const d=e.detail||{};
    if(d.type==='error'){nativeBusy=false;nativeSyncRequested=false;setState(d.message||'Android 푸시 토큰을 가져오지 못했습니다.','error');setButtons(false,false);return}
    if(d.type==='permission-denied'){nativeBusy=false;nativeSyncRequested=false;setState('Android 알림 권한이 허용되지 않았습니다. 기기 설정에서도 다시 켤 수 있습니다.','warn');setButtons(false,false);return}
    if(d.type==='disabled'){nativeBusy=false;nativeSyncRequested=false;setTimeout(status,150);return}
    if(d.type!=='token'||!d.token)return;
    try{
      await rt.api(endpoint('native-subscribe'),{method:'POST',body:{token:String(d.token),app_version:String(d.appVersion||nativeVersion()),device_info:navigator.userAgent}});
      nativeBusy=false;nativeSyncRequested=true;await nativeStatus();
    }catch(err){nativeBusy=false;nativeSyncRequested=false;setState(err.message||String(err),'error')}
  });

  function boot(){style();panel();window.KPTURouter?.on?.('profile',()=>setTimeout(status,50));window.addEventListener('kptu:session-changed',()=>{nativeSyncRequested=false;setTimeout(status,300)});setTimeout(status,500)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();

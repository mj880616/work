// SET-보기선택서버저장: 화면 선택(프로필 view_prefs 칸)을 서버 대신 흉내 내는 시험 도구.
// 화면의 fetch를 가로채 app_profiles?select=view_prefs 읽기와 view_prefs PATCH만 답한다(다른 요청은 그대로 통과).
// 상태는 시험(Node) 쪽에 있어 새로고침해도 이어진다. 앱 코드는 바꾸지 않고, 기기 저장소를 쓰지 않는다.
const installed=new WeakMap();
export async function installViewPrefsServer(page,initial=null,{missingColumn=false,failRead=false,failWrite=false}={}){
  // 같은 쪽에 두 번 불러도 한 번만 설치하고, 두 번째부터는 처음 값에 합친다(beforeEach와 시험 안에서 함께 부르는 경우).
  if(installed.has(page)){const known=installed.get(page);if(initial)known.value={...(known.value||{}),...initial};return known}
  const state={value:initial,patches:[],reads:0,missingColumn,failRead,failWrite};
  installed.set(page,state);
  await page.exposeFunction('__kptuViewPrefsServer',({method,body})=>{
    if(state.missingColumn)return {status:400,rows:{message:'column app_profiles.view_prefs does not exist'}};
    if(method==='GET'){state.reads++;return state.failRead?{status:500,rows:{}}:{status:200,rows:[{view_prefs:state.value}]}}
    if(state.failWrite)return {status:500,rows:{}};
    state.value=body.view_prefs;state.patches.push(body.view_prefs);return {status:200,rows:[{user_id:'view-prefs-user'}]};
  });
  await page.addInitScript(()=>{
    const real=window.fetch.bind(window);
    window.fetch=async function(input,init){
      try{
        const url=new URL(input instanceof Request?input.url:String(input),location.href);
        const method=String(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
        if(url.pathname.endsWith('/rest/v1/app_profiles')){
          let body=null;
          if(method==='PATCH'){try{body=JSON.parse(typeof init?.body==='string'?init.body:await input.clone().text())}catch{}}
          if((method==='GET'&&url.searchParams.get('select')==='view_prefs')||(method==='PATCH'&&body&&Object.keys(body).length===1&&'view_prefs' in body)){
            const answer=await window.__kptuViewPrefsServer({method,body});
            return new Response(JSON.stringify(answer.rows),{status:answer.status,headers:{'content-type':'application/json'}});
          }
        }
      }catch{}
      return real(input,init);
    };
  });
  return state;
}
// 기기 저장소에 화면 선택 옛 키가 남았는지(없어야 한다) — 읽기만 한다.
export const leftoverDeviceKeys=page=>page.evaluate(()=>Object.keys(localStorage).filter(k=>/^(kptu-(theme|nav-collapsed|calendar-view|home-quick-mode|split-ratio:)|kptu_owner_cache:(note-folder|collect-alert))/.test(k)));

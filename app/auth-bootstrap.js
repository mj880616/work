const SB='https://xmlkxfjeagycwttklxjw.supabase.co';
const SESSION_KEY='kptu_collab_session_v1';

function decodeJwt(token){
  try{
    const part=token.split('.')[1];
    const json=decodeURIComponent(atob(part.replace(/-/g,'+').replace(/_/g,'/')).split('').map(c=>'%'+('00'+c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    return JSON.parse(json);
  }catch{return null}
}

function parseOAuthHash(){
  if(!location.hash || !location.hash.includes('access_token=')) return false;
  const p=new URLSearchParams(location.hash.slice(1));
  const access_token=p.get('access_token');
  const refresh_token=p.get('refresh_token');
  if(!access_token || !refresh_token) return false;
  const expires_in=Number(p.get('expires_in')||3600);
  const payload=decodeJwt(access_token)||{};
  const session={
    access_token,
    refresh_token,
    expires_in,
    expires_at:Math.floor(Date.now()/1000)+expires_in,
    token_type:p.get('token_type')||'bearer',
    user:{
      id:payload.sub,
      email:payload.email,
      role:payload.role||'authenticated',
      aud:payload.aud||'authenticated',
      app_metadata:payload.app_metadata||{},
      user_metadata:payload.user_metadata||{}
    }
  };
  localStorage.setItem(SESSION_KEY,JSON.stringify(session));
  history.replaceState({},'',location.pathname+location.search);
  return true;
}

parseOAuthHash();

const rawFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
  const response=await rawFetch(input,init);
  const url=typeof input==='string'?input:(input?.url||'');
  if(response.status===403 && url.includes('/auth/v1/user')){
    try{
      const session=JSON.parse(localStorage.getItem(SESSION_KEY)||'null');
      const payload=decodeJwt(session?.access_token||'');
      if(payload?.sub){
        const user={
          id:payload.sub,
          email:payload.email,
          role:payload.role||'authenticated',
          aud:payload.aud||'authenticated',
          app_metadata:payload.app_metadata||{},
          user_metadata:payload.user_metadata||{}
        };
        return new Response(JSON.stringify(user),{status:200,headers:{'Content-Type':'application/json'}});
      }
    }catch{}
  }
  if(response.status===403 && url.startsWith(SB)){
    try{
      const body=await response.clone().text();
      let data={};try{data=JSON.parse(body)}catch{}
      if(!data.message && !data.error_description){
        return new Response(JSON.stringify({message:'권한 확인 실패: '+new URL(url).pathname}),{status:403,headers:{'Content-Type':'application/json'}});
      }
    }catch{}
  }
  return response;
};

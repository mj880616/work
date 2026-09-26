import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || SERVICE;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

function b64u(bytes: Uint8Array){
  let s=''; for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function unb64u(s:string){
  s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='=';
  const raw=atob(s); const out=new Uint8Array(raw.length); for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i); return out;
}
async function key(){
  const seed=new TextEncoder().encode('kptu-auth-handoff-v1:'+SERVICE);
  const digest=await crypto.subtle.digest('SHA-256',seed);
  return crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function seal(obj:unknown){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const plain=new TextEncoder().encode(JSON.stringify(obj));
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(),plain));
  const all=new Uint8Array(iv.length+cipher.length); all.set(iv); all.set(cipher,iv.length); return b64u(all);
}
async function open(token:string){
  const all=unb64u(token); if(all.length<13)throw new Error('bad token');
  const iv=all.slice(0,12), cipher=all.slice(12);
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv},await key(),cipher);
  return JSON.parse(new TextDecoder().decode(plain));
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
  try{
    const body=await req.json().catch(()=>({}));
    if(body.action==='seal'){
      const auth=req.headers.get('authorization')||'';
      const access=auth.replace(/^Bearer\s+/i,'');
      if(!access||!body.refresh_token) return new Response(JSON.stringify({error:'missing token'}),{status:400,headers:cors});
      const ur=await fetch(SB+'/auth/v1/user',{headers:{Authorization:'Bearer '+access,apikey:ANON}});
      if(!ur.ok) return new Response(JSON.stringify({error:'invalid access token'}),{status:401,headers:cors});
      const user=await ur.json();
      const token=await seal({sub:user.id,rt:body.refresh_token,iat:Date.now(),exp:Date.now()+5*60*1000});
      return new Response(JSON.stringify({token}),{headers:cors});
    }
    if(body.action==='consume'){
      if(!body.token) return new Response(JSON.stringify({error:'missing handoff'}),{status:400,headers:cors});
      const p=await open(body.token);
      if(!p?.rt||!p?.exp||Date.now()>p.exp||Date.now()<p.iat-60000) return new Response(JSON.stringify({error:'handoff expired'}),{status:401,headers:cors});
      const tr=await fetch(SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:p.rt})});
      const d=await tr.json().catch(()=>({}));
      if(!tr.ok) return new Response(JSON.stringify({error:d?.error_description||d?.msg||'refresh failed'}),{status:401,headers:cors});
      return new Response(JSON.stringify({session:d}),{headers:cors});
    }
    return new Response(JSON.stringify({error:'bad action'}),{status:400,headers:cors});
  }catch(e){
    return new Response(JSON.stringify({error:String(e?.message||e)}),{status:400,headers:cors});
  }
});

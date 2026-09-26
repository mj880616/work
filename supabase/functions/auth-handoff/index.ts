import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SB = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') || SERVICE;
const ORIGINS = new Set([
  'https://desk.bokdoong.com',
  'https://work.bokdoong.com',
  'https://mj880616.github.io'
]);
const TTL = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cors = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Vary': 'Origin'
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

// Bound the entire RPC, including reading its body. An aborted/unknown result
// is never retried here: the DB may already have committed the nonce claim.
async function consumeNonce(p: { nonce: string; sub: string; exp: number }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(SB + '/rest/v1/rpc/app_consume_auth_handoff', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + SERVICE, apikey: SERVICE, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_nonce: p.nonce, p_subject: p.sub, p_expires_at: new Date(p.exp).toISOString() }),
      signal: controller.signal
    });
    const result = response.ok ? await response.json() : null;
    return !controller.signal.aborted && result === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async req=>{
  const origin = req.headers.get('Origin');
  const allowed = origin !== null && ORIGINS.has(origin);
  const headers = allowed ? { ...cors, 'Access-Control-Allow-Origin': origin } : cors;
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  const fail = (error: string, status: number) => reply({ error, message: '새 로그인을 시작해 주세요.' }, status);
  if (!allowed) return fail('origin_not_allowed', 403);
  if(req.method==='OPTIONS') return new Response('ok',{headers});
  if(req.method!=='POST') return fail('method_not_allowed', 405);
  try{
    const body=await req.json().catch(()=>({}));
    if(body?.action==='seal'){
      const auth=req.headers.get('authorization')||'';
      const access=/^Bearer\s+(\S+)$/i.exec(auth)?.[1];
      if(!access||typeof body.refresh_token!=='string'||!body.refresh_token||body.refresh_token.length>16384) return fail('invalid_request',400);
      const ur=await fetch(SB+'/auth/v1/user',{headers:{Authorization:'Bearer '+access,apikey:ANON}});
      if(!ur.ok) return fail('authentication_failed',401);
      const user=await ur.json();
      if(typeof user?.id!=='string'||!UUID.test(user.id)) return fail('authentication_failed',401);
      const now=Date.now();
      const token=await seal({version:2,nonce:crypto.randomUUID(),sub:user.id,rt:body.refresh_token,iat:now,exp:now+TTL});
      return reply({token});
    }
    if(body?.action==='consume'){
      if(typeof body.token!=='string'||!body.token||body.token.length>32768) return fail('invalid_handoff',400);
      const p=await open(body.token);
      const now=Date.now();
      // v1 is deliberately rejected. Claims come only from authenticated
      // ciphertext and the Auth user endpoint, never client user/workspace IDs.
      if(p?.version!==2||typeof p.nonce!=='string'||!NONCE.test(p.nonce)||
         typeof p.sub!=='string'||!UUID.test(p.sub)||typeof p.rt!=='string'||!p.rt||p.rt.length>16384||
         !Number.isSafeInteger(p.iat)||!Number.isSafeInteger(p.exp)||p.iat<=0||
         p.exp<=now||p.iat>now+60000||p.exp<=p.iat||p.exp-p.iat>TTL||p.exp>now+TTL)
        return fail('invalid_handoff',401);
      if(!await consumeNonce(p)) return fail('handoff_unavailable',401);
      // A committed claim is never undone, even on expiry, Auth failure,
      // mismatched subject, or response loss. Start a new login instead.
      if(p.exp<=Date.now()) return fail('invalid_handoff',401);
      const tr=await fetch(SB+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:p.rt})});
      const d=await tr.json().catch(()=>({}));
      if(!tr.ok||d?.user?.id!==p.sub||typeof d?.access_token!=='string'||!d.access_token||
         typeof d?.refresh_token!=='string'||!d.refresh_token) return fail('authentication_failed',401);
      return reply({session:d});
    }
    return fail('invalid_request',400);
  }catch{
    return fail('handoff_failed',400);
  }
});

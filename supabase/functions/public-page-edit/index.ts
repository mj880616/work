import { createClient } from 'npm:@supabase/supabase-js@2';

const SB=Deno.env.get('SUPABASE_URL')!;
const ANON=Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGINS=new Set([
  'https://mj880616.github.io',
  'https://work.bokdoong.com',
  'https://desk.bokdoong.com'
]);
const WEB1_ADMIN_USER_ID='987b778e-69fe-4080-ad7f-191dc732d234';
const baseCors={
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST,OPTIONS',
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Vary':'Origin'
};

function userClient(req:Request){
  return createClient(SB,ANON,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{headers:{Authorization:req.headers.get('Authorization')||''}}
  });
}

Deno.serve(async(req:Request)=>{
  const origin=req.headers.get('origin')||'';
  const cors:Record<string,string>={...baseCors};
  if(origin&&ALLOWED_ORIGINS.has(origin))cors['Access-Control-Allow-Origin']=origin;
  const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
  if(origin&&!ALLOWED_ORIGINS.has(origin))return reply({error:'origin'},403);
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(req.method!=='POST')return reply({error:'method'},405);

  const authorization=req.headers.get('Authorization')||'';
  if(!/^Bearer\s+\S+$/i.test(authorization))return reply({error:'authentication_required'},401);

  let body:any;
  try{body=await req.json()}catch{return reply({error:'invalid_json'},400)}
  const id=String(body.id||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))return reply({error:'invalid_id'},400);

  const db=userClient(req);
  const {data:{user},error:userError}=await db.auth.getUser();
  if(userError||!user)return reply({error:'authentication_required'},401);
  if(user.id!==WEB1_ADMIN_USER_ID)return reply({error:'forbidden'},403);

  const {data:canEdit,error:canEditError}=await db.rpc('app_can_edit_page_rpc',{p_page:id});
  if(canEditError)return reply({error:'access_check_failed'},500);
  if(canEdit!==true)return reply({error:'forbidden'},403);

  const action=String(body.action||'update');
  if(action==='check')return reply({ok:true});
  if(action!=='update')return reply({error:'invalid_action'},400);

  const title=String(body.title||'').trim();
  const summary=String(body.summary||'').trim();
  const pageBody=String(body.body??'');
  if(!title||title.length>300||summary.length>5000||pageBody.length>120000)return reply({error:'invalid_value'},400);

  const {data,error}=await db.from('app_pages')
    .update({title,summary,body:pageBody})
    .eq('id',id)
    .select('id,title,summary,body,metadata,updated_at')
    .maybeSingle();
  if(error){
    if(error.code==='PGRST301'||error.code==='42501')return reply({error:'forbidden'},403);
    return reply({error:'save_failed'},500);
  }
  if(!data)return reply({error:'forbidden'},403);
  return reply({ok:true,page:data});
});

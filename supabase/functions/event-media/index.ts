import { createClient } from 'npm:@supabase/supabase-js@2';

const SB=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin=createClient(SB,SERVICE,{auth:{persistSession:false}});
const BUCKET='team-event-media';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS'};
const json=(d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors,'Content-Type':'application/json'}});
async function currentUser(req:Request){const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!token)throw new Error('로그인이 필요합니다.');const {data,error}=await admin.auth.getUser(token);if(error||!data.user)throw new Error('로그인 세션을 확인할 수 없습니다.');return data.user}
async function eventAccess(eventId:string,userId:string){
 const {data:e,error}=await admin.from('app_events').select('id,workspace_id,project_id,title,start_at,event_type').eq('id',eventId).maybeSingle();
 if(error||!e)throw new Error('일정을 찾을 수 없습니다.');
 const {data:m}=await admin.from('app_workspace_members').select('role').eq('workspace_id',e.workspace_id).eq('user_id',userId).maybeSingle();
 if(m?.role!=='owner')throw new Error('워크스페이스 소유자 권한이 필요합니다.');
 return e;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 try{
  const user=await currentUser(req);const u=new URL(req.url);const action=u.searchParams.get('action')||'list';
  if(req.method==='POST'&&action==='upload'){
    const form=await req.formData();const eventId=String(form.get('event_id')||'');if(!eventId)throw new Error('event_id가 필요합니다.');await eventAccess(eventId,user.id);
    const main=form.get('image'),thumb=form.get('thumb');if(!(main instanceof File)||!(thumb instanceof File))throw new Error('이미지 파일이 필요합니다.');
    if(main.size>8*1024*1024)throw new Error('이미지 용량이 너무 큽니다.');
    const id=crypto.randomUUID(),base=`${eventId}/${id}`;const mainPath=base+'.jpg',thumbPath=base+'-thumb.jpg';
    const [{error:e1},{error:e2}]=await Promise.all([
      admin.storage.from(BUCKET).upload(mainPath,main,{contentType:'image/jpeg',upsert:false,cacheControl:'3600'}),
      admin.storage.from(BUCKET).upload(thumbPath,thumb,{contentType:'image/jpeg',upsert:false,cacheControl:'3600'})
    ]);if(e1||e2){if(!e1)await admin.storage.from(BUCKET).remove([mainPath]);if(!e2)await admin.storage.from(BUCKET).remove([thumbPath]);throw new Error(e1?.message||e2?.message||'업로드 실패')}
    const tags=String(form.get('tags')||'').split(',').map(x=>x.trim()).filter(Boolean);const caption=String(form.get('caption')||'').trim()||null;const taken=String(form.get('taken_at')||'').trim()||null;
    const {data,error}=await admin.from('app_event_photos').insert({event_id:eventId,uploaded_by:user.id,storage_path:mainPath,thumb_path:thumbPath,caption,tags,taken_at:taken||null}).select('*').single();if(error)throw error;return json({photo:data});
  }
  if(req.method==='GET'&&action==='list'){
    const eventId=u.searchParams.get('event_id');let q=admin.from('app_event_photos').select('id,event_id,uploaded_by,storage_path,thumb_path,caption,tags,taken_at,created_at').order('taken_at',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false});if(eventId){await eventAccess(eventId,user.id);q=q.eq('event_id',eventId)}
    const {data,error}=await q;if(error)throw error;const rows=data||[];const eventIds=[...new Set(rows.map((x:any)=>x.event_id))];const allowed=new Map<string,any>();
    for(const id of eventIds){try{const e=await eventAccess(id,user.id);allowed.set(id,e)}catch{}}
    const visible=rows.filter((p:any)=>allowed.has(p.event_id));
    for(const p of visible){p.event=allowed.get(p.event_id)||null;const [a,b]=await Promise.all([admin.storage.from(BUCKET).createSignedUrl(p.storage_path,3600),admin.storage.from(BUCKET).createSignedUrl(p.thumb_path,3600)]);p.url=a.data?.signedUrl||null;p.thumb_url=b.data?.signedUrl||null}
    return json({photos:visible});
  }
  if(req.method==='DELETE'){
    const id=u.searchParams.get('id');if(!id)throw new Error('id가 필요합니다.');const {data:p}=await admin.from('app_event_photos').select('*').eq('id',id).maybeSingle();if(!p)throw new Error('사진을 찾을 수 없습니다.');const e=await eventAccess(p.event_id,user.id);const {data:m}=await admin.from('app_workspace_members').select('role').eq('workspace_id',e.workspace_id).eq('user_id',user.id).maybeSingle();if(p.uploaded_by!==user.id&&!['owner','admin'].includes(m?.role||''))throw new Error('삭제 권한이 없습니다.');await admin.storage.from(BUCKET).remove([p.storage_path,p.thumb_path]);await admin.from('app_event_photos').delete().eq('id',id);return json({ok:true});
  }
  return json({error:'unknown action'},400);
 }catch(e){return json({error:e instanceof Error?e.message:String(e)},400)}
});

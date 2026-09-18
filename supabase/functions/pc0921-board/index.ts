import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"https://mj880616.github.io",
  "Access-Control-Allow-Headers":"authorization, content-type",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};

const boards=new Set(["pc0921","pc2in1","private_rail","sanbyeol","press0914"]);
const PUBLIC_EDIT_BOARDS=new Set(["pc0921","pc2in1"]);
const WEB1_ADMIN_USER_ID="987b778e-69fe-4080-ad7f-191dc732d234";
const fixed=/^(done_|task_|org_|people_|staff_)[a-z0-9_-]{1,80}$/;
const dynamic=/^extra_(name|checked|people|note)_[a-z0-9_-]{1,80}$/;
const area=/^area_(title|status|body|hidden)_[a-z0-9_-]{1,80}$/;
const schedule=/^schedule_(date|title|status|hidden)_[a-z0-9_-]{1,80}$/;
const railCard=/^rail_card_[a-z0-9_-]{1,80}$/;
const san=/^san_[a-z0-9_-]{1,100}$/;
const press=/^press_[a-z0-9_-]{1,100}$/;
const attachment=/^attachment_[a-z0-9_-]{1,100}$/;
const pageEdit=/^page_edit[:_][a-z0-9_-]{1,180}$/;
const validKey=(k:string)=>fixed.test(k)||dynamic.test(k)||area.test(k)||schedule.test(k)||railCard.test(k)||san.test(k)||press.test(k)||attachment.test(k)||pageEdit.test(k);
const isPageEdit=(k:string)=>k.startsWith("page_edit_")||k.startsWith("page_edit:");

function validRailCard(v:any){
  if(!v||typeof v!=="object"||Array.isArray(v))return false;
  const str=(x:any,max:number)=>typeof x==="string"&&x.trim().length<=max;
  if(!str(v.title,120)||!str(v.badge,60)||!str(v.description,700))return false;
  if(!["green","blue","amber"].includes(String(v.tone||"green")))return false;
  if(!["subitems","brief","bargaining"].includes(String(v.layout||"subitems")))return false;
  if(v.hidden!==undefined&&typeof v.hidden!=="boolean")return false;
  if(v.custom!==undefined&&typeof v.custom!=="boolean")return false;
  if(v.order!==undefined&&!(Number.isInteger(v.order)&&v.order>=0&&v.order<=9999999999999))return false;
  if(v.briefTitle!==undefined&&!str(v.briefTitle,80))return false;
  if(v.briefDate!==undefined&&!str(v.briefDate,40))return false;
  if(!Array.isArray(v.details)||v.details.length>24)return false;
  return v.details.every((d:any)=>d&&typeof d==="object"&&!Array.isArray(d)&&str(d.label,100)&&str(d.text,700));
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin")||"";
  if(origin&&origin!=="https://mj880616.github.io")return new Response(JSON.stringify({error:"origin"}),{status:403,headers:cors});

  const url=new URL(req.url);
  const mode=url.searchParams.get("mode")||"board";
  const service=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const requireAdmin=async()=>{const token=(req.headers.get("authorization")||"").replace(/^Bearer\\s+/i,"");if(!token)return false;const {data:{user},error}=await service.auth.getUser(token);return !error&&user?.id===WEB1_ADMIN_USER_ID};

  if(mode==="summary"){
    if(req.method==="GET"){
      const {data,error}=await service.from("private_rail_bargaining_summary")
        .select("id,workplace,status_text,sort_order,updated_at")
        .order("sort_order",{ascending:true});
      return new Response(JSON.stringify(error?{error:error.message}:data||[]),{status:error?500:200,headers:cors});
    }
    if(req.method==="POST"){
      let body:any;try{body=await req.json()}catch{return new Response(JSON.stringify({error:"json"}),{status:400,headers:cors})}
      if(!await requireAdmin())return new Response(JSON.stringify({error:"forbidden"}),{status:403,headers:cors});
      const action=String(body.action||"");
      const id=Number(body.id);
      if(!Number.isInteger(id)||id<1)return new Response(JSON.stringify({error:"id"}),{status:400,headers:cors});
      if(action==="check"){
        const {data,error}=await service.from("private_rail_bargaining_summary").select("id").eq("id",id).maybeSingle();
        if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:cors});
        if(!data)return new Response(JSON.stringify({error:"not_found"}),{status:404,headers:cors});
        return new Response(JSON.stringify({ok:true}),{status:200,headers:cors});
      }
      if(action==="update"){
        const status_text=String(body.status_text||"").trim();
        if(!status_text||status_text.length>1000)return new Response(JSON.stringify({error:"value"}),{status:400,headers:cors});
        const {data,error}=await service.from("private_rail_bargaining_summary").update({status_text,updated_at:new Date().toISOString()}).eq("id",id).select("id");
        if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:cors});
        if(!data?.length)return new Response(JSON.stringify({error:"not_found"}),{status:404,headers:cors});
        return new Response(JSON.stringify({ok:true}),{status:200,headers:cors});
      }
      if(action==="delete"){
        const {data,error}=await service.from("private_rail_bargaining_summary").delete().eq("id",id).select("id");
        if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:cors});
        if(!data?.length)return new Response(JSON.stringify({error:"not_found"}),{status:404,headers:cors});
        return new Response(JSON.stringify({ok:true}),{status:200,headers:cors});
      }
      return new Response(JSON.stringify({error:"action"}),{status:400,headers:cors});
    }
    return new Response(JSON.stringify({error:"method"}),{status:405,headers:cors});
  }

  if(mode==="bargaining"){
    if(req.method==="GET"){
      const {data,error}=await service.from("private_rail_bargaining_updates").select("id,workplace,author,status_text,created_at").order("created_at",{ascending:false}).limit(100);
      return new Response(JSON.stringify(error?{error:error.message}:data||[]),{status:error?500:200,headers:cors});
    }
    if(req.method==="POST"){
      let body:any;try{body=await req.json()}catch{return new Response(JSON.stringify({error:"json"}),{status:400,headers:cors})}
      const action=String(body.action||"create"),password=String(body.password||"");
      if(password.length<4)return new Response(JSON.stringify({error:"password"}),{status:403,headers:cors});
      const anon=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{"x-post-password":password}}});
      if(action==="create"){
        const workplace=String(body.workplace||"").trim(),author=String(body.author||"").trim(),status_text=String(body.status_text||"").trim();
        if(!workplace||workplace.length>60||!status_text||status_text.length>1500||author.length>40)return new Response(JSON.stringify({error:"value"}),{status:400,headers:cors});
        const {error}=await anon.from("private_rail_bargaining_updates").insert({workplace,author:author||null,status_text});
        return new Response(JSON.stringify(error?{error:error.message}:{ok:true}),{status:error?500:200,headers:cors});
      }
      const id=Number(body.id);
      if(!Number.isInteger(id)||id<1)return new Response(JSON.stringify({error:"id"}),{status:400,headers:cors});
      if(action==="update"){
        const workplace=String(body.workplace||"").trim(),author=String(body.author||"").trim(),status_text=String(body.status_text||"").trim();
        if(!workplace||workplace.length>60||!status_text||status_text.length>1500||author.length>40)return new Response(JSON.stringify({error:"value"}),{status:400,headers:cors});
        const {data,error}=await anon.from("private_rail_bargaining_updates").update({workplace,author:author||null,status_text}).eq("id",id).select("id");
        if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:cors});
        if(!data?.length)return new Response(JSON.stringify({error:"password"}),{status:403,headers:cors});
        return new Response(JSON.stringify({ok:true}),{status:200,headers:cors});
      }
      if(action==="delete"){
        const {data,error}=await anon.from("private_rail_bargaining_updates").delete().eq("id",id).select("id");
        if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:cors});
        if(!data?.length)return new Response(JSON.stringify({error:"password"}),{status:403,headers:cors});
        return new Response(JSON.stringify({ok:true}),{status:200,headers:cors});
      }
      return new Response(JSON.stringify({error:"action"}),{status:400,headers:cors});
    }
    return new Response(JSON.stringify({error:"method"}),{status:405,headers:cors});
  }

  const board=url.searchParams.get("board")||"pc0921";
  if(!boards.has(board))return new Response(JSON.stringify({error:"board"}),{status:400,headers:cors});
  if(req.method==="GET"){
    const {data,error}=await service.from("board_state").select("item_key,value,updated_at").eq("board",board);
    const rows=(data||[]).map((x:any)=>({item_key:x.item_key,value:x.value,checked:typeof x.value==="boolean"?x.value:undefined,updated_at:x.updated_at}));
    return new Response(JSON.stringify(error?{error:error.message}:rows),{status:error?500:200,headers:cors});
  }
  if(req.method==="POST"){
    let body:any;try{body=await req.json()}catch{return new Response(JSON.stringify({error:"json"}),{status:400,headers:cors})}
    const publicEdit=PUBLIC_EDIT_BOARDS.has(board);
    if(!publicEdit&&!await requireAdmin())return new Response(JSON.stringify({error:"forbidden"}),{status:403,headers:cors});
    const k=String(body.item_key||"");
    if(!validKey(k))return new Response(JSON.stringify({error:"key"}),{status:400,headers:cors});
    const v=body.value!==undefined?body.value:body.checked;
    const raw=JSON.stringify(v),maxBytes=isPageEdit(k)?60000:k.startsWith("rail_card_")?8000:k.startsWith("san_")?12000:(k.startsWith("press_")||k.startsWith("attachment_"))?40000:1000;
    if(raw===undefined||raw.length>maxBytes)return new Response(JSON.stringify({error:"value"}),{status:400,headers:cors});
    if(k.startsWith("rail_card_")){
      if(!validRailCard(v))return new Response(JSON.stringify({error:"rail_card"}),{status:400,headers:cors});
      const {data:existing,error:lookupError}=await service.from("board_state").select("item_key").eq("board",board).eq("item_key",k).maybeSingle();
      if(lookupError)return new Response(JSON.stringify({error:lookupError.message}),{status:500,headers:cors});
    }
    if((k.startsWith("press_")||k.startsWith("attachment_"))&&!(typeof v==="string"&&v.trim().length>0&&v.length<=40000))return new Response(JSON.stringify({error:"press"}),{status:400,headers:cors});
    if(k.includes("people")&&!(Number.isInteger(v)&&v>=0&&v<=9999))return new Response(JSON.stringify({error:"people"}),{status:400,headers:cors});
    if((k.includes("checked")||k.startsWith("done_")||k.startsWith("task_")||k.startsWith("org_")||k.startsWith("staff_")||k.startsWith("area_hidden_")||k.startsWith("schedule_hidden_"))&&typeof v!=="boolean")return new Response(JSON.stringify({error:"boolean"}),{status:400,headers:cors});
    if(k.includes("name")&&!(typeof v==="string"&&v.trim().length<=80))return new Response(JSON.stringify({error:"name"}),{status:400,headers:cors});
    if(k.startsWith("extra_note_")&&!(typeof v==="string"&&v.length<=500))return new Response(JSON.stringify({error:"note"}),{status:400,headers:cors});
    if(k.startsWith("area_")&&!k.startsWith("area_hidden_")&&!(typeof v==="string"&&v.trim().length<=700))return new Response(JSON.stringify({error:"area"}),{status:400,headers:cors});
    if(k.startsWith("schedule_")&&!k.startsWith("schedule_hidden_")&&!(typeof v==="string"&&v.trim().length<=300))return new Response(JSON.stringify({error:"schedule"}),{status:400,headers:cors});
    const {error}=await service.from("board_state").upsert({board,item_key:k,value:v,updated_at:new Date().toISOString()},{onConflict:"board,item_key"});
    return new Response(JSON.stringify(error?{error:error.message}:{ok:true}),{status:error?500:200,headers:cors});
  }
  return new Response(JSON.stringify({error:"method"}),{status:405,headers:cors});
});
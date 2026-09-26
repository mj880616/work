import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://mj880616.github.io",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};
const base = Array.from({length:24},(_,i)=>`i${i}`);
const allowed = new Set([...base, ...base.map(k=>`failed_${k}`)]);
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin")||"";
  if (origin && origin!=="https://mj880616.github.io") return new Response(JSON.stringify({error:"origin"}),{status:403,headers:cors});
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if(req.method==="GET"){
    const {data,error}=await sb.from("checklist_state").select("item_key,checked,updated_at").eq("checklist","pc0914");
    return new Response(JSON.stringify(error?{error:error.message}:data),{status:error?500:200,headers:cors});
  }
  if(req.method==="POST"){
    let body; try{body=await req.json()}catch{return new Response(JSON.stringify({error:"json"}),{status:400,headers:cors})}
    if(!allowed.has(body.item_key)||typeof body.checked!=="boolean") return new Response(JSON.stringify({error:"input"}),{status:400,headers:cors});
    const {error}=await sb.from("checklist_state").upsert({checklist:"pc0914",item_key:body.item_key,checked:body.checked,updated_at:new Date().toISOString()},{onConflict:"checklist,item_key"});
    return new Response(JSON.stringify(error?{error:error.message}:{ok:true}),{status:error?500:200,headers:cors});
  }
  return new Response(JSON.stringify({error:"method"}),{status:405,headers:cors});
});
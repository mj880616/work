import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors={
  "Access-Control-Allow-Origin":"https://mj880616.github.io",
  "Access-Control-Allow-Headers":"content-type",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
  const origin=req.headers.get("origin")||"";
  if(origin&&origin!=="https://mj880616.github.io")return new Response(JSON.stringify({error:"origin"}),{status:403,headers:cors});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if(req.method==="GET"){
    const {data,error}=await db.from("wedding_mc_shared").select("content,updated_at").eq("id","main").maybeSingle();
    if(error)return new Response(JSON.stringify({error:error.message}),{status:500,headers:cors});
    return new Response(JSON.stringify(data||{content:null,updated_at:null}),{status:200,headers:cors});
  }
  if(req.method==="POST"){
    let body:any;try{body=await req.json()}catch{return new Response(JSON.stringify({error:"json"}),{status:400,headers:cors})}
    const content=String(body.content||"");
    if(!content.trim()||content.length>60000)return new Response(JSON.stringify({error:"content"}),{status:400,headers:cors});
    const updated_at=new Date().toISOString();
    const {error}=await db.from("wedding_mc_shared").upsert({id:"main",content,updated_at},{onConflict:"id"});
    return new Response(JSON.stringify(error?{error:error.message}:{ok:true,updated_at}),{status:error?500:200,headers:cors});
  }
  return new Response(JSON.stringify({error:"method"}),{status:405,headers:cors});
});

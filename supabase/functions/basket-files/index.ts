import { createClient } from "npm:@supabase/supabase-js@2";
import { createBasketHandler } from "./handler.ts";
import { withWebCors } from "../_shared/web-cors.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
// verify_jwt=false; handler validates login JWT with Auth getUser and server-side owner membership.
// MCP-Claude쓰기 ③: action=mcp-attach (Claude delegated key only) checks the key with Auth userinfo and the DB gate using the
// same key, so it needs the project URL and the public anon key (not a secret).
Deno.serve(withWebCors(createBasketHandler(admin,{
  env:{supabaseUrl:Deno.env.get("SUPABASE_URL")||"",anonKey:Deno.env.get("SUPABASE_ANON_KEY")||""},
  userClient:authorization=>{
    const key=Deno.env.get("SUPABASE_ANON_KEY");
    if(!key)throw new Error("OCR caller configuration unavailable");
    return createClient(Deno.env.get("SUPABASE_URL")!,key,{auth:{persistSession:false},global:{headers:{Authorization:authorization}}});
  },
})));

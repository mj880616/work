import { createClient } from "npm:@supabase/supabase-js@2";
import { createBasketHandler } from "./handler.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
// verify_jwt=false; handler validates login JWT with Auth getUser and server-side owner membership.
Deno.serve(createBasketHandler(admin));

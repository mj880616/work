// MCP-Claude읽기 입구(초안, 아직 배포하지 않음). verify_jwt=false: MCP 로그인 시작용 401 + resource_metadata를
// 함수가 직접 돌려줘야 하므로 관문 검사를 끄고 코드에서 인증한다(설계 docs/design/mcp-claude-read.md 4.4).
// 서버 키를 읽지 않는다. claude.ai는 서버에서 부르므로 Origin이 없고, 공통 CORS 제한(withWebCors)은 그대로 건다.
import { createHandler } from './core.mjs';
import { withWebCors } from "../_shared/web-cors.ts";

const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const resourceUrl = `${supabaseUrl}/functions/v1/mcp-read`;

Deno.serve(withWebCors(createHandler({ env: { supabaseUrl, anonKey, resourceUrl } })));

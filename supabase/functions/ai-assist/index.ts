import { createAiAssistHandler } from "./handler.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절). 코드에서도 로그인과 작업공간 소유자를 다시 확인한다.
// 서버 관리자 키를 읽지 않는다. OpenAI 열쇠는 WEB2_OPENAI_API_KEY만 handler가 읽는다.
Deno.serve(createAiAssistHandler({ env: (name) => Deno.env.get(name) }));

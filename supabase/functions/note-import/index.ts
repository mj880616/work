import { createNoteImportHandler } from "./handler.ts";
import { makeResolve, type DnsLookup } from "./guard.ts";
import { withWebCors } from "../_shared/web-cors.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절 44행). 로그인한 사람만 부르고 예약 호출이 없다.
// 함수 코드도 Auth 확인 + owner 행 정확히 하나를 다시 확인하고, 작업공간은 서버가 정한다(handler.ts 맨 위).
// 새 비밀값 없음(Supabase 기본값 SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY만 읽음).
// 이름 풀이는 런타임의 DNS 조회를 쓴다. 그 기능이 없으면 확인 없이 읽지 않고 503 LOOKUP_UNAVAILABLE을 돌려준다(guard.ts makeResolve).
const runtimeDns = (Deno as unknown as { resolveDns?: DnsLookup }).resolveDns;
const dns: DnsLookup | null = typeof runtimeDns === "function" ? (host, type) => runtimeDns(host, type) : null;

Deno.serve(withWebCors(createNoteImportHandler({ env: (name) => Deno.env.get(name), resolve: makeResolve(dns) })));

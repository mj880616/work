import { createCspReportHandler } from "./handler.mjs";
import { withWebCors } from "../_shared/web-cors.ts";
import { WEB2_ORIGINS } from "../_shared/web-cors.ts";

// verify_jwt=false(신규, docs/web2-env6b-edge-source.md 5절). 부르는 쪽은 Web2 첫 화면·로그인 화면의 보고 전용 CSP를 따르는 브라우저뿐이고,
// 보고에는 로그인 토큰이 붙지 않는다. 함수 코드가 모양·크기·초당 횟수·보고한 문서의 출처(Web2 주소만)를 확인하고,
// 지시어·막힌 주소 출처·개수만 service_role로 app_csp_report_add에 넘긴다. CORS는 다른 Web2 함수와 같은 공용 감싸기(허용 출처만).
Deno.serve(withWebCors(createCspReportHandler({ env: (name) => Deno.env.get(name), origins: WEB2_ORIGINS })));

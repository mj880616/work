// Web2 화면이 브라우저에서 부르는 Edge 함수의 CORS 출처 제한(EDGE-서버함수정리).
// 허용 출처는 auth-handoff·public-policy-drive와 같은 5곳(운영 주소·새 주소 nojoplus.com·옛 주소·Windows/폰 앱 내부 주소)이다.
// (옛 Web1 함수 public-page-edit·pc0921-board는 Web2가 부르지 않으므로 새 주소를 넣지 않는다 — DOMAIN-nojoplus.)
// 출처 머리글이 없는 호출(폰 앱 위젯·바구니 PC·예약 호출·Apps Script)은 CORS와 무관하므로 그대로 둔다.
// 허용되지 않은 브라우저 출처에는 Access-Control-Allow-Origin을 붙이지 않는다(브라우저가 응답을 막음). 인증 검사는 각 함수가 그대로 한다.

export const WEB2_ORIGINS: ReadonlySet<string> = new Set([
  "https://bokdoong.com",
  "https://desk.bokdoong.com",
  "https://work.bokdoong.com",
  "https://mj880616.github.io",
  // DOMAIN-nojoplus 1단계: 새 Web2 주소(정확히 이 한 출처. www는 Worker가 이 주소로 넘기므로 넣지 않는다).
  "https://nojoplus.com",
]);

export function applyWebCors(req: Request, res: Response, origins: ReadonlySet<string> = WEB2_ORIGINS): Response {
  const headers = new Headers(res.headers);
  headers.delete("Access-Control-Allow-Origin");
  const origin = req.headers.get("Origin");
  if (origin && origins.has(origin)) headers.set("Access-Control-Allow-Origin", origin);
  const vary = (headers.get("Vary") || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (!vary.some((v) => v.toLowerCase() === "origin")) vary.push("Origin");
  headers.set("Vary", vary.join(", "));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function withWebCors<A extends unknown[]>(
  handler: (req: Request, ...rest: A) => Response | Promise<Response>,
  origins: ReadonlySet<string> = WEB2_ORIGINS,
): (req: Request, ...rest: A) => Promise<Response> {
  return async (req: Request, ...rest: A) => applyWebCors(req, await handler(req, ...rest), origins);
}

// 바깥 사이트 읽기 요청 머리글 — 한 곳(S68-49, 사용자 11/23 12:43 "업데이트 됐는데도 여전히 못 읽음").
// 근거: 예전 머리글은 User-Agent가 'Web2OutsideFeed/1.0 (+주소)'처럼 브라우저 꼴이 아니고 Accept가 좁아,
//   일부 사이트(봇 확인 쪽을 두는 곳)가 사람 아닌 요청으로 보고 봇 확인 화면을 돌려줬다(추정 — 사이트 쪽 판정은 볼 수 없음).
// 정한 것(위장 금지 — note-import의 'Mozilla/5.0 (compatible; 이름/판; +주소)' 꼴과 같다):
// - User-Agent: 'Mozilla/5.0 (compatible; <우리 이름>/<판>; +<설명 주소>)'. 브라우저 제품 이름(Chrome·Safari·Firefox 등)·기기 이름은 넣지 않는다.
//   검색 로봇들이 쓰는 표준 꼴이라 정상 요청으로 다뤄지면서도 우리가 누구인지는 그대로 밝힌다.
// - Accept·Accept-Language: 일반 브라우저와 같은 값(한국어 우선).
// - 압축(Accept-Encoding): 실행 환경(Deno fetch)이 gzip·br을 스스로 알리고 풀어 준다. 손으로 넣으면 자동 풀기가 꺼질 수 있어 넣지 않는다.
// - 쿠키·인증 머리글 없음. 봇 확인(캡차) 풀기·우회 없음. 간격·횟수·크기·시간 상한은 부르는 쪽 그대로.
export const ACCEPT_LANGUAGE = "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7";
export const BROWSER_ACCEPT_HTML = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
export const BROWSER_ACCEPT_FEED = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5";

const NAME = /^[A-Za-z][A-Za-z0-9]{1,39}$/;
const DOC = /^https:\/\/github\.com\/mj880616\/work\/[A-Za-z0-9._\/-]{1,200}$/;
// 정직한 브라우저 호환 User-Agent. 이름·주소 모양이 틀리면 던진다(시작할 때 상수로만 부른다).
export function readerUserAgent(name: string, version: string, doc: string): string {
  if (!NAME.test(name) || !/^\d{1,3}\.\d{1,3}$/.test(version) || !DOC.test(doc)) throw new Error("reader_user_agent_shape");
  return `Mozilla/5.0 (compatible; ${name}/${version}; +${doc})`;
}
export function readerHeaders(userAgent: string, accept: string): Record<string, string> {
  return { "User-Agent": userAgent, Accept: accept, "Accept-Language": ACCEPT_LANGUAGE };
}

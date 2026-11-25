// S70-40a READ-실패까닭(docs/design/reading-screens.md 2절 A5·A6, 6절 ②): 읽은 쪽이 글이 아니라 '로그인 화면'인지 판정하는 순수 함수(네트워크·DB 없음).
// 로그인이 필요한 주소는 보통 200으로 로그인 화면을 돌려준다(리다이렉트 뒤). 그대로 읽으면 로그인 화면의 og:title·og:description이
// 글 제목·리드로 저장되고, 화면은 '유료 기사'로 잘못 부른다. 그래서 note-import는 이 판정이 맞으면 제목·리드·본문을 돌려주지 않고 까닭 login으로 끝낸다.
// 로그인을 넘거나 대신하지 않는다(쿠키·인증 없음 그대로). 판정만 한다.
//
// 판정(둘 중 하나):
// 1) 최종 주소(리다이렉트 뒤)의 경로 조각이 로그인 경로(login·signin·sign-in·sign_in·log-in·auth/login 등 — 아래 LOGIN_PATH).
// 2) 비밀번호 칸(<input type="password">)이 있고, 본문을 뽑지 못했으며(bodyOk=false), 쪽 제목에 로그인 말(로그인·Sign in·Log in)이 있거나
//    글자가 짧은 쪽(SHORT_PAGE자 아래 — 로그인 화면은 글이 거의 없다)에 로그인 요구 문구(로그인이 필요·로그인 후 이용·sign in to continue 등)가 있다.
//    (긴 쪽의 '댓글은 로그인 후 이용' 같은 문구는 보지 않는다.) 유료벽 쪽은 handler가 bodyOk=true로 넘겨 1)만 본다(공개 리드를 지킴).
// 뉴스 기사 쪽에 흔한 '숨은 로그인 창'(비밀번호 칸이 들어 있음)만으로는 로그인 화면으로 보지 않는다 — 본문이 뽑히면 2)에 걸리지 않는다.
import { htmlToText } from "../outside-feed/parse.ts";
import { decodeText } from "../_shared/html-entities.ts";

const LOGIN_PATH = /(?:^|\/)(?:log[-_]?in|sign[-_]?in|signon|sso|auth\/(?:login|signin)|accounts?\/(?:login|signin)|member\/login|users\/sign_in|session\/new)(?:\/|\.[a-z]{2,5}|$)/i;
const PASSWORD = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
const TITLE_LOGIN = /로그인|log\s*-?\s*in\b|sign\s*-?\s*in\b/i;
export const SHORT_PAGE = 1500;
const ASK_LOGIN = /로그인(?:이|을)?\s*(?:필요|해\s*주세요|하세요|후\s*이용)|(?:sign|log)\s*in\s+to\s+(?:continue|view|read|access)|please\s+(?:sign|log)\s*in|you\s+(?:must|need\s+to)\s+(?:sign|log)\s*in/i;

function titleText(html: string): string {
  const raw = /<title\b[^>]*>([\s\S]{0,600}?)<\/title>/i.exec(html)?.[1] ?? "";
  return decodeText(raw).replace(/\s+/g, " ").trim();
}

export function loginPath(url: string): boolean {
  try { return LOGIN_PATH.test(new URL(url).pathname); } catch { return false; }
}

// html: 읽은 쪽, finalUrl: 리다이렉트 뒤 실제 주소, bodyOk: 공용 추출기가 본문(ok)을 뽑았는가.
export function looksLikeLoginPage(html: string, finalUrl: string, bodyOk: boolean): boolean {
  if (loginPath(finalUrl)) return true;
  if (bodyOk || !PASSWORD.test(html)) return false;
  if (TITLE_LOGIN.test(titleText(html))) return true;
  const text = htmlToText(html).replace(/\s+/g, " ").trim();
  return [...text].length < SHORT_PAGE && ASK_LOGIN.test(text);
}

// SEC-Web2CSP 1단계(보고만 하기): Web2 첫 화면(app/index.html)과 로그인 화면(app/login/)의 콘텐츠 보안 정책.
// GitHub Pages는 응답 헤더를 못 바꾸고, Content-Security-Policy-Report-Only는 <meta>로 넣으면 브라우저가 무시한다(CSP3 명세).
// 그래서 bokdoong.com 앞의 Worker(bokdoong-router.mjs)가 이 두 화면 응답에만 Report-Only 헤더로 붙인다. 막지 않고 위반만 알린다.
// 같은 문자열을 E2E(tests/app-e2e/web2-csp-report-only.spec.mjs)가 그대로 붙여 16개 메뉴에서 위반 0개를 확인한다.
// 2단계(실제 차단)로 가기 전에 정리할 것은 PR 본문 '남은 일'과 이 파일 주석의 표를 따른다.

// 저장소 안 Supabase 프로젝트 주소(app/runtime-client.js config.url). REST·Auth·Edge Function·Storage가 모두 이 주소다.
export const SUPABASE_ORIGIN = 'https://xmlkxfjeagycwttklxjw.supabase.co';

// 원드라이브 사진(Edge onedrive-photos가 돌려주는 Microsoft 썸네일·재생 주소, app/diary-onedrive.js safeThumbUrl).
// 주소는 서버가 그때그때 주므로 Microsoft 파일 배달 주소 묶음으로 둔다. 실기기에서 빠진 곳이 보이면 여기만 고친다.
export const ONEDRIVE_MEDIA = Object.freeze([
  'https://*.sharepoint.com',
  'https://*.1drv.com',
  'https://*.livefilestore.com',
  'https://*.microsoftpersonalcontent.com',
  'https://*.svc.ms'
]);

// 첫 줄 테마 스크립트(<script data-kptu-theme-bootstrap>) 내용의 SHA-256. 두 화면이 같은 내용이다.
// 내용이 바뀌면 tests/web2-csp.test.mjs가 실패하므로 값을 함께 고친다.
export const THEME_BOOTSTRAP_HASH = "'sha256-tiHcJld6PV1zbqmBaWmZFIOt80XTTF60ePV9OzZDpIg='";

const DIRECTIVES = Object.freeze([
  ['default-src', ["'self'"]],
  // 'wasm-unsafe-eval': 저장소 안 pdf.js(app/pdf-lib)가 WebAssembly를 쓸 수 있다. eval·new Function은 허용하지 않는다.
  ['script-src', ["'self'", THEME_BOOTSTRAP_HASH, "'wasm-unsafe-eval'"]],
  // on…= 속성은 두 화면 어디에도 없다(PR 본문 표). 생기면 위반으로 바로 보인다.
  ['script-src-attr', ["'none'"]],
  // 2단계 정리 대상: 화면 코드의 style="…" 약 50곳·JS가 만드는 <style> 7곳과 편집기·수식(KaTeX)·도표(mermaid)가 쓰는 인라인 스타일.
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ["'self'", 'data:', 'blob:', SUPABASE_ORIGIN, ...ONEDRIVE_MEDIA]],
  ['media-src', ["'self'", 'blob:', ...ONEDRIVE_MEDIA]],
  ['font-src', ["'self'", 'data:']],
  // raw.githubusercontent.com: 공유 페이지(Web1 게시판) 원문 읽기(app/web1-board.js RAW). wss: Supabase 실시간(지금은 쓰지 않음, 여유분).
  ['connect-src', ["'self'", 'blob:', 'data:', SUPABASE_ORIGIN, SUPABASE_ORIGIN.replace('https:', 'wss:'), 'https://raw.githubusercontent.com', ...ONEDRIVE_MEDIA]],
  // pdf.js worker(app/pdf-lib), 서비스워커(app/sw.js).
  ['worker-src', ["'self'", 'blob:']],
  // HWP 편집기(app/hwp-lab, 같은 주소)와 srcdoc 칸막이(HTML 보기·공유 페이지 상세). blob:은 HWP 미리보기 여유분.
  ['frame-src', ["'self'", 'blob:']],
  ['manifest-src', ["'self'"]],
  ['object-src', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]],
  ['frame-ancestors', ["'self'"]]
]);

export const WEB2_CSP = DIRECTIVES.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
export const WEB2_REFERRER_POLICY = 'strict-origin-when-cross-origin';

// 이 정책을 붙이는 Web2 화면: 첫 화면과 로그인 화면만. 공유 페이지(/work/share/)는 자기 meta CSP가 있고, 다른 app/*.html은 범위 밖.
const CSP_PAGES = new Set(['/work/app/', '/work/app/index.html', '/work/app/login/', '/work/app/login/index.html']);
export function web2CspPage(pathname) {
  return CSP_PAGES.has(pathname);
}

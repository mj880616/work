// S70-69 LIB-드라이브가져오기 빼기 목록(★급★ 보안, CC 11/26 확인: [드라이브에서 가져오기] 목록에 폰 앱 서명 열쇠·그 비밀번호 파일,
// 앱 임시 문서('Web2 OCR …'), 운영 문서('Web2 요청함')가 기본 체크로 나옴).
// 드라이브 파일을 '자료로 넣을 후보'로 보여 주는 서버 기능이 함께 쓰는 거름 한 곳. 서버에서 거른다(화면 숨김 아님).
//   - secret: 비밀값 파일(서명 열쇠·인증서·비밀번호·토큰 메모 등) 또는 비밀값 보관 폴더(예: 폰 열쇠 백업) 안 파일 → 목록·등록에서 아예 뺀다.
//   - app:    앱이 만든 임시 문서(표식 web2_text_tmp·web2_ocr, 표식 없는 옛것은 이름)와 운영용 문서(요청함) → 앱 폴더와 같이 뺀다.
// 판단 재료는 이름·형식·표식뿐(파일 내용은 열지 않음). 이름이 넓게 걸려 보통 파일이 빠지는 쪽이 비밀값이 들어가는 쪽보다 낫다.
// 쓰는 곳: library-files drive-skip.mjs(S70-73 드라이브 자동 등록 — 옛 [드라이브에서 가져오기]·[맨 위 파일 정리]는 지움).
// DOM·네트워크 없음. 시험: tests/security/drive-hidden-files.test.mjs.

// 열쇠·인증서·비밀번호 보관 형식(확장자).
export const SECRET_EXT_RE = /\.(keystore|jks|bks|p12|pfx|pem|key|der|crt|cer|csr|ppk|kdbx|keychain|gpg|pgp|ovpn|mobileprovision)$/i;
// 이름에 비밀값을 뜻하는 말이 든 파일(.env·서비스 계정 열쇠 json 포함).
export const SECRET_NAME_RE = /비밀\s*번호|비번|패스\s*워드|암호\s*(메모|파일|목록)|password|passwd|pass\s*phrase|secret|token|credential|api[\s_-]*key|private[\s_-]*key|signing[\s_-]*key|서명\s*(열쇠|키)|keystore|^\.env(\.|$)|service[\s_-]*account.*\.json$|^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i;
// 열쇠·인증서 형식(MIME).
export const SECRET_MIMES = Object.freeze([
  'application/x-pkcs12', 'application/pkcs12', 'application/x-pkcs7-certificates', 'application/x-x509-ca-cert', 'application/x-x509-user-cert',
  'application/x-pem-file', 'application/pkcs8', 'application/x-java-keystore', 'application/pgp-keys', 'application/pgp-encrypted',
]);
// 비밀값 보관 폴더 이름(폰 열쇠 백업 등). 이 폴더(또는 그 아래) 안 파일은 이름과 상관없이 비밀값으로 본다.
export const SECRET_FOLDER_RE = /keystore|key[\s_-]*(백업|backup)|키\s*백업|열쇠|비밀\s*번호|비번|password|secrets?(\b|$)|credentials?/i;

// 앱이 만든 임시 문서 표식(글자 읽기 임시 사본·노트 사진 OCR 임시본)과 표식 없는 옛것의 이름.
export const APP_TEMP_MARKS = Object.freeze(['web2_text_tmp', 'web2_ocr']);
export const APP_TEMP_NAME_RE = /^(Web2 글자 읽기 임시|Web2 OCR\b)/;
// 운영용 문서(앱 밖 운영 흐름이 id로 쓰는 문서). 이름이 정확히 같을 때만.
export const OPS_DOC_NAMES = Object.freeze(['Web2 요청함']);

const nameOf = f => String(f?.name || '').normalize('NFKC').trim();
const propsOf = f => (f && typeof f.appProperties === 'object' && f.appProperties ? f.appProperties : {});

/** 비밀값 파일(이름·확장자·형식)인가. 폴더는 isSecretFolder로. */
export function isSecretFile(f) {
  const name = nameOf(f);
  if (SECRET_EXT_RE.test(name) || SECRET_NAME_RE.test(name)) return true;
  return SECRET_MIMES.includes(String(f?.mimeType || '').toLowerCase());
}
/** 비밀값 보관 폴더(이름)인가. */
export const isSecretFolder = f => SECRET_FOLDER_RE.test(nameOf(f));

/** 앱이 만든 임시 문서인가(표식 먼저, 표식 없는 옛것은 이름). */
export function isAppTempFile(f) {
  const p = propsOf(f);
  if (APP_TEMP_MARKS.some(k => p[k] === '1')) return true;
  return APP_TEMP_NAME_RE.test(nameOf(f));
}
/** 운영용 문서인가(요청함 등). */
export const isOpsDoc = f => OPS_DOC_NAMES.includes(nameOf(f));

/** 파일 하나를 후보에서 빼는 까닭: 'secret' | 'app' | null(보통 파일). */
export function hiddenReason(f) {
  if (isSecretFile(f)) return 'secret';
  if (isAppTempFile(f) || isOpsDoc(f)) return 'app';
  return null;
}

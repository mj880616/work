// LIB-드라이브자동등록(S70-73) 공용 거름: 드라이브 파일 하나를 자료실 자료로 넣으면 안 되는 까닭(이름·종류·표식만 본다, 파일 내용은 열지 않음).
// S70-69(가져오기 목록 공용 거름 — 열쇠·비밀 파일·앱 임시 문서·운영 문서)와 같은 자리다. 두 PR이 만나면 이 파일 하나로 합친다.
// 순수 규칙(DOM·네트워크 없음). 시험: tests/security/library-files-drive-auto.test.mjs.
import { isJunkName, isTempFile } from './top-files.mjs';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
// 링크형으로 넣는 구글 형식(내려받기 대신 드라이브에서 열기). 나머지 구글 형식(바로가기·Apps Script·양식·사이트 등)은 넣지 않는다.
export const LINK_MIMES = Object.freeze({
  'application/vnd.google-apps.document': '구글 문서',
  'application/vnd.google-apps.spreadsheet': '구글 시트',
  'application/vnd.google-apps.presentation': '구글 슬라이드',
});
// 열쇠·비밀번호 파일(확장자·이름). 자료실에 들어가면 AI 재료·검색·공유에 섞일 수 있어 아예 넣지 않는다.
export const SECRET_EXT_RE = /\.(pem|key|p12|pfx|jks|keystore|kdbx|kdb|ppk|gpg|pgp|ovpn|der|crt|cer|csr|env)$/i;
export const SECRET_NAME_RE = /(^|[^a-z0-9])(id_(rsa|dsa|ecdsa|ed25519)|\.?env(\.[a-z]+)?|\.?npmrc|\.?netrc|\.?pgpass|credentials?|client[_\s-]?secrets?|service[_\s-]?account|secrets?|tokens?|api[_\s-]?keys?|private[_\s-]?keys?|passwords?|passwd|signcert|signpri|npki)([^a-z0-9]|$)|비밀\s*번호|패스\s*워드|인증서\s*(백업|비번|암호)|암호\s*(목록|모음|파일)|계정\s*(정보|목록|비번)/i;
// 앱 운영 문서(요청함·인계서·원장 등) — 사람 자료가 아니라 앱·운영이 쓰는 문서.
export const OPS_NAME_RE = /요청함|인계서|handoff|^원장(\s|$|\.|_)|원장\s*백업|^(agents|claude)\.md$/i;

export const appMarked = f => !!f && typeof f.appProperties === 'object' && f.appProperties !== null && Object.keys(f.appProperties).some(k => k.startsWith('kptu_'));
const nameOf = f => String(f?.name || '').normalize('NFKC').trim();
export const isSecretName = name => { const n = String(name || '').normalize('NFKC').trim(); return SECRET_EXT_RE.test(n) || SECRET_NAME_RE.test(n); };
export const isOpsName = name => OPS_NAME_RE.test(String(name || '').normalize('NFKC').trim());

/**
 * 파일 하나를 넣지 않는 까닭. null = 넣어도 됨.
 * 'folder' 폴더 자체 · 'not_file' 바로가기·스크립트 등 파일이 아닌 구글 형식 · 'empty' 0바이트·크기 모름 ·
 * 'temp' 앱 임시 문서·Thumbs.db 같은 찌꺼기 · 'secret' 열쇠·비밀번호 · 'ops' 운영 문서 · 'app' 앱 표식(kptu_*)
 */
export function skipReason(f) {
  const mime = String(f?.mimeType || '');
  if (mime === FOLDER_MIME) return 'folder';
  if (mime.startsWith('application/vnd.google-apps.') && !LINK_MIMES[mime]) return 'not_file';
  if (!LINK_MIMES[mime]) { const size = Number(f?.size); if (!Number.isFinite(size) || size <= 0) return 'empty'; }
  const name = nameOf(f);
  if (isTempFile(f) || isJunkName(name) || (f?.appProperties && typeof f.appProperties === 'object' && Object.keys(f.appProperties).some(k => k.startsWith('web2_')))) return 'temp';
  if (isSecretName(name)) return 'secret';
  if (isOpsName(name)) return 'ops';
  if (appMarked(f)) return 'app';
  return null;
}
export const linkKind = f => !!LINK_MIMES[String(f?.mimeType || '')];

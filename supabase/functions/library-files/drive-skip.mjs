// S70-73 LIB-드라이브자동등록: 드라이브 파일 하나를 자료실 자료로 저절로 넣으면 안 되는 까닭(이름·종류·표식만 본다, 파일 내용은 열지 않음).
// 열쇠·비밀번호 파일, 비밀값 보관 폴더, 앱 임시 문서, 운영 문서 판정은 S70-69 공용 거름(_shared/drive-hidden-files.mjs) 그대로 쓴다.
// 여기서는 그 앞뒤로 '파일이 아님'(폴더·바로가기 등)·0바이트·찌꺼기 이름·앱 표식만 더한다.
// 순수 규칙(DOM·네트워크 없음). 시험: tests/security/library-files-drive-auto.test.mjs.
import { hiddenReason, isSecretFolder } from '../_shared/drive-hidden-files.mjs';
import { isJunkName } from './top-files.mjs';

export { isSecretFolder };
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
// 링크형으로 넣는 구글 형식(내려받기 대신 드라이브에서 열기). 나머지 구글 형식(바로가기·Apps Script·양식·사이트 등)은 넣지 않는다.
export const LINK_MIMES = Object.freeze({
  'application/vnd.google-apps.document': '구글 문서',
  'application/vnd.google-apps.spreadsheet': '구글 시트',
  'application/vnd.google-apps.presentation': '구글 슬라이드',
});

export const appMarked = f => !!f && typeof f.appProperties === 'object' && f.appProperties !== null && Object.keys(f.appProperties).some(k => k.startsWith('kptu_'));
export const linkKind = f => !!LINK_MIMES[String(f?.mimeType || '')];

/**
 * 파일 하나를 넣지 않는 까닭. null = 넣어도 됨.
 * 'folder' 폴더 자체 · 'not_file' 바로가기·스크립트 등 파일이 아닌 구글 형식 · 'empty' 0바이트·크기 모름 ·
 * 'secret' 열쇠·비밀번호(공용 거름) · 'temp' 앱 임시 문서·운영 문서(공용 거름의 app)·Thumbs.db 같은 찌꺼기 · 'app' 앱 표식(kptu_*)
 */
export function skipReason(f) {
  const mime = String(f?.mimeType || '');
  if (mime === FOLDER_MIME) return 'folder';
  if (mime.startsWith('application/vnd.google-apps.') && !LINK_MIMES[mime]) return 'not_file';
  if (!LINK_MIMES[mime]) { const size = Number(f?.size); if (!Number.isFinite(size) || size <= 0) return 'empty'; }
  const hidden = hiddenReason(f);
  if (hidden === 'secret') return 'secret';
  if (hidden === 'app' || isJunkName(String(f?.name || '').normalize('NFKC'))) return 'temp';
  if (appMarked(f)) return 'app';
  return null;
}

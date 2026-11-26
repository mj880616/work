import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenReason, isSecretFile, isSecretFolder, isAppTempFile, isOpsDoc } from '../../supabase/functions/_shared/drive-hidden-files.mjs';

// S70-69: 드라이브 파일을 자료 후보로 보여 주는 서버 기능의 공용 거름(이름·형식·표식만). 이름은 모두 가상.
test('비밀값 파일: 열쇠·인증서 형식, 비밀번호·토큰·secret 이름, .env·서비스 계정 열쇠', () => {
  for (const n of ['release.keystore', 'upload.JKS', 'cert.p12', 'a.pfx', 'server.pem', 'private.key', 'signCert.der', 'signPri.key', 'putty.ppk', 'vault.kdbx',
    '키 비밀번호.txt', '비번 메모.txt', 'keystore-password.txt', 'PASSWORD.txt', 'client_secret_1.json', 'github token.txt', 'credentials.json', 'API key.txt',
    '.env', '.env.local', 'my-service-account-123.json', 'id_rsa', 'id_ed25519.pub', '서명 키 정보.txt']) assert.equal(isSecretFile({ name: n }), true, n);
  assert.equal(isSecretFile({ name: 'x', mimeType: 'application/x-pkcs12' }), true);
  for (const n of ['2026 사업계획.hwp', '회의록.docx', '키워드 정리.pdf', 'keynote 발표.pdf', '주민등록증 사본.jpg', '열쇠고리 사진.jpg', 'monkey.png']) assert.equal(isSecretFile({ name: n, mimeType: 'application/pdf' }), false, n);
});

test('비밀값 보관 폴더·앱 임시 문서·운영 문서', () => {
  for (const n of ['web2-phone-key-백업', 'keystore', '키 백업', 'secrets', 'credentials']) assert.equal(isSecretFolder({ name: n }), true, n);
  for (const n of ['WORK ON+', 'A노조', '키워드']) assert.equal(isSecretFolder({ name: n }), false, n);
  assert.equal(isAppTempFile({ name: '아무 이름', appProperties: { web2_ocr: '1' } }), true, '표식이 먼저');
  assert.equal(isAppTempFile({ name: 'x', appProperties: { web2_text_tmp: '1' } }), true);
  assert.equal(isAppTempFile({ name: 'Web2 OCR 1234' }), true, '표식 없는 옛것은 이름');
  assert.equal(isAppTempFile({ name: 'Web2 OCRX' }), false);
  assert.equal(isOpsDoc({ name: 'Web2 요청함' }), true);
  assert.equal(isOpsDoc({ name: 'Web2 요청함 정리 메모' }), false, '정확히 같은 이름만');
  assert.equal(hiddenReason({ name: 'a.keystore' }), 'secret');
  assert.equal(hiddenReason({ name: 'Web2 요청함' }), 'app');
  assert.equal(hiddenReason({ name: '보통.pdf' }), null);
});

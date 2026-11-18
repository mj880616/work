// UPDATE-운영자전용기록업데이트소식 PR1: main의 Pages 배포 뒤, 저장소의 개발 기록(app/release-notes/*.json)을 묶어
// Edge release-notes-sync로 보낸다. 열쇠는 GitHub Actions OIDC 토큰(대상 web2-release-notes-sync) — 새 비밀값 없음.
// 묶는 규칙은 빌드가 쓰던 것과 같다(app/release-notes-model.mjs buildReleaseNotes). 기록 파일은 공개 배포물에 싣지 않는다.
// 실패해도 화면 배포는 이미 끝났다(workflow가 이 단계 실패를 경고로만 남김). 토큰·응답 본문은 출력하지 않는다.
import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {NOTE_DIR, buildReleaseNotes, collectNotes} from '../../app/release-notes-model.mjs';

export const FUNCTION_URL = 'https://xmlkxfjeagycwttklxjw.supabase.co/functions/v1/release-notes-sync';
export const AUDIENCE = 'web2-release-notes-sync';

export function bundleFrom(root) {
  const dir = join(root, NOTE_DIR);
  const entries = readdirSync(dir).filter(n => n.endsWith('.json')).map(n => [NOTE_DIR + n, readFileSync(join(dir, n), 'utf8')]);
  const {errors} = collectNotes(entries);
  return {text: buildReleaseNotes(entries), errors, count: entries.length};
}

async function main() {
  const root = process.argv[2] || '.';
  const {text, errors, count} = bundleFrom(root);
  if (errors.length) { console.error(`기록 파일 모양 오류 ${errors.length}건 — 보내지 않음`); process.exit(1); }
  const {ACTIONS_ID_TOKEN_REQUEST_URL: url, ACTIONS_ID_TOKEN_REQUEST_TOKEN: reqToken} = process.env;
  if (!url || !reqToken) { console.error('OIDC 토큰을 받을 수 없음(id-token: write 필요)'); process.exit(1); }
  const tokenRes = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, {headers: {authorization: `Bearer ${reqToken}`}});
  if (!tokenRes.ok) { console.error(`OIDC 토큰 요청 실패 ${tokenRes.status}`); process.exit(1); }
  const {value} = await tokenRes.json();
  const res = await fetch(FUNCTION_URL, {method: 'POST', headers: {authorization: `Bearer ${value}`, 'content-type': 'application/json'}, body: text});
  console.log(`기록 ${count}개 보냄 → ${res.status}`);
  if (!res.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

#!/usr/bin/env node
// APP-앱내려받기버튼: 최신 폰 앱 APK 주소를 Pages 배포 때 정해 app/phone-app.json 한 파일로 둔다.
// 화면(app/app-download.mjs)은 같은 주소의 이 파일만 읽는다 — GitHub API를 화면이 직접 부르지 않는다(요청 한도·CSP connect-src 그대로).
// 고르는 규칙(앱 안 업데이트 android-app/…/UpdateRules.kt와 같은 뜻):
// - 이 저장소 공개 릴리스 중 초안·미리보기가 아닌 것, 태그가 정확히 phone-app-v<숫자.숫자.숫자>인 것만(바구니 PC basket-pc-v*와 섞이지 않음).
// - 그 릴리스의 자산 web2-phone-<같은 버전>.apk가 있고 크기가 0보다 크고 64MB 이하인 것.
// - 버전 숫자가 가장 큰 것. 주소는 받은 값을 믿지 않고 저장소·태그·파일 이름으로 다시 만든다.
// 쓰는 길: node scripts/phone-app-latest.mjs <releases.json> <out.json>  (releases.json = GitHub API repos/<저장소>/releases 답)
// 고를 것이 없거나 읽지 못하면 파일을 만들지 않는다(화면은 릴리스 목록 주소로 대신 연다). 배포를 막지 않는다.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

export const PHONE_REPO = 'mj880616/work';
export const APK_MAX_BYTES = 64 * 1024 * 1024;
const TAG = /^phone-app-v(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

export const apkUrl = version => `https://github.com/${PHONE_REPO}/releases/download/phone-app-v${version}/web2-phone-${version}.apk`;

const newer = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]; return false; };

export function pickPhoneApp(releases) {
  if (!Array.isArray(releases)) return null;
  let best = null;
  for (const release of releases) {
    if (!release || release.draft || release.prerelease) continue;
    const m = TAG.exec(String(release.tag_name || ''));
    if (!m) continue;
    const version = `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}`;
    if (version !== `${m[1]}.${m[2]}.${m[3]}`) continue; // 앞자리 0(예: 0.05.1)은 앱도 받지 않는 모양
    const name = `web2-phone-${version}.apk`;
    const asset = (Array.isArray(release.assets) ? release.assets : []).find(a => a && a.name === name);
    const size = Number(asset?.size);
    if (!asset || !Number.isFinite(size) || size <= 0 || size > APK_MAX_BYTES) continue;
    const rank = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!best || newer(rank, best.rank)) best = {rank, version, size};
  }
  return best ? {version: best.version, url: apkUrl(best.version), size: best.size} : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) { console.error('쓰는 길: node scripts/phone-app-latest.mjs <releases.json> <out.json>'); process.exit(2); }
  let picked = null;
  try { picked = pickPhoneApp(JSON.parse(readFileSync(input, 'utf8'))); } catch (error) { console.error(`릴리스 목록을 읽지 못함: ${error.message}`); }
  if (!picked) { console.log('폰 앱 릴리스를 찾지 못함: app/phone-app.json을 만들지 않음(화면은 릴리스 목록 주소로 연다)'); process.exit(0); }
  writeFileSync(output, `${JSON.stringify(picked)}\n`);
  console.log(`폰 앱 최신 판 ${picked.version} → ${output}`);
}

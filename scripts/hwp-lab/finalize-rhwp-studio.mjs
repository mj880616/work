// build-rhwp-studio.sh가 부른다. 빌드 결과에서 시험판에 필요 없는 파일(PWA 서비스워커·설치 정보·예제 문서)을 빼고,
// 편집기 HTML에 Web2 보호 장치(외부 주소 차단 CSP, 기기 저장 차단 guard)를 넣은 뒤 출처·파일 목록을 기록한다.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const [out, version, commit, editorIntegrity, coreIntegrity] = process.argv.slice(2);
if (!out || !version || !commit) throw new Error('usage: finalize-rhwp-studio.mjs <out> <version> <commit> <editor-integrity> <core-integrity>');
const studio = join(out, 'studio');

// Studio PWA service worker/manifest, install icons, bundled examples and duplicate public engine copies.
for (const name of readdirSync(studio)) {
  if (/^(?:sw\.js|registerSW\.js|manifest\.webmanifest|workbox-.*\.js|rhwp\.js|rhwp\.d\.ts|rhwp_bg\.wasm\.d\.ts|samples|icons)$/.test(name)) {
    rmSync(join(studio, name), { recursive: true, force: true });
  }
}

// No external origin may be reached from the editor frame: only same-origin files, inline styles and in-memory data.
export const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "frame-src 'self' blob:",
  "manifest-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`;

function patch(file, edits) {
  let html = readFileSync(file, 'utf8');
  for (const [pattern, replacement] of edits) {
    const next = html.replace(pattern, replacement);
    if (next === html) throw new Error(`${file}: pattern not found ${pattern}`);
    html = next;
  }
  writeFileSync(file, html);
  return html;
}

const index = patch(join(studio, 'index.html'), [
  [/<link rel="manifest"[^>]*>/, ''],
  [/<script id="vite-plugin-pwa:register-sw"[^>]*><\/script>/, ''],
  [/\s*<link rel="apple-touch-icon"[^>]*>/, ''],
  // The guard runs before every studio script (theme/locale init read browser storage synchronously).
  [/(<meta charset="UTF-8" \/>)/, `$1\n  ${cspMeta}\n  <script src="../../studio-guard.js?v=1"></script>`],
]);
patch(join(studio, 'print.html'), [[/(<meta charset="UTF-8">)/, `$1\n  ${cspMeta}`]]);
for (const removed of ['manifest.webmanifest', 'registerSW.js', 'icons/', 'sw.js']) {
  if (index.includes(removed)) throw new Error(`index.html still references ${removed}`);
}

function files(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  }).sort();
}
const payload = files(out).filter(path => !/(?:SHA256SUMS|SOURCE\.md)$/.test(path));
const rows = payload.map(path => `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${relative(out, path)}`);
writeFileSync(join(out, 'SHA256SUMS'), rows.join('\n') + '\n');
const total = payload.reduce((sum, path) => sum + statSync(path).size, 0);
writeFileSync(join(out, 'SOURCE.md'), `# rhwp ${version} 반입 기록

HWP-편집기 1단계 시험판용. \`scripts/hwp-lab/build-rhwp-studio.sh\`로 다시 만들 수 있다. 직접 고치지 않는다.

| 항목 | 값 |
| --- | --- |
| 편집기 본체 \`studio/\` | github.com/edwardkim/rhwp 태그 \`v${version}\` (커밋 \`${commit}\`)의 \`rhwp-studio\`를 \`RHWP_DISABLE_EXTERNAL_WEBFONTS=1 RHWP_WITHOUT_HWPCTRL=1 vite build --base=./\`로 빌드 |
| WASM 엔진 | npm \`@rhwp/core@${version}\` (\`${coreIntegrity}\`) |
| 임베드 SDK \`sdk/\` | npm \`@rhwp/editor@${version}\` (\`${editorIntegrity}\`) |
| 라이선스 | \`LICENSE\`(MIT), \`THIRD_PARTY_LICENSES.md\`, 글꼴 \`studio/fonts/FONTS.md\`·\`studio/fonts/*OFL*\` |
| 뺀 파일 | PWA 서비스워커·설치 정보·아이콘, 예제 문서(\`samples/\`), 중복 엔진 사본 |
| 넣은 것 | \`studio/index.html\`·\`print.html\`에 외부 주소 차단 CSP, \`index.html\` 맨 앞에 \`../../studio-guard.js\`(기기 저장 차단) |
| 파일 수·총 크기(이 기록 제외) | ${payload.length}개 · ${(total / 1048576).toFixed(1)} MiB (\`SHA256SUMS\` 참고) |
`);
console.log(`rhwp ${version}: ${payload.length} files, ${(total / 1048576).toFixed(1)} MiB`);

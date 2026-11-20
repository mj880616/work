import { faceOf, FACES, DEFAULT_FACE, wordIn } from '../app/brand/faces.mjs';

// APP-올인원다이어리 단계 2(docs/design/allinone-diary-plan.md): Pages 빌드가 얼굴을 정한다.
// 지금 운영 빌드(nojo, 기본)는 입력을 그대로 돌려준다 — 빌드 결과가 얼굴 기능 전과 한 바이트도 다르지 않다(scripts/brand-face.test.mjs).
// 다른 얼굴은 빌드 입력에서만 아래를 고쳐 쓴다(저장소 파일은 그대로):
//   app/brand/face.mjs        얼굴 이름 한 줄 → 화면 JS가 app/brand/brand.mjs로 읽는다(실행 중에는 바뀌지 않음)
//   app/windows-manifest.json 앱 이름·짧은 이름·설명·색(아이콘이 app/app-icon.svg와 같으면 PNG 아이콘 목록은 그대로)
//   app/app-icon.svg          얼굴 아이콘(지금 두 얼굴 모두 WORK ON+ 표장 A라 같은 파일)
//   app/**.html               눈에 보이는 글자(태그 사이·aria-label·alt·title·placeholder)의 단어표 단어, 밝은 theme-color,
//                             얼굴 아이콘이 다르면 PNG 아이콘 줄(PNG는 app/app-icon.svg 그림이므로)
export const FACE_IDS = Object.freeze(Object.keys(FACES));
export const FACE_FILE = 'app/brand/face.mjs';
export const WEB_MANIFEST = 'app/windows-manifest.json';
export const APP_ICON = 'app/app-icon.svg';

const isAppHtml = file => file.startsWith('app/') && file.endsWith('.html');

const ownIcon = face => face.icon !== APP_ICON;

/** baseIcons: 저장소 manifest의 아이콘 목록. 얼굴 아이콘이 app/app-icon.svg와 같으면 그 목록(PNG 포함)을 그대로 쓴다. */
export function faceManifest(face, baseIcons = null) {
  return `${JSON.stringify({
    name: face.name, short_name: face.shortName, description: face.description,
    id: './', start_url: './', scope: './', display: 'standalone',
    background_color: face.backgroundColor, theme_color: face.themeColor, lang: 'ko-KR',
    icons: !ownIcon(face) && Array.isArray(baseIcons) ? baseIcons : [{ src: './app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
  })}\n`;
}

/** HTML 한 장에 얼굴을 입힌다. 바꾸는 것은 사람 눈에 보이는 글자뿐이다: 태그 사이 글자(<script>·<style>·주석 밖)와
 * aria-label·alt·title·placeholder 값. 글자 안의 표 단어를 app/brand/faces.mjs wordIn으로 바꾼다(코드·속성 이름은 그대로). */
export function faceHtml(html, face) {
  const base = faceOf(DEFAULT_FACE);
  const words = { [base.name]: face.name, ...face.words };
  const look = { ...face, words };
  const say = text => wordIn(look, text);
  const visible = part => part
    .replace(/>([^<>]+)</g, (_, text) => `>${say(text)}<`)
    .replace(/(\s(?:aria-label|alt|title|placeholder)=")([^"]*)(")/g, (_, a, text, b) => `${a}${say(text)}${b}`);
  let out = html.split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->)/).map((part, i) => i % 2 ? part : visible(part)).join('');
  out = out.replace(/(<meta name="theme-color" content=")[^"]*(" media="\(prefers-color-scheme: light\)">)/g, `$1${face.themeColor}$2`);
  if (ownIcon(face)) out = out.replace(/<link rel="(?:icon|apple-touch-icon)" href="[^"]*icons\/app-icon-[^"]*"[^>]*>\n?/g, '');
  return out;
}

/** files: buildPages 입력({경로: 글자 | Buffer}). nojo면 같은 객체를 그대로 돌려준다. */
export function applyFace(files, faceId = DEFAULT_FACE) {
  if (!FACE_IDS.includes(faceId)) throw new Error(`모르는 얼굴: ${faceId} (${FACE_IDS.join(', ')})`);
  if (faceId === DEFAULT_FACE) return files;
  const face = faceOf(faceId);
  if (!Object.hasOwn(files, FACE_FILE)) throw new Error(`${FACE_FILE}가 빌드 입력에 없습니다.`);
  if (!Object.hasOwn(files, face.icon)) throw new Error(`${face.icon} 아이콘이 빌드 입력에 없습니다.`);
  const out = { ...files };
  out[FACE_FILE] = `export const FACE_ID = '${face.id}';\n`;
  let baseIcons = null;
  try { baseIcons = JSON.parse(Buffer.from(files[WEB_MANIFEST] ?? '').toString('utf8')).icons ?? null; } catch { baseIcons = null; }
  out[WEB_MANIFEST] = Buffer.from(faceManifest(face, baseIcons), 'utf8');
  out[APP_ICON] = files[face.icon];
  for (const file of Object.keys(out)) if (isAppHtml(file) && typeof out[file] === 'string') out[file] = faceHtml(out[file], face);
  return out;
}

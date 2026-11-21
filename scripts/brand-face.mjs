import { faceOf, FACES, DEFAULT_FACE, wordIn } from '../app/brand/faces.mjs';
import { SLOTS } from '../app/brand/custom-words-model.mjs';

// APP-올인원다이어리 단계 2(docs/design/allinone-diary-plan.md): Pages 빌드가 얼굴을 정한다.
// 지금 운영 빌드(nojo, 기본)는 입력을 그대로 돌려준다 — 빌드 결과가 얼굴 기능 전과 한 바이트도 다르지 않다(scripts/brand-face.test.mjs).
// 다른 얼굴은 빌드 입력에서만 아래를 고쳐 쓴다(저장소 파일은 그대로):
//   app/brand/face.mjs        얼굴 이름 한 줄 → 화면 JS가 app/brand/brand.mjs로 읽는다(실행 중에는 바뀌지 않음)
//   app/windows-manifest.json 앱 이름·짧은 이름·설명·색(아이콘이 app/app-icon.svg와 같으면 PNG 아이콘 목록은 그대로)
//   app/app-icon.svg          얼굴 아이콘(지금 두 얼굴 모두 WORK ON+ 표장 A라 같은 파일)
//   app/**.html               눈에 보이는 글자(태그 사이·aria-label·alt·title·placeholder)의 단어표 단어, 밝은 theme-color,
//                             얼굴 아이콘이 다르면 PNG 아이콘 줄(PNG는 app/app-icon.svg 그림이므로)
//   app/index.html(앱 바탕)    S67-56·S67-62: 얼굴 단어로 바꾼 글자는 모두 바꾼 글자 앞에 원래 글자를 남긴다
//                             (태그 사이 글자는 바로 앞 주석 <!--word:원래 글자-->, 속성은 data-word-속성 이름="원래 글자").
//                             <html>에는 data-word-faced(이 바탕 글자는 이미 얼굴 단어). 고친 이름이나 바탕 낱말 묶음(S67-62, 예: 노동조합+ 낱말)이
//                             있는 사람은 시작 때 app/brand/custom-words-shell.mjs가 원래 글자에서 다시 맞춘다(빌드가 지운 원래 글자를 되찾는 길, 화면 한 번 그리기 전).
//                             S67-56은 이름 칸 열쇠가 든 글자만 남겼으나, 바탕 낱말 묶음은 칸 밖 낱말(노조 서식 등)도 되돌려야 해서 바꾼 글자 모두로 넓혔다.
export const FACE_IDS = Object.freeze(Object.keys(FACES));
export const FACE_FILE = 'app/brand/face.mjs';
export const WEB_MANIFEST = 'app/windows-manifest.json';
export const APP_ICON = 'app/app-icon.svg';

const isAppHtml = file => file.startsWith('app/') && file.endsWith('.html');
/** 고친 이름·바탕 낱말 묶음을 입히는 앱 바탕(app/brand/custom-words-shell.mjs가 document.body에 한 번 입힌다). */
export const SHELL_HTML = 'app/index.html';

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
export function faceHtml(html, face, { keepOriginals = false } = {}) {
  const base = faceOf(DEFAULT_FACE);
  const words = { [base.name]: face.name, ...face.words };
  const look = { ...face, words };
  const say = text => wordIn(look, text);
  // keepOriginals(앱 바탕): 바꾼 글자는 모두 원래 글자를 남긴다(위 머리말). 원래 글자는 주석·속성 안에 그대로 들어가므로
  // 주석을 깨는 '--'·글자 참조 '&'가 든 글자는 빌드를 멈춘다(지금 앱 바탕에는 없음, scripts/brand-face.test.mjs).
  const keep = (text, changed) => {
    if (!keepOriginals || changed === text) return false;
    if (text.includes('--') || text.includes('&')) throw new Error(`앱 바탕 글자에 원래 글자를 남길 수 없음: ${JSON.stringify(text)}`);
    return true;
  };
  const textPart = text => { const next = say(text); return keep(text, next) ? `><!--word:${text}-->${next}<` : `>${next}<`; };
  const attrPart = (_, a, name, text, b) => { const next = say(text); return `${a}${next}${b}${keep(text, next) ? ` data-word-${name}="${text}"` : ''}`; };
  const visible = part => part
    .replace(/>([^<>]+)</g, (_, text) => textPart(text))
    .replace(/(\s(aria-label|alt|title|placeholder)=")([^"]*)(")/g, (m, a, name, text, b) => attrPart(m, a, name, text, b));
  let out = html.split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->)/).map((part, i) => i % 2 ? part : visible(part)).join('');
  if (keepOriginals) out = out.replace(/<html\b/, '<html data-word-faced');
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
  for (const file of Object.keys(out)) if (isAppHtml(file) && typeof out[file] === 'string') out[file] = faceHtml(out[file], face, { keepOriginals: file === SHELL_HTML });
  return out;
}

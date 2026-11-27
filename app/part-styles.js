// S67-41 공용 부품 꾸밈 보장(명진 11/20 20:40 "이런 경우가 잦네 / 꾸밈 못불러오는"):
// 여러 화면에서 쓰는 공용 부품의 모양 파일을 그 부품이 스스로 부른다. 전에는 화면별 모양 목록(view-loader.js routeStyles)에만 기대서,
// 목록에 그 파일이 없는 화면(예: 브리핑 룸 → 자료실 고르기 창)을 첫 화면으로 열면 부품이 꾸밈 없이(브라우저 기본 단추) 그려졌다.
// - 부품 → 모양 파일 대응은 아래 표 하나. 불러오기는 view-loader.js의 style() 하나(이미 있으면 곧바로, 부르는 중이면 같은 약속).
// - 첫 화면 준비 사슬(loader-v2.js가 화면 공개 전에 부르는 모듈의 정적 import)에 없는 부품은 모듈 맨 위에서 `await partStyles('이름')` —
//   부품 모듈이 다 열리기(그 부품을 쓰는 화면이 그려지기) 전에 모양이 붙는다.
//   첫 화면 사슬 안 부품(row-menu)은 모듈 맨 위에서 기다리면 첫 화면이 늦어지므로 여는 함수가 기다린다(tests/part-styles.test.mjs가 이 둘을 지킨다).
// - 주소는 번호 없는 경로. Pages 빌드가 화면 목록과 같은 해시 번호를 붙인다(AGENTS.md 4절).
// - 시험 환경(Node, 가짜 document)에서는 아무 일도 하지 않는다.
export const PART_STYLES = Object.freeze({
  'library-move-picker': ['./library-upload.css'],
  'folder-look': ['./folder-look.css'],
  'choice-sheet': ['./choice-sheet.css'],
  'area-org-picker': ['./choice-sheet.css', './area-org-picker.css'],
  'small-form-modal': ['./small-form-modal.css'],
  'doc-scan': ['./doc-scan.css'],
  'basket-upload': ['./basket-picker.css'],
  'row-swipe': ['./row-swipe.css'],
  'row-menu': ['./od-link.css'],
  'od-link': ['./od-link.css'],
  'markdown-view': ['./markdown-view.css'],
  'html-frame': ['./markdown-view.css'],
  'record-sheet': ['./record-sheet.css'],
  'record-files': ['./record-sheet.css'],
  'filter-chips': ['./filter-chips.css'],
  'folder-tree-ui': ['./folder-tree.css'],
  'tree-icons': ['./folder-tree.css'],
  'list-edit': ['./list-edit.css'],
  'google-tasks': ['./google-tasks.css'],
  'task-files': ['./google-tasks.css'],
  'todo-radar': ['./todo-radar.css'],
  'record-window-view': ['./weekly-org-lines.css'],
  'biz-detail-window': ['./weekly-org-lines.css', './biz-summary.css'],
  'weekly-summary-table': ['./biz-summary.css'],
  'text-highlights': ['./news-mark-rows.css'],
  'photo-strip': ['./diary.css'],
  'marquee-select': ['./marquee-select.css'],
  'folder-dest-sheet': ['./folder-tree.css', './folder-dest-sheet.css'],
  'memo-thread': ['./memo-thread.css'],
  'lock-pad': ['./lock.css'],
  'trash-row': ['./trash-row.css'],
});

const browser = () => typeof window !== 'undefined' && typeof document !== 'undefined' && !!document.head
  && typeof HTMLLinkElement === 'function' && typeof location !== 'undefined';
let loader = null;
// 불러오기 도구(view-loader.js)는 앱 껍데기가 첫 화면 전에 붙인다. 여기서 그 파일을 import하지 않는다(빌드 해시 계산에 순환이 생김).
// 아직 없으면 붙었다는 알림(kptu:view-loader-installed)을 기다린다(3초 한도). 앱 껍데기 밖(시험 틀 화면 등)에서는 기다리지 않는다.
function viewLoader() {
  if (window.KPTUViewLoader?.style) return Promise.resolve(window.KPTUViewLoader);
  if (!window.__KPTU_APP_SCRIPT_URL__) return Promise.resolve(null);
  return loader ||= new Promise(resolve => {
    const done = () => resolve(window.KPTUViewLoader?.style ? window.KPTUViewLoader : null);
    window.addEventListener('kptu:view-loader-installed', done, {once: true});
    setTimeout(done, 3000);
  });
}
// 표의 경로는 이 파일 기준(앱 폴더)이다. 화면 주소가 다른 폴더여도 같은 파일을 가리키게 절대 주소로 넘긴다.
const absolute = path => new URL(path, import.meta.url).href;
const sameFile = (a, b) => { const x = new URL(a, location.href), y = new URL(b, location.href); return x.origin === y.origin && x.pathname === y.pathname; };

/** 그 부품의 모양 파일이 모두 붙어 있으면 true(여는 함수가 기다릴지 고를 때). 시험 환경은 늘 true. */
export function partStylesReady(name) {
  if (!browser()) return true;
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
  return (PART_STYLES[name] || []).every(path => links.some(link => sameFile(link.href, absolute(path)) && link.sheet));
}

/** 그 부품의 모양 파일을 부르고, 다 붙으면(실패해도) 풀린다. 표에 없는 이름은 곧바로 풀린다. */
export async function partStyles(name) {
  const paths = PART_STYLES[name];
  if (!paths?.length || !browser()) return true;
  const L = await viewLoader();
  if (!L?.style) return false;
  const done = await Promise.all(paths.map(path => L.style(absolute(path))));
  return done.every(Boolean);
}

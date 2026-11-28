// HOME-업무일지홈(2026-10-30 명진 시안 v2 확정): 홈의 '잊지 말기' 숫자 세기(메뉴 '홈' 표시)와 그날 첫 챙길 것 찾기.
// - 숫자 = 연결 안 된 업데이트(미분류) + 처리 전 후보(텔레그램 요청 포함, 이미 할 일로 만든 제목은 뺌) + 가족 잊지 말기 제안(운영자 기능 family일 때)
//   + 처리 전 소식. 정리함 한 목록의 처리 전 줄과 같은 기준이다(상대 약속은 세지 않음). 메뉴 '홈' 표시(UI-앱안알림, home-asks.js)가 이 숫자를 쓴다.
// - QUICK-입력정리(2026-11-28 사용자 결정 '홈 막대 통째로 없앰'): 홈 아래 고정 막대([잊지 말기 ▾ | 할 일] 입력칸 + [잊지 말기 n] 칩)는 지웠다.
//   그 칩이 이 파일의 화면 몫이었다 — 이제 이 파일은 화면에 아무것도 그리지 않는다.
// - 챙길 것 찾기(D7): 이 탭에서 그날 처음 홈을 열 때 서버에 한 번(todo-radar.js autoFindToday).
// 기기 저장 없음. 가족 줄은 세기만 한다(내용을 이 화면에 그리지 않음).
import {readInboxCount, readInboxParts} from './inbox-count.js';
import {autoFindToday} from './todo-radar.js';
import {setHomeAsks} from './home-asks.js';
import {countOpenNews} from './forget-news-data.js';
import {hasFamily, readNotes} from './family-notes-data.js';


// 순수: 숫자들 → '잊지 말기' 처리 안 한 수. 모르는 값(null)은 null(표시 내림). family는 모르면 0(가족 기능 없음·못 읽음).
// news: 처리 전 소식(FORGET-소식합치기, 명진 '넣어') — 운영자 작업공간만, 모르면 0.
export function forgetCount({update, todo, family = 0, news = 0} = {}) {
  const n = v => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const u = n(update), t = n(todo);
  if (u === null || t === null) return null;
  return u + t + (n(family) || 0) + (n(news) || 0);
}
export function mountHomeSummary({root, rt = window.KPTURuntime}) {
  if (!root) return null;
  let run = 0;
  const scope = () => { const c = rt.context.read(); return `${c?.user?.id || ''}:${c?.workspace?.id || ''}`; };
  // count: 처리 안 한 수(null = 모름 → 표시를 내린다).
  // UI-앱안알림 3단계(A4): 같은 숫자로 메뉴 '홈' 표시(home-asks.js). 모르면 표시를 내린다.
  const paint = count => setHomeAsks(count);
  // 가족 잊지 말기 제안 수: 운영자 기능 family(서버 app_my_features)일 때만 읽는다. 못 읽으면 0(줄은 그대로).
  async function familyCount() {
    const ws = rt.context.read()?.workspace?.id;
    if (!ws || !(await hasFamily(rt).catch(() => false))) return 0;
    try { return (await readNotes(rt, ws)).length; } catch { return 0; }
  }
  // early: 들어올 때 미리 시작한 읽기(PERF-첫로딩 요청 합치기, S48-59). 빼야 할 할 일 제목은 할 일을 읽은 뒤에야 알므로 세기만 그 뒤에 한다.
  async function refresh(early = null) {
    const mine = ++run, owner = scope();
    const titles = (window.KPTUGoogleTasks?.peekTasks?.()?.tasks || []).filter(t => t?.status !== 'completed').map(t => t.title);
    const [out, family, news] = await Promise.all([readInboxCount(rt, {taskTitles: titles, parts: early?.parts}), familyCount(), countOpenNews(rt).catch(() => 0)]);
    if (mine !== run || owner !== scope()) return;
    paint(out?.ok ? forgetCount({update: out.update, todo: out.todo, family, news}) : null);
  }
  // 옛 홈처럼 할 일 모듈을 처음부터 불러 둔다(달력 하루 목록·할 일 화면이 같은 KPTUGoogleTasks를 씀).
  let google = null;
  const loadGoogle = () => (google ||= Promise.all([import('./organization-order.js'), import('./google-tasks.js')]).then(() => window.KPTUGoogleTasks).catch(e => { google = null; throw e; }));
  void loadGoogle().catch(() => {});
  // HOME-잊지말기숫자(S61-44): 'kptu:session-changed'는 로그인한 사람이 바뀔 때만이 아니라 같은 사람의 로그인 이어 가기(토큰 새로 받기, 약 1시간마다·
  // 앱을 다시 열 때)에도 온다(runtime-client.js write). 그때마다 표시를 '모름'으로 내리고 읽던 셈까지 버리면, 홈에 다시 들어올 때까지
  // 표시가 사라진다. 사람·작업공간(scope)이 바뀐 때만 지우고, 같은 사람이면 숫자를 그대로 둔다.
  let shown = scope();
  window.addEventListener('kptu:session-changed', () => { const next = scope(); if (next === shown) return; shown = next; run++; paint(null); });
  // 정리함(잊지 말기) 한 목록에서 처리하면 숫자를 다시 센다(홈이 보이는 동안만 읽음).
  window.addEventListener('kptu:todo-radar-changed', event => { if (event.detail?.reload && window.KPTURouter?.current === 'home') void refresh(); });
  return {
    // 홈에 들어올 때마다: 숫자 다시 읽기 + 그날 첫 찾기.
    // 옛 홈처럼 들어올 때 Google 할 일 목록을 한 번 읽어 공용 사본(달력 하루 목록·정리함 '이미 할 일' 거르기·요약 숫자)이 최신이 되게 한다.
    //   숫자는 그 뒤 한 번 센다('이미 할 일로 만든 것'을 빼려고). 할 일을 못 읽어도 센다.
    //   PERF-첫로딩 요청 합치기(S48-59): 숫자 재료(정리함·챙길 것) 읽기는 할 일 읽기를 기다리지 않고 바로 시작한다 — 업무일지가 같은 때
    //   정리함을 읽으므로 같은 주소 요청이 한 번만 나간다(runtime single flight). 세기는 전처럼 할 일 읽기 뒤.
    enter() {
      void autoFindToday();
      const parts = readInboxParts(rt);
      parts.catch(() => {}); // 실패는 refresh가 받는다(그 전에 끝나도 처리되지 않은 실패로 남지 않게)
      void loadGoogle().then(g => g?.listTasks?.({publish: true})).catch(() => {}).finally(() => refresh({parts}));
    },
    refresh,
  };
}

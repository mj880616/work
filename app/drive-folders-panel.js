// S69-41(명진 11/24): 내 프로필 '구글 드라이브' 칸 한 줄: '앱이 쓰는 드라이브 폴더: 내 드라이브 › (앱 폴더 이름) [열기 ↗]'.
// S70-29(2026-11-25 명진 '다 없애 1회용 기능'·조사 문서 7번 '자동으로 바꿈'): [한곳으로 모으기] 버튼·확인창·결과 줄은 지웠다.
// 앱 폴더 모으기·옛 이름 맞추기는 서버가 맨 위 앱 폴더를 처음 만들 때 저절로 한다(_shared/gather-folders.mjs gatherIntoNewRoot),
// 옛 이름은 기능이 그 폴더를 쓸 때 바뀐다(app-folders.mjs renameIfOld). 이 칸은 위치만 보인다 — 서버 세기(dry_run, 바꾸지 않음) 한 번으로 이름·주소를 받는다.
// 이 장(host) 안은 이 모듈만 그린다.
import {groupHtml, linkRow, infoRow} from './settings-list.mjs';

const PLACE = '/functions/v1/workspace-drive?action=gather-folders';
const DRIVE_FOLDER_URL = /^https:\/\/drive\.google\.com\/drive\/folders\/[A-Za-z0-9_-]{10,200}$/;
const rootName = name => typeof name === 'string' && name.trim() ? name.trim().slice(0, 60) : '맨 위 앱 폴더';
const num = v => Math.max(0, Number(v) || 0);

/** 세기 답 → 그릴 값. 모양이 어긋나면 null(칸을 감춤). */
export function cleanPlan(plan) {
  if (!plan || typeof plan !== 'object' || plan.ok !== true) return null; // 서버 답 모양(ok:true)일 때만 그린다
  const url = typeof plan.root_url === 'string' && DRIVE_FOLDER_URL.test(plan.root_url) ? plan.root_url : null;
  return {name: rootName(plan.root_name), url, isNew: plan.root_new === true, dup: num(plan.rename_dup)};
}

/** 장 HTML(공용 설정 줄): '앱이 쓰는 폴더' 한 줄(내 드라이브 › 이름) + 열기 ↗(주소를 알 때). 같은 자리에 새 이름 폴더가 이미 있어 그대로 둔 수는 작게.
 *  '로그인 계정'은 이 화면에만 보이는 메일 주소(저장·기록하지 않음). 드라이브에 연결된 계정을 알려 주는 서버 답이 없어(새로 만들려면 Edge 변경) 로그인 계정을 보인다. */
export function driveFoldersHtml(p, {account = ''} = {}) {
  if (!p) return '';
  const where = `내 드라이브 › ${p.name}${p.isNew ? ' (아직 없음)' : ''}`;
  const folder = p.url
    ? linkRow({label: '앱이 쓰는 폴더', desc: where, sum: '열기', href: p.url, attrs: {'data-dfp-open': true}, ariaLabel: `구글 드라이브에서 ${p.name} 열기`})
    : infoRow({label: '앱이 쓰는 폴더', desc: where});
  const dup = p.dup ? infoRow({label: '같은 이름 있어 그대로', sum: String(p.dup), attrs: {'data-dfp-dup': true, title: '같은 자리에 새 이름 폴더가 이미 있어 합치지 않고 그대로 둔 앱 폴더'}}) : '';
  const who = account ? infoRow({label: '로그인 계정', desc: account, descAttrs: {'data-dfp-account': true}}) : '';
  return groupHtml([folder, dup, who]);
}

/** 내 프로필 '구글 드라이브' 장. 드라이브 연결이 없거나 읽기가 실패하면 장이 비고 첫 화면 줄도 없다(onSummary show:false). */
export function mountDriveFolders(host, {rt = globalThis.window?.KPTURuntime, account = () => '', onSummary} = {}) {
  let plan = null, owner = 0, loaded = false;
  function render() {
    const html = driveFoldersHtml(plan, {account: account()});
    if (host.innerHTML !== html) host.innerHTML = html;
    if (plan) onSummary?.({text: `${plan.name} 폴더`}); else if (loaded) onSummary?.({show: false});
  }
  async function load() {
    const mine = ++owner;
    let next = null;
    try { next = cleanPlan(await rt.api(PLACE, {method: 'POST', body: {dry_run: true}})); } catch { next = null; }
    if (mine !== owner) return;
    plan = next; loaded = true; render();
  }
  render();
  return {load, plan: () => plan};
}

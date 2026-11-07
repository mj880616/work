// FILES-내PC드라이브 ②(S50-27, 설계 docs/design/files-pc-drive.md, 시안 A — 명진 결정 11/05): [파일] '내 PC' 줄 모양 계산. DOM·네트워크 없음.
// - 바구니 PC 앱의 문(basket-pc PcDoor.cs, 127.0.0.1:47620~47622)이 돌려준 드라이브·목록을 [파일] 화면이 클라우드 색인 줄과 같은 모양으로 그리게 바꾼다:
//   {source:'pc', item_id: 'C:\\문서\\a.docx', parent_id: 'C:\\문서', name, is_folder, size_bytes, modified_at, folder_path}.
// - 경로 규칙은 PC 앱(PcPath.Parse)과 같게 본다(앱이 다시 본다): 'C:\\' 아래, 빈 칸·'.'·'..'·끝 점/빈칸·금지 글자·제어 글자 거절.
// - PC 파일 목록·이름은 화면 메모리에만 있고 서버·로그·브라우저 저장소에 남기지 않는다(이 파일은 계산만).
export const PC_SOURCE = 'pc';
export const PC_NAME = '내 PC';
export const PC_PORTS = Object.freeze([47620, 47621, 47622]);
export const pcDoorOrigin = port => `http://127.0.0.1:${port}`;
const PATH_MAX = 1024, SEG_MAX = 255;
// eslint-disable-next-line no-control-regex
const BAD = /[<>:"/\\|?*\u0000-\u001f]/;
const DEVICES = /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])$/i;

// 'C:\\a\\b' → ['C:', 'a', 'b'], 'C:\\' → ['C:']. 틀리면 null.
export function pcSegs(path) {
  const p = typeof path === 'string' ? path : '';
  if (p.length < 2 || p.length > PATH_MAX || !/^[A-Za-z]:/.test(p)) return null;
  if (p.length > 2 && p[2] !== '\\') return null;
  let rest = p.length > 3 ? p.slice(3) : '';
  if (rest.endsWith('\\')) rest = rest.slice(0, -1);
  const segs = [p[0].toUpperCase() + ':'];
  if (!rest) return segs;
  for (const s of rest.split('\\')) {
    if (!s || s.length > SEG_MAX || s === '.' || s === '..' || /[. ]$/.test(s) || BAD.test(s)) return null;
    const dot = s.indexOf('.');
    if (DEVICES.test((dot < 0 ? s : s.slice(0, dot)).trimEnd())) return null;
    segs.push(s);
  }
  return segs;
}
export const pcJoin = segs => (segs.length === 1 ? segs[0] + '\\' : segs.join('\\'));
export const pcPathOk = path => pcSegs(path) !== null;
// 가지런한 경로(드라이브 글자 대문자, 끝 역슬래시는 드라이브 뿌리만).
export const pcNorm = path => { const s = pcSegs(path); return s ? pcJoin(s) : null; };
export const pcParent = path => { const s = pcSegs(path); return s && s.length > 1 ? pcJoin(s.slice(0, -1)) : null; };
export const pcBase = path => { const s = pcSegs(path); return s ? s[s.length - 1] : ''; };
export const pcChild = (dir, name) => { const s = pcSegs(dir); return s && typeof name === 'string' ? pcNorm(pcJoin([...s, name])) : null; };
const okName = n => typeof n === 'string' && n.length > 0 && n.length <= SEG_MAX && !BAD.test(n) && n !== '.' && n !== '..';

// 드라이브 이름: 이름표가 있으면 '자료 (D:)', 없으면 '로컬 디스크 (C:)' / 꽂는 것은 '이동식 디스크 (E:)'.
export function pcDriveName(d) {
  const letter = String(d?.root || '').slice(0, 2);
  const label = typeof d?.label === 'string' ? d.label.trim().slice(0, 60) : '';
  return `${label || (d?.kind === 'removable' ? '이동식 디스크' : '로컬 디스크')} (${letter})`;
}
// /v1/drives 답 → 나무·목록 줄(폴더 줄, 맨 위).
export function pcDriveRows(body) {
  const list = Array.isArray(body?.drives) ? body.drives : [];
  const out = [], seen = new Set();
  for (const d of list) {
    const root = pcNorm(d?.root);
    if (!root || pcSegs(root).length !== 1 || seen.has(root)) continue;
    seen.add(root);
    out.push({source: PC_SOURCE, item_id: root, parent_id: null, name: pcDriveName({...d, root}), is_folder: true,
      size_bytes: null, modified_at: null, mime: null, folder_path: '', starred: false, library_doc_id: null, hash: null});
  }
  return out;
}
// /v1/list 답 → 줄. dir = 물어본 폴더(답의 path가 다르면 버림).
export function pcListRows(body, dir) {
  const at = pcNorm(dir);
  if (!at || pcNorm(body?.path) !== at) return null;
  const segs = pcSegs(at), folderPath = segs.join(' › ');
  const out = [];
  for (const e of Array.isArray(body?.entries) ? body.entries : []) {
    if (!e || !okName(e.name)) continue;
    const id = pcChild(at, e.name);
    if (!id) continue;
    const folder = e.dir === true, s = Number(e.size), m = Date.parse(e.modified || '');
    out.push({source: PC_SOURCE, item_id: id, parent_id: at, name: e.name, is_folder: folder,
      size_bytes: folder || !Number.isFinite(s) || s < 0 ? null : s,
      modified_at: Number.isFinite(m) && m > 0 ? new Date(m).toISOString() : null,
      mime: null, folder_path: folderPath, starred: false, library_doc_id: null, hash: null});
  }
  return out;
}
// 위치 줄(app_cloud_trail과 같은 모양): 지금 폴더가 depth 0. 드라이브 줄 이름은 'C:'.
export function pcTrail(path) {
  const segs = pcSegs(path);
  if (!segs) return [];
  return segs.map((name, i) => ({item_id: pcJoin(segs.slice(0, i + 1)), name, depth: segs.length - 1 - i}));
}

// 문 답 /v1/hello → 쓸 수 있나. 바구니 PC 앱만(app = 'basket-pc', door 1, list를 앎).
export const pcHelloOk = body => body?.app === 'basket-pc' && body?.door === 1 && Array.isArray(body?.can) && body.can.includes('list');
// FILES-내PC클라우드옮기기(S52-41): 문이 아는 일 목록(can)만 남긴다(정해 둔 말만). 0.4.0+ 문은 read·write·trash를 더 안다.
const PC_CAN = ['drives', 'list', 'open', 'reveal', 'read', 'write', 'trash', 'pins'];
export const pcCanList = body => (Array.isArray(body?.can) ? PC_CAN.filter(c => body.can.includes(c)) : []);
// 내 PC ↔ 클라우드 복사·옮기기를 할 수 있는 문인가(읽기·쓰기·휴지통을 모두 앎).
export const pcCanXfer = can => Array.isArray(can) && ['read', 'write', 'trash'].every(c => can.includes(c));
// 문 답 HTTP 상태·오류 글자 → 짧은 까닭(정해 둔 말만).
export function pcCode(status, error) {
  const e = typeof error === 'string' && /^[a-z_]{1,24}$/.test(error) ? error : '';
  if (e) return e;
  if (status === 401) return 'bad_token';
  if (status === 403) return 'blocked';
  if (status === 404) return 'not_found';
  return 'read';
}
// 나무 맨 끝 흐린 줄 이름(문이 답하지 않을 때).
export const pcOffRowName = why => (why === 'ask' ? '내 PC · 눌러서 연결' : why === 'old_app' ? '내 PC · 새 판 필요' : '내 PC · 꺼짐');
// 이 브라우저가 '내 PC'를 그릴 곳인가: 윈도우 PC 브라우저(폰 앱·폰 브라우저·안드로이드 큰 화면은 아님). 바구니 PC 앱이 윈도우 전용이다.
export const pcDeviceOk = ({ua = '', kind = ''} = {}) => kind === 'pc' && /Windows NT/i.test(ua) && !/Android|KPTUAndroid/i.test(ua);
// 문 상태 → 나무·안내 한 줄. off = 문이 답하지 않음(꺼짐·앱 없음·크롬이 막음).
export function pcStateText(why) {
  switch (why) {
    case 'off': return "내 PC가 꺼져 있어요. 화면 오른쪽 아래 바구니 아이콘을 오른쪽 클릭 → [웹2에서 이 PC 보기]를 켜 주세요. 처음 한 번 크롬이 '다른 앱에 연결' 허락을 물으면 [허용]을 눌러 주세요.";
    case 'pc_signed_out': return '바구니 PC 앱이 로그아웃돼 있어요. 트레이 아이콘에서 다시 로그인해 주세요.';
    case 'other_user': return '바구니 PC 앱에 다른 계정으로 로그인돼 있어요. 같은 계정으로 로그인해 주세요.';
    case 'bad_token': case 'no_token': return '웹2 로그인을 확인하지 못했어요. 다시 확인을 눌러 주세요.';
    case 'auth_unavailable': return '바구니 PC 앱이 로그인을 확인하지 못했어요(인터넷 연결). 잠시 뒤 다시 확인해 주세요.';
    case 'old_app': return '바구니 PC 앱을 새 판으로 올려 주세요.';
    case 'ask': return "'내 PC'를 누르면 크롬이 처음 한 번 '다른 앱에 연결' 허락을 물어요. [허용]을 눌러 주세요.";
    case 'denied': return "크롬에서 이 사이트의 '로컬 네트워크 접근'이 막혀 있어요. 주소창 왼쪽 아이콘 → 사이트 설정에서 허용으로 바꿔 주세요.";
    default: return '내 PC에 닿지 못했어요. 다시 확인을 눌러 주세요.';
  }
}
// 목록·열기 실패 → 한 줄(files-model errorText가 'pc_' 앞머리를 여기로 보낸다).
export function pcErrorText(code) {
  switch (code) {
    case 'exists': return '같은 이름 파일이 이미 있어요';
    case 'risky_kind': return '프로그램 파일(.exe 등)은 내 PC로 받지 않아요';
    case 'too_big': return '한 파일은 2GB까지 내 PC로 받아요';
    case 'no_space': return '내 PC 디스크 공간이 모자라요';
    case 'bad_piece': case 'bad_range': return '파일이 보내는 동안 바뀌었어요. 다시 해 주세요';
    case 'busy': return '내 PC가 다른 파일을 여러 개 받고 있어요. 잠시 뒤 다시 해 주세요';
    case 'write_failed': return '내 PC에 쓰지 못했어요(폴더 권한 확인)';
    case 'trash_failed': return '내 PC 휴지통으로 보내지 못했어요';
    case 'not_file': return '파일만 보낼 수 있어요';
    case 'blocked': return '이 폴더는 열 수 없어요(윈도우·프로그램 폴더)';
    case 'not_found': return '내 PC에서 찾지 못했어요';
    case 'bad_path': case 'not_folder': return '열 수 없는 경로예요';
    case 'open_failed': return '내 PC에서 열지 못했어요';
    case 'off': case 'unreached': return '내 PC에 닿지 못했어요(바구니 PC 앱 확인)';
    case 'pc_signed_out': case 'other_user': case 'bad_token': case 'no_token': case 'auth_unavailable': return pcStateText(code);
    default: return '내 PC 파일을 읽지 못했어요';
  }
}
// 옛 문(0.3.x): 보기·열기만. 0.4.0+이면 복사·옮기기가 된다.
export const PC_READONLY_TEXT = '바구니 PC 앱을 새 판(0.4.0)으로 올리면 내 PC ↔ 클라우드 복사·옮기기가 돼요(지금은 보기·열기만)';
// 내 PC 안 이름 바꾸기·새 폴더·휴지통·내 PC 안 복사·옮기기는 다음 판(FILES-내PC쓰기).
export const PC_WRITE_LATER_TEXT = '내 PC 안 이름 바꾸기·새 폴더·휴지통은 다음 판에서 돼요';
// 한 번에 보내는 개수·크기(화면이 파일을 메모리에 쥐고 나른다 — '이 폰'과 같은 1GB, 바구니 문은 2GB까지 받음).
export const PC_XFER_MAX = 20;
export const PC_FILE_MAX = 1024 * 1024 * 1024;
export const PC_PIECE = 4 * 1024 * 1024;
// 내 PC가 낀 복사·옮기기를 이 판에서 할 수 있나. 안 되면 한 줄 까닭, 되면 ''. rows = 보낼 줄, dest = {source, parent}.
//   되는 것: 내 PC 파일 → 클라우드(원드라이브·구글 드라이브) 폴더, 클라우드 파일 → 내 PC 폴더(드라이브 맨 위 목록은 아님). 복사·옮기기 모두.
//   안 되는 것: 내 PC 안끼리(다음 판), 내 PC와 이 폰 사이, 내 PC 파일과 다른 곳 파일을 섞어 보내기, 옛 문.
export function pcXferWhy(rows, dest, {can = [], cloud = ['od', 'gd']} = {}) {
  const list = (rows || []).filter(Boolean);
  const fromPc = list.some(r => r.source === PC_SOURCE), toPc = dest?.source === PC_SOURCE;
  if (!fromPc && !toPc) return '';
  if (!pcCanXfer(can)) return PC_READONLY_TEXT;
  if (!list.length) return '고른 것이 없습니다';
  if (fromPc && list.some(r => r.source !== PC_SOURCE)) return '내 PC 파일과 다른 곳 파일은 따로 보내 주세요';
  if (!dest) return ''; // 받을 곳을 아직 고르지 않음(잘라 두기·받을 곳 창 열기)
  if (fromPc && toPc) return '내 PC 안 복사·옮기기는 다음 판에서 돼요(지금은 탐색기에서)';
  if (fromPc && !cloud.includes(dest?.source)) return '내 PC 파일은 원드라이브·구글 드라이브로 보내요';
  if (toPc && list.some(r => !cloud.includes(r.source))) return '내 PC로는 원드라이브·구글 드라이브 파일을 받아요';
  if (toPc && !pcNorm(dest.parent)) return '내 PC에서는 드라이브나 폴더를 열어 주세요';
  return '';
}
export const PC_PREVIEW_TEXT = '내 PC 파일은 미리보기 없이 이름·크기만 보여요';

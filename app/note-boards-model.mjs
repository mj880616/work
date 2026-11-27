// NOTE-보드여러개 (요청함 10/30 05:48, 명진 결정 '위 추천안대로'): 보드 보기(옛 이름 포스트잇)의 보드 여러 개(화면 없음, 시험 가능).
// - 보드 목록: 서버 화면 기억 view_prefs.note_boards = [{id, name}] (12개까지, 순서 = 보드 칸 순서). 마지막에 연 보드는
//   view_prefs.note_board = 보드 id(DB 검사는 옛 값 'all'도 받지만 화면은 무시한다 — S69-83). 모양 검사는 DB 검사(migration 20261030091000)와 같다(view-prefs.js validValue).
// - 보드에 붙인 노트와 그 자리: 노트 행의 기존 metadata.boards = {보드 id: {x, y, r, z}} (note-board-model.mjs placeShape와 같은 모양).
//   S69-83(명진 11/24 23:55 "전체는 불필요함 걍 없애"): 모든 노트를 늘어놓던 [전체]는 없앴다(옛 metadata.board 값은 지우지 않고 읽지도 않는다).
//   보드에서 빼기 = 그 키만 지우기(노트는 그대로). 같은 노트를 여러 보드에 붙일 수 있다.
//   보드를 지워도 노트는 그대로이고, 목록에 없는 보드 id의 자리는 읽을 때 무시한다(지운 보드의 자리는 화면이 따로 지운다).
// - 기기 저장 없음.
import { placeShape, placeFields, clampPos, tiltFor, topZ, CARD_W, CARD_H, Z_MAX } from './note-board-model.mjs';

export const BOARD_LIMITS = Object.freeze({count:12, name:20});
export const BOARD_ID_RE = /^b[0-9a-z]{6,12}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);

// 서버 값 → 보드 목록(모양이 틀린 칸·겹친 id는 버린다).
export function parseBoards(value) {
  if (!Array.isArray(value)) return [];
  const out = [], seen = new Set();
  for (const b of value) {
    if (!plain(b) || Object.keys(b).some(k => k !== 'id' && k !== 'name')) continue;
    if (typeof b.id !== 'string' || !BOARD_ID_RE.test(b.id) || seen.has(b.id)) continue;
    if (typeof b.name !== 'string' || !b.name || CONTROL.test(b.name) || [...b.name].length > BOARD_LIMITS.name) continue;
    seen.add(b.id); out.push({id:b.id, name:b.name});
    if (out.length >= BOARD_LIMITS.count) break;
  }
  return out;
}
// 서버에 보낼 모양(그대로 DB 검사를 지난다).
export const boardsToPrefs = boards => boards.map(b => ({id:b.id, name:b.name}));
// 처음 열 보드: 마지막에 연 보드가 목록에 있으면 그 id, 아니면(옛 값 'all'·지운 보드) 가장 최근에 만든 보드(목록 끝), 보드가 없으면 null.
export const pickBoard = (value, boards) => (typeof value === 'string' && boards.some(b => b.id === value) ? value : boards.at(-1)?.id ?? null);

// 보드 이름(앞뒤 빈칸은 지움). 다른 보드와 같은 이름은 받지 않는다(보드 칸에서 구별이 안 되므로).
export function validateBoardName(name, boards = [], exceptId = null) {
  const raw = typeof name === 'string' ? name.trim() : '';
  if (!raw) throw new Error('보드 이름을 입력해 주세요.');
  if (CONTROL.test(raw)) throw new Error('보드 이름은 한 줄로 써 주세요.');
  const value = raw.replace(/ {2,}/g, ' ');
  if ([...value].length > BOARD_LIMITS.name) throw new Error(`보드 이름은 ${BOARD_LIMITS.name}자까지 쓸 수 있어요.`);
  if (boards.some(b => b.id !== exceptId && b.name === value)) throw new Error('같은 이름의 보드가 있어요.');
  return value;
}
// 새 보드 id: 'b' + 소문자 영문·숫자 8자(목록에 있는 id와 겹치지 않게). random은 시험에서 바꿔 넣는다.
export function newBoardId(boards = [], random = Math.random) {
  for (let i = 0; i < 50; i++) {
    let id = 'b';
    while (id.length < 9) id += Math.floor(random() * 36).toString(36);
    if (BOARD_ID_RE.test(id) && !boards.some(b => b.id === id)) return id;
  }
  throw new Error('보드를 만들지 못했어요. 다시 시도해 주세요.');
}
export function addBoard(boards, name, random) {
  if (boards.length >= BOARD_LIMITS.count) throw new Error(`보드는 ${BOARD_LIMITS.count}개까지 만들 수 있어요.`);
  const board = {id:newBoardId(boards, random), name:validateBoardName(name, boards)};
  return {boards:[...boards, board], board};
}
export const renameBoard = (boards, id, name) => boards.map(b => (b.id === id ? {...b, name:validateBoardName(name, boards, id)} : b));
export const removeBoard = (boards, id) => boards.filter(b => b.id !== id);

// 노트가 보드 id에 붙은 자리(없거나 모양이 틀리면 null).
export function boardPlaceOf(note, boardId) {
  const all = plain(note?.metadata) && plain(note.metadata.boards) ? note.metadata.boards : null;
  return all && Object.hasOwn(all, boardId) ? placeShape(all[boardId]) : null;
}
export const onBoard = (note, boardId) => !!boardPlaceOf(note, boardId);
export const notesOnBoard = (notes, boardId) => notes.filter(n => onBoard(n, boardId));
// 이 노트가 붙은 보드 id들(목록에 있는 보드만).
export const boardsOfNote = (note, boards) => boards.filter(b => onBoard(note, b.id)).map(b => b.id);

// metadata 바꾸기(새 객체). place가 null이면 그 보드에서 뺀다. 빈 boards는 키를 지운다. 바뀐 것이 없으면 null.
export function withBoardPlace(metadata, boardId, place) {
  const meta = plain(metadata) ? {...metadata} : {};
  const boards = plain(meta.boards) ? {...meta.boards} : {};
  const old = Object.hasOwn(boards, boardId) ? placeShape(boards[boardId]) : null;
  if (place) {
    const p = placeFields(place); // S69-88: 크기(w·h)·보드에 보일 글자(label)도 함께
    if (old && ['x', 'y', 'r', 'z', 'w', 'h', 'label'].every(k => old[k] === p[k])) return null;
    boards[boardId] = p;
  } else {
    if (!Object.hasOwn(boards, boardId)) return null;
    delete boards[boardId];
  }
  if (Object.keys(boards).length) meta.boards = boards; else delete meta.boards;
  return meta;
}

// 끌어 놓은 곳(보드 좌표)에 칸 가운데가 오도록 새 자리. 맨 위 순서, 노트마다 정해진 기울기.
export function dropPlace(noteId, point, places) {
  return {x:clampPos(point.x - CARD_W / 2, CARD_W), y:clampPos(point.y - CARD_H / 2, CARD_H), r:tiltFor(noteId), z:Math.min(Z_MAX, topZ(places) + 1)};
}

// S71-50 NOTE-보드배경색(사용자 2026-11-26 19:51 "보드 배경색상도 지정가능하게 해줘요"): 보드마다 바탕색 하나.
// - 저장: 서버 화면 기억 view_prefs.note_board_bg = {보드 id: 색 이름}(12개까지). 없는 보드 = '기본'(지금 바탕 그대로). 기기 저장 없음.
//   보드 목록(note_boards)의 칸에 넣지 않고 따로 둔 까닭: 이미 열려 있던 옛 화면은 note_boards 칸에 모르는 이름(bg)이 있으면 그 보드를 버리고,
//   그 상태로 보드를 만들거나 이름을 바꾸면 그 보드가 목록에서 사라진다. 따로 두면 옛 화면은 색만 모르고 보드는 그대로다.
// - 색은 아래 정해진 이름만. DB 검사(migration 20261126220000_profile_view_prefs_note_board_bg)도 같은 목록만 받는다(화면 값을 그대로 믿지 않음).
// - 실제 색 값은 app/theme-tokens.css --ds-board-bg-<이름>(밝은·어두운 화면 각각, 글자 대비 4.5:1 이상 — tests/note-board-bg.test.mjs).
export const BOARD_BGS = Object.freeze(['sand', 'sage', 'sky', 'lilac', 'peach', 'mint', 'rose', 'gray']);
export const BOARD_BG_NAMES = Object.freeze({sand:'모래', sage:'쑥', sky:'하늘', lilac:'연보라', peach:'살구', mint:'민트', rose:'장미', gray:'회색'});
export const boardBgOk = v => typeof v === 'string' && BOARD_BGS.includes(v);
// 서버 값 → {보드 id: 색}(모양이 틀린 칸은 버린다). boards를 주면 목록에 있는 보드만 남긴다.
export function parseBoardBgs(value, boards = null) {
  if (!plain(value)) return {};
  const out = {};
  for (const [id, bg] of Object.entries(value)) {
    if (!BOARD_ID_RE.test(id) || !boardBgOk(bg) || (boards && !boards.some(b => b.id === id))) continue;
    out[id] = bg;
    if (Object.keys(out).length >= BOARD_LIMITS.count) break;
  }
  return out;
}
export const boardBgOf = (bgs, id) => (plain(bgs) && Object.hasOwn(bgs, id) && boardBgOk(bgs[id]) ? bgs[id] : null);
// 바꾼 새 객체. bg가 null·'' = 기본(그 보드 칸을 지움). 목록 밖 색은 받지 않는다.
export function withBoardBg(bgs, id, bg) {
  if (!BOARD_ID_RE.test(String(id))) throw new Error('보드를 찾지 못했어요.');
  if (bg != null && bg !== '' && !boardBgOk(bg)) throw new Error('목록에 없는 색이에요.');
  const next = {...parseBoardBgs(bgs)};
  if (bg) next[id] = bg; else delete next[id];
  return next;
}
// 서버에 보낼 값: 비면 null(칸 지우기).
export const boardBgsToPrefs = bgs => { const v = parseBoardBgs(bgs); return Object.keys(v).length ? v : null; };

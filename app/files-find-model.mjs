// S52-44 ④ FILES-관리자마무리(요청함 11/08 "찾기: 지금 폴더 안/전체 구분, 종류·날짜·크기 거르기 칩"): [파일] 찾기 결과 거르기 계산. DOM·네트워크 없음(node --test).
// - 서버 찾기(app_cloud_find_in)는 켜진 출처 전체에서 이름·글자로 찾아 최대 FIND_LIMIT줄을 준다. 거르기는 받은 줄 안에서 화면이 한다(서버·기기에 저장하지 않음).
// - '이 폴더': 지금 칸이 연 폴더(그 안의 폴더 포함) 줄만. 서버가 주는 위치 글자(folder_path = 맨 위부터 위 폴더 이름 ' › ')로 고른다.
// - 종류(폴더·문서·사진·동영상·소리)·날짜(바뀐 날 7일·30일·1년)·크기(1MB·10MB·100MB 넘는 것). 폴더는 크기 거르기에서 빠진다.
import {kindOf} from './files-model.mjs';

export const FIND_SCOPES = Object.freeze([{value: 'here', label: '이 폴더'}, {value: 'all', label: '전체'}]);
export const FIND_KINDS = Object.freeze([{value: 'all', label: '모든 종류'}, {value: 'folder', label: '폴더'}, {value: 'doc', label: '문서'},
  {value: 'image', label: '사진'}, {value: 'video', label: '동영상'}, {value: 'audio', label: '소리'}]);
export const FIND_DAYS = Object.freeze([{value: 'all', label: '모든 날짜'}, {value: '7', label: '7일 안'}, {value: '30', label: '30일 안'}, {value: '365', label: '1년 안'}]);
export const FIND_SIZES = Object.freeze([{value: 'all', label: '모든 크기'}, {value: '1', label: '1MB 넘음'}, {value: '10', label: '10MB 넘음'}, {value: '100', label: '100MB 넘음'}]);
export const FIND_DIMS = Object.freeze({kind: FIND_KINDS, day: FIND_DAYS, size: FIND_SIZES});
// 버튼에 보일 글자(고르지 않았으면 이름만).
export const FIND_DIM_NAME = Object.freeze({kind: '종류', day: '날짜', size: '크기'});
const DOC = new Set(['pdf', 'hwp', 'word', 'excel', 'slide', 'text', 'web', 'gdoc']);
const DAY_MS = 86400000;
export const freshFilter = () => ({scope: 'all', kind: 'all', day: 'all', size: 'all'});
const ok = (list, v) => list.some(o => o.value === v);
// 한 칸 값만 바꾼 새 거르기(모르는 값이면 그대로).
export function filterSet(filter, dim, value) {
  const cur = {...freshFilter(), ...(filter || {})};
  const list = dim === 'scope' ? FIND_SCOPES : FIND_DIMS[dim];
  if (!list || !ok(list, value)) return cur;
  return {...cur, [dim]: value};
}
export const filterOn = f => !!f && ['kind', 'day', 'size'].some(d => f[d] && f[d] !== 'all');
export const dimLabel = (f, dim) => {
  const v = f?.[dim];
  return v && v !== 'all' ? (FIND_DIMS[dim].find(o => o.value === v)?.label || FIND_DIM_NAME[dim]) : FIND_DIM_NAME[dim];
};
// '이 폴더' 기준 위치 글자: 위치 단계 이름(맨 위 저장소 이름 뒤) → '문서 › 2026'. 맨 위면 ''(그 저장소 전체).
export const baseOf = names => (Array.isArray(names) ? names.slice(1).map(String).join(' › ') : '');
// 줄이 이 폴더 안(그 안의 폴더 포함)인가. base = {source, path}. path ''이면 그 저장소 전체.
export function inFolder(row, base) {
  if (!base) return true;
  if (row?.source !== base.source) return false;
  if (!base.path) return true;
  const at = String(row.folder_path || '');
  return at === base.path || at.startsWith(base.path + ' › ');
}
function kindOk(row, kind) {
  if (kind === 'all') return true;
  const k = kindOf(row);
  if (kind === 'doc') return DOC.has(k);
  return k === kind;
}
function dayOk(row, day, now) {
  if (day === 'all') return true;
  const t = Date.parse(row?.modified_at || '');
  return Number.isFinite(t) && now - t <= Number(day) * DAY_MS;
}
function sizeOk(row, size) {
  if (size === 'all') return true;
  return !row?.is_folder && Number(row?.size_bytes) > Number(size) * 1024 * 1024;
}
// 받은 찾기 줄 → 보일 줄. base는 scope가 'here'일 때만 쓴다.
export function findFilter(rows, filter, {base = null, now = Date.now()} = {}) {
  const f = {...freshFilter(), ...(filter || {})};
  return (Array.isArray(rows) ? rows : []).filter(r => (f.scope !== 'here' || inFolder(r, base))
    && kindOk(r, f.kind) && dayOk(r, f.day, now) && sizeOk(r, f.size));
}

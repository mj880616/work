// ACT-사진 3단계: 사업 보고 사진 줄의 순수 규칙(DOM·네트워크 없음, 단위 시험 대상).
// 사진은 사업 보고 첨부(app_documents.meeting_id, 원본은 Drive 한 곳)다. 그림인지 아닌지는 자료실과 같은 판단 함수 하나를 쓴다:
//   · 자료 행: library-photo.js isLibraryPhoto (= library-tree.js fileKindOf==='그림' + Drive 파일 있음)
//   · 고른 파일(아직 올리기 전): 같은 fileKindOf(이름, 형식)
import {fileKindOf} from './library-tree.js';
import {isLibraryPhoto} from './library-photo.js';

// 사업 보고 칸 → 자료실 종류. 앞의 것부터 '지금 내 종류 목록'에 있는 첫 이름을 쓰고, 하나도 없으면 '기타'.
// (자료실 기본 종류: 교섭·투쟁·교육·선전·정책·회의·기타. 이름이 바뀐 '교섭' ↔ '교섭·합의'는 둘 다 적어 둔다. 언론·국회는 자료실에 같은 이름이 없어 가장 가까운 종류로 보낸다.)
export const REPORT_KIND_CATEGORY = Object.freeze({
  meeting: ['회의'],
  policy: ['정책'],
  negotiation: ['교섭·합의', '교섭'],
  press: ['성명·보도자료', '선전'],
  assembly: ['정책'],
  struggle: ['투쟁'],
  education: ['교육'],
  other: ['기타']
});
export const FALLBACK_CATEGORY = '기타';

export function categoryForReportKind(kind, categories) {
  const names = Array.isArray(categories) ? categories : [];
  const wanted = REPORT_KIND_CATEGORY[kind] || REPORT_KIND_CATEGORY.other;
  return wanted.find(name => names.includes(name)) || FALLBACK_CATEGORY;
}

// 고른 파일이 사진인가(올리기 전). File 또는 {name,type}.
export const isPhotoFile = file => !!file && fileKindOf(file.name, file.type) === '그림';
export function splitPhotoFiles(files) {
  const list = Array.from(files || []);
  return {photos: list.filter(isPhotoFile), others: list.filter(f => !isPhotoFile(f))};
}

// 올라온 자료 → 사진과 그 밖의 자료(올린 순서 그대로).
export function splitPhotoDocs(docs) {
  const list = Array.isArray(docs) ? docs : [];
  return {photos: list.filter(isLibraryPhoto), files: list.filter(d => !isLibraryPhoto(d))};
}

// 사진 올릴 때 서버에 함께 보내는 값: 사진은 AI에 보내지 않으므로 제목·종류·날짜를 여기서 정한다.
export const photoTitle = name => String(name || '').replace(/\.[^./\\]+$/, '').trim() || String(name || '사진');
export function photoUploadFields(file, {kind, day = ''} = {}, categories) {
  const fields = {title: photoTitle(file?.name), category: categoryForReportKind(kind, categories)};
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) fields.document_date = day;
  return fields;
}

// 칸을 바꿨을 때 사진 종류도 따라가야 하는 자료: 옛 칸이 정해 준 종류 그대로인 사진만(사람이 따로 고친 종류는 두고).
export function photosToFollow(docs, oldKind, newKind, categories) {
  const from = categoryForReportKind(oldKind, categories), to = categoryForReportKind(newKind, categories);
  if (from === to) return {ids: [], category: to};
  return {ids: (Array.isArray(docs) ? docs : []).filter(d => isLibraryPhoto(d) && d.category === from).map(d => d.id), category: to};
}

export const photoCountLabel = n => `사진 ${n}`;

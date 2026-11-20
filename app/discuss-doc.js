// S67-29 WEEKLY-논의요청한글(요청함 11/20 13:00·13:02): 상집 논의 요청 줄에 붙이는 한글 문서(.hwp·.hwpx).
// - 올리기: 원본은 기존 자료실 저장 길(hwp-drive.js saveDiscussDoc → library-files, 내 Drive 자료실 폴더)로. 줄에는 연결 {id, name}만(weekly-discuss.mjs).
// - 미리 채우기: 이 기기 안에서 문서를 열어(.hwp는 숨은 칸막이 엔진으로 .hwpx로 바꿔) 첫 문단 = 안건, 다음 문단 = 설명(빈 칸일 때만, 화면이 정함).
// - 한글 파일 만들기: 자료실 원본을 기존 열기 요청(hwp-drive.js openHwpFromDrive, document-actions hwp-open — 서버가 내 자료인지 봄)으로 받아
//   .hwpx 묶음으로 연다 → journal-hwpx.js가 weekly-discuss.mjs discussFileItems로 안건 아래에 넣는다(weekly-hwpx/embed.mjs).
// 서버·DB 모양은 바꾸지 않는다. 브라우저 저장소에 아무것도 두지 않는다(읽은 묶음은 이 화면 메모리에만). 문서 내용은 로그에 쓰지 않는다.
import {createEngine} from './hwp-engine.js';

export const DOC_TEXT = Object.freeze({
  uploading:'한글 파일 올리는 중…',
  filled:'문서 제목·첫 문단으로 빈 칸을 채웠어요. 수정해서 저장해 주세요.',
  attached:'한글 파일을 붙였어요. 저장하면 줄에 남아요.',
  unread:'한글 파일을 붙였어요. 내용을 읽지 못해 칸은 채우지 않았어요.',
  failed:'한글 파일을 올리지 못했어요.',
  one:'한글 파일은 한 개만 붙일 수 있어요.',
});

let lib = null;
const lazy = () => lib || (lib = Promise.all([import('./weekly-hwpx/draft.mjs'), import('./weekly-hwpx/embed.mjs'), import('./hwp-drive.js')])
  .then(([draft, embed, drive]) => ({draft, embed, drive})).catch(error => { lib = null; throw error; }));

// 바이트 → .hwpx 묶음. .hwp(HWP 5)는 엔진으로 바꾼다. 열지 못하면 Error.
export async function openDiscussBytes(bytes, name, engine) {
  const {draft} = await lazy();
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const kind = draft.hwpKind(b);
  if (kind === 'hwpx') return draft.openConfirmed(b);
  if (kind !== 'hwp5') throw new Error('not hwp');
  const out = await engine.toHwpx(b, name);
  return draft.openConfirmed(out instanceof Uint8Array ? out : new Uint8Array(out ?? []));
}

// 파일 고르기 검사(한글 파일·30MB까지 — 자료실 한글 서식 올리기와 같은 규칙).
export async function discussFileProblem(file) {
  const {drive} = await lazy();
  return drive.unionFormFileProblem(file);
}

// 올리기 + 미리 읽기. → {file:{id, name}|null, preview:{title, note}|null, message, error}
// 미리 읽기는 올리기와 따로: 읽지 못해도 붙이기는 된다. 올리기가 안 되면 아무것도 붙이지 않는다.
export async function attachDiscussFile(file, {rt = window.KPTURuntime} = {}) {
  const {drive, embed} = await lazy();
  const problem = drive.unionFormFileProblem(file);
  if (problem) return {file:null, preview:null, message:problem, error:true};
  let preview = null;
  const engine = createEngine();
  try {
    const pkg = await openDiscussBytes(new Uint8Array(await file.arrayBuffer()), file.name, engine);
    const p = embed.previewDoc(pkg);
    preview = p.title || p.note ? p : null;
  } catch { preview = null; }
  finally { engine.close(); }
  const r = await drive.saveDiscussDoc(file, {rt});
  if (r.kind !== 'created') return {file:null, preview:null, message:r.message || DOC_TEXT.failed, error:true};
  return {file:{id:r.document.id, name:String(file.name || r.document.file_name)}, preview, message:'', error:false};
}

// 한글 파일 만들 때: 붙인 문서가 있는 줄마다 자료실 원본을 받아 묶음으로 연다(같은 자료는 cache에서 한 번만).
// → Map(줄 id → {pkg}|{failed:true}). 하나가 안 돼도 나머지는 계속(그 줄은 '첨부 문서: 파일 이름').
export async function loadDiscussDocs(rows, {rt = window.KPTURuntime, engine = null, cache = new Map()} = {}) {
  const {drive} = await lazy();
  const out = new Map();
  let own = null;
  const eng = () => engine || (own ||= createEngine());
  try {
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r?.file?.id) continue;
      if (!cache.has(r.file.id)) cache.set(r.file.id, (async () => {
        try {
          const {bytes, info} = await drive.openHwpFromDrive({kind:'library', document:{id:r.file.id}}, {rt});
          return await openDiscussBytes(bytes, `doc.${info.format}`, eng());
        } catch { return null; }
      })());
      const pkg = await cache.get(r.file.id);
      if (!pkg) cache.delete(r.file.id); // 다음 만들기에서 다시 해 본다
      out.set(r.id, pkg ? {pkg} : {failed:true});
    }
  } finally { own?.close(); }
  return out;
}

// 만든 뒤 한 줄 알림: 넣은 문서 수·빠진 서식·넣지 못한 문서.
export function embedNote(embedded, docs) {
  const failed = [...(docs?.values?.() ?? [])].filter(d => d?.failed).length;
  const parts = [];
  if (embedded?.count) parts.push(`논의 요청 문서 ${embedded.count}개를 안건 아래에 넣었어요${embedded.lost?.length ? `(${embedded.lost.join('·')}은 빠짐)` : ''}.`);
  if (failed) parts.push(`문서 ${failed}개는 열지 못해 '첨부 문서: 파일 이름'으로 적었어요.`);
  return parts.join(' ');
}

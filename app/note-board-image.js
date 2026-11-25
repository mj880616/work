// S70-32 ②(명진 2026-11-25 "보드에 이미지 넣기"): 노트 › 보드에 사진 넣기 — 끌어 놓기·붙여넣기·도구 줄 [이미지].
// 계산은 note-board-image-model.mjs, 판 그리기는 note-board.js, 보드 자리 저장은 note-boards.js가 맡는다. 이 파일은 넣기 흐름 하나:
//   ① 사진 정보 지우기(기기 안): JPEG·큰 사진은 바로 세워 다시 그리고(정보 칸 없음), 작은 PNG는 정보 칸만 뺀다. 남아 있으면 올리지 않는다.
//   ② 사진 한 장뿐인 노트 만들기: 제목만 있는 노트(createNoteDoc) → 그 노트 첨부로 올리기(basket-files, Drive '노트 첨부', owner만).
//      올리기가 실패하면 방금 만든 빈 노트는 지운다(첨부 없음 — 바로 지우기).
//   ③ 그 노트를 지금 보드의 놓은 자리에 사진 비율 크기로 붙인다(notes 배열에 더하고 boards.attachSized).
// 새 저장소·새 표·새 권한 없음. 보기는 owner 사진 보기(basket-files?action=photo — 서버가 내 작업공간 노트 첨부인지 확인)만 쓴다. 기기 저장 없음.
import {isBoardImage, stripPhotoMeta, metaLeft, keepBytes, imageBoxSize, photoTitle, PHOTO_EDGE, PHOTO_MAX} from './note-board-image-model.mjs';

const readBytes = async file => new Uint8Array(await file.arrayBuffer());
async function sizeOf(file) {
  try { const bmp = await createImageBitmap(file, {imageOrientation:'from-image'}); const s = {w:bmp.width, h:bmp.height}; bmp.close?.(); return s; }
  catch { return null; }
}
// 올릴 파일(정보 지운 것)과 그림 크기. 못 열거나 정보가 남으면 까닭 글로 throw.
export async function cleanBoardPhoto(file, {shrink} = {}) {
  const name = file?.name || '사진';
  const size = await sizeOf(file);
  let out = null;
  if (size && keepBytes(file.type, size.w, size.h)) {
    const bytes = stripPhotoMeta(await readBytes(file));
    if (bytes) out = new File([bytes], file.name || 'photo.png', {type:'image/png', lastModified:file.lastModified || Date.now()});
  }
  if (!out) {
    const shrinkPhoto = shrink || (await import('./diary-data.js')).shrinkPhoto;
    out = await shrinkPhoto(file, {edge:PHOTO_EDGE, quality:0.86, redraw:true});
    const bytes = stripPhotoMeta(await readBytes(out)); // 다시 그린 그림엔 정보 칸이 없다 — 그래도 한 번 더 뺀다
    if (bytes) out = new File([bytes], out.name, {type:out.type, lastModified:out.lastModified});
  }
  if (metaLeft(await readBytes(out)).length) throw new Error(`${name}의 사진 정보를 빼지 못해 올리지 않았어요.`);
  return {file:out, size:size || (await sizeOf(out))};
}

// 이벤트에서 사진 파일만(끌어 놓기 dataTransfer.files, 붙여넣기 clipboardData.items·files).
export function imageFilesOf(transfer) {
  if (!transfer) return [];
  const files = [...(transfer.files || [])];
  if (!files.length) for (const it of transfer.items || []) if (it.kind === 'file') { const f = it.getAsFile?.(); if (f) files.push(f); }
  return files.filter(isBoardImage);
}

// createNoteBoardImages({rt, notes, boards, toast, rerender}) → add(files, point)
// notes: {get, set} (basket-notes.js 노트 배열), boards: createNoteBoards 결과(current·attachSized).
export function createNoteBoardImages({rt = window.KPTURuntime, notes, boards, toast = () => {}, rerender = () => {}, clean = cleanBoardPhoto}) {
  let busy = false;
  async function one(file, at, boardId) {
    const [{createNoteDoc}, {uploadBasketFile}] = await Promise.all([import('./basket-data.js'), import('./basket-upload.js')]);
    const {file:photo, size} = await clean(file);
    const row = await createNoteDoc({title:photoTitle(file.name), raw_text:''}, rt);
    let result;
    try {
      const fd = new FormData(); fd.append('file', photo); fd.append('note_id', row.id);
      result = await uploadBasketFile(fd, photo, rt);
      if (!result?.ok || result.note_id !== row.id || !Array.isArray(result.attachments) || !result.attachments.length) throw new Error('사진을 올리지 못했어요.');
    } catch (e) {
      // 첨부 없는 빈 노트만 지운다(owner RLS 그대로, 작업공간 조건 포함).
      try { const ws = encodeURIComponent(rt.context.read()?.workspace?.id || ''); if (ws) await rt.api(`/rest/v1/app_notes?id=eq.${encodeURIComponent(row.id)}&workspace_id=eq.${ws}&attachments=eq.%5B%5D&select=id`, {method:'DELETE', prefer:'return=representation'}); } catch { /* 남으면 노트 목록에서 지울 수 있다 */ }
      throw e;
    }
    const saved = {...row, attachments:result.attachments};
    notes.set(list => [...list.filter(n => n.id !== saved.id), saved]);
    if (boards.current() === boardId) boards.attachSized(saved.id, at, imageBoxSize(size?.w, size?.h));
    return saved;
  }
  async function add(files, point) {
    const list = (files || []).filter(isBoardImage);
    if (!list.length) { toast('사진 파일만 넣을 수 있어요.'); return 0; }
    if (busy) { toast('사진을 올리는 중이에요. 끝난 뒤 다시 넣어 주세요.'); return 0; }
    const boardId = boards.current(); if (!boardId) return 0;
    busy = true; let made = 0, fail = '';
    const take = list.slice(0, PHOTO_MAX);
    try {
      for (let i = 0; i < take.length; i++) {
        const at = {x:(point?.x || 0) + i * 24, y:(point?.y || 0) + i * 24};
        try { await one(take[i], at, boardId); made++; } catch (e) { fail ||= e?.message || '사진을 올리지 못했어요.'; }
      }
    } finally { busy = false; rerender(); }
    if (fail) toast(made ? `사진 ${made}장을 넣었어요. ${fail}` : fail);
    else toast(list.length > PHOTO_MAX ? `사진 ${made}장을 넣었어요. 한 번에 ${PHOTO_MAX}장까지예요.` : `사진 ${made}장을 넣었어요.`);
    return made;
  }
  return {add, busy:() => busy};
}

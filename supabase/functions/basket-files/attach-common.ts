// 첨부 공용 두 가지 — 화면 올리기(handler.ts)와 Claude 첨부(mcp-attach.ts)가 같은 검사·같은 폴더를 쓰게 한 곳에 둔다.
// (MCP-Claude쓰기 ③, 설계 docs/design/mcp-claude-write.md 11.2: 새 업로드 구현 없이 기존 경로 재사용)
import { UploadError } from "../_shared/drive-upload.ts";
import type { createDriveUpload } from "../_shared/drive-upload.ts";
import { NOTE_FILES_FOLDER } from "./ocr.ts";

export const MAX_FILE = 100 * 1024 * 1024;
export const MAX_ATTACHMENTS = 20;
const characters = (text: string) => [...text].length;

export function validateFiles(files: FormDataEntryValue[]): File[] {
  if (!files.length || files.some((f) => !(f instanceof File))) {
    throw new UploadError(400, "file_missing", "validate");
  }
  if (files.length > MAX_ATTACHMENTS) {
    throw new UploadError(400, "too_many_attachments", "validate");
  }
  for (const f of files as File[]) {
    if (f.size <= 0) throw new UploadError(400, "file_empty", "validate");
    if (f.size > MAX_FILE) {
      throw new UploadError(413, "file_too_large", "validate");
    }
    if (
      characters(f.name) < 1 || characters(f.name) > 255 ||
      !/^[^/\s]{1,127}\/[^/\s]{1,127}$/.test(
        f.type || "application/octet-stream",
      )
    ) {
      throw new UploadError(400, "file_metadata_invalid", "validate");
    }
  }
  return files as File[];
}

// 첨부 폴더: 노트(kind=note)는 바구니 안 '노트 첨부', 보드 사진(place=board)은 '보드 사진'(못 쓰면 '노트 첨부'), 그 밖(업데이트 등)은 바구니 폴더.
// 폴더는 저장된 행의 종류로만 정한다(요청의 폴더 id는 읽지 않는다). 공유된 폴더는 올리기 전에 거절된다(ensurePrivate*).
export async function attachmentFolder(
  drive: ReturnType<typeof createDriveUpload>,
  workspaceId: string,
  token: string,
  noteKind: string,
  place: string | null = null,
): Promise<string> {
  const root = await drive.ensurePrivateRootFolder(workspaceId, token);
  const board = noteKind === "note" && place === "board"
    ? await drive.boardPhotoFolder(workspaceId, token)
    : null;
  return board ?? (noteKind === "note"
    ? await drive.ensurePrivateChildFolder(root, NOTE_FILES_FOLDER, token)
    : root);
}

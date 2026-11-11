// CAL-일정첨부 요청 6번(S59-23, 설계 docs/design/event-attach.md 5절): '일정에 붙인 사진을 사업 보고로 넘기기'의 서버 확인 두 가지.
// 둘 다 읽기만 한다(Google 캘린더·Drive·DB 어디에도 쓰지 않는다. 폴더도 만들지 않는다).
//
// 1) findEventAttachment: 그 Drive 파일이 지금 그 Google 일정의 첨부인지 — 부른 사람 자기 캘린더 토큰으로 일정을 다시 읽는다
//    (화면이 보낸 일정·파일 id만 믿지 않는다. 남의 일정이면 Google이 거절한다). 사진(jpeg·png·webp·gif)만.
// 2) eventFolderOrigin: 그 Drive 파일이 이 작업공간 '자료실 › 일정 첨부' 폴더(google-calendar attach-file이 올리는 곳) 바로 아래에 있는지.
//    'event' | 'other' | 'missing'. 확인하지 못하면 EventAttachError('event_origin_unknown') — 부르는 쪽은 아무것도 바꾸지 않고 멈춘다.
//    쓰는 곳: 사업 보고로 넘기기(일정 첨부 폴더의 파일만 넘긴다)와 자료 지우기(그 폴더의 원본이면 자료 행만 지우고 Drive 원본은 둔다).
// deno-lint-ignore no-explicit-any
type Reader = { rest: (path: string) => Promise<any> };

// google-calendar/event-files.ts EVENT_FILES_FOLDER와 같은 이름(시험이 둘이 같은지 본다).
export const EVENT_ATTACH_FOLDER = "일정 첨부";
const PHOTO = /^image\/(jpeg|png|webp|gif)$/i;
const DRIVE_ID = /^[A-Za-z0-9_-]{1,255}$/;
const FOLDER_MIME = "application/vnd.google-apps.folder";
const CAL = "https://www.googleapis.com/calendar/v3/calendars";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const enc = encodeURIComponent;

export class EventAttachError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

// 일정 주소 모양(event-files.ts ref와 같은 규칙). calendar_id·event_id가 누구 것인지는 Google이 판단한다.
const REF = /^[^\s\u0000-\u001f\u007f/]{1,1024}$/;
export const isEventRef = (calendarId: unknown, eventId: unknown) =>
  typeof calendarId === "string" && typeof eventId === "string" && REF.test(calendarId) && REF.test(eventId);

// 화면 event-files.js isEventPhoto와 같은 판정(형식이 없을 때만 이름 끝으로).
export const isEventPhoto = (a: { mimeType?: unknown; title?: unknown }) =>
  typeof a?.mimeType === "string" && a.mimeType ? PHOTO.test(a.mimeType) : /\.(jpe?g|png|webp|gif)$/i.test(String(a?.title || ""));

export async function findEventAttachment(
  ref: { calendarId: string; eventId: string; fileId: string },
  token: string,
  options: { fetch?: typeof fetch } = {},
): Promise<{ file_name: string; mime_type: string }> {
  const request = options.fetch ?? globalThis.fetch;
  if (!isEventRef(ref.calendarId, ref.eventId) || !DRIVE_ID.test(ref.fileId)) throw new EventAttachError("invalid_request");
  let r: Response;
  try {
    r = await request(`${CAL}/${enc(ref.calendarId)}/events/${enc(ref.eventId)}?fields=${enc("id,status,attachments")}`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error",
    });
  } catch {
    throw new EventAttachError("calendar_unavailable");
  }
  const d = await r.json().catch(() => null);
  if (r.status === 404 || r.status === 410 || d?.status === "cancelled") throw new EventAttachError("event_not_found");
  if (r.status === 401) throw new EventAttachError("calendar_auth");
  if (r.status === 403) throw new EventAttachError("event_not_found");
  if (!r.ok || !d || typeof d !== "object") throw new EventAttachError("calendar_unavailable");
  const found = (Array.isArray(d.attachments) ? d.attachments : []).find((a: { fileId?: unknown }) => a?.fileId === ref.fileId);
  if (!found) throw new EventAttachError("attachment_not_found");
  if (!isEventPhoto(found)) throw new EventAttachError("not_photo");
  return { file_name: String(found.title || ""), mime_type: typeof found.mimeType === "string" ? found.mimeType : "" };
}

export async function eventFolderOrigin(
  reader: Reader,
  workspaceId: string,
  fileId: string,
  driveToken: () => Promise<string>,
  options: { fetch?: typeof fetch } = {},
): Promise<"event" | "other" | "missing"> {
  const request = options.fetch ?? globalThis.fetch;
  const unknown = () => new EventAttachError("event_origin_unknown");
  if (!DRIVE_ID.test(fileId) || !DRIVE_ID.test(String(workspaceId || ""))) throw unknown();
  let settings: unknown;
  try {
    settings = await reader.rest(`app_drive_settings?workspace_id=eq.${enc(workspaceId)}&select=library_folder_id&limit=2`);
  } catch {
    throw unknown();
  }
  if (!Array.isArray(settings) || settings.length > 1) throw unknown();
  const library = (settings[0] as { library_folder_id?: unknown } | undefined)?.library_folder_id;
  // 자료실 폴더가 없으면 그 아래 '일정 첨부' 폴더도 없다(Drive를 부르지 않는다).
  if (library === undefined || library === null || library === "") return "other";
  if (typeof library !== "string" || !DRIVE_ID.test(library)) throw unknown();
  const read = async (id: string, fields: string) => {
    const token = await driveToken();
    try {
      return await request(`${DRIVE}/${enc(id)}?fields=${enc(fields)}`, { headers: { Authorization: `Bearer ${token}` }, redirect: "error" });
    } catch {
      throw unknown();
    }
  };
  const fr = await read(fileId, "id,parents");
  if (fr.status === 404) return "missing";
  if (!fr.ok) throw unknown();
  const file = await fr.json().catch(() => null);
  if (!file || file.id !== fileId || (file.parents !== undefined && !Array.isArray(file.parents))) throw unknown();
  const parents: unknown[] = Array.isArray(file.parents) ? file.parents : [];
  if (parents.length !== 1 || typeof parents[0] !== "string" || !DRIVE_ID.test(parents[0])) return "other";
  const pr = await read(parents[0], "id,name,mimeType,ownedByMe,parents");
  // 부모 폴더가 보이지 않으면(남의 폴더·없음) 이 작업공간의 '일정 첨부' 폴더가 아니다.
  if (pr.status === 404 || pr.status === 403) return "other";
  if (!pr.ok) throw unknown();
  const folder = await pr.json().catch(() => null);
  if (!folder || folder.id !== parents[0]) throw unknown();
  const inLibrary = Array.isArray(folder.parents) && folder.parents.length === 1 && folder.parents[0] === library;
  return folder.name === EVENT_ATTACH_FOLDER && folder.mimeType === FOLDER_MIME && folder.ownedByMe === true && inLibrary ? "event" : "other";
}

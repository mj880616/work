import { createClient } from "npm:@supabase/supabase-js@2";
import { withWebCors } from "../_shared/web-cors.ts";
import { callerOwnerWorkspace, workspaceDriveToken } from "../_shared/workspace-drive-token.ts";
import { createRecordBackupHandler } from "./handler.ts";

// verify_jwt=true(신규, docs/web2-env6b-edge-source.md 5절 46행). 로그인한 사람만 부르고 예약 호출이 없다.
// 함수 코드도 Auth 확인 + owner 작업공간 정확히 하나를 다시 확인하고, 작업공간·드라이브 연결은 서버가 정한다(handler.ts 맨 위).
// 새 비밀값 없음(Supabase 기본값 SUPABASE_URL·SUPABASE_ANON_KEY·SUPABASE_SERVICE_ROLE_KEY만 읽음).
// 서비스 역할로 닿는 곳: owner 작업공간 확인(app_workspace_members)과 그 작업공간 드라이브 연결 읽기(_shared/workspace-drive-token.ts),
// 맨 위 앱 폴더 id 읽기(app_drive_settings.root_folder_id, S69-22)뿐.
// 기록 표는 사용자 토큰으로만 읽는다.
const env = (name: string) => Deno.env.get(name);
const admin = createClient(env("SUPABASE_URL")!, env("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

Deno.serve(withWebCors(createRecordBackupHandler({
  env,
  ownerWorkspace: (userId) => callerOwnerWorkspace(admin, userId),
  driveToken: (workspaceId) => workspaceDriveToken(admin, workspaceId, { fetch }),
  // S69-22: 맨 위 앱 폴더 id만 읽는다(app_drive_settings.root_folder_id).
  appRootId: async (workspaceId) => {
    const { data, error } = await admin.from("app_drive_settings").select("root_folder_id").eq("workspace_id", workspaceId).maybeSingle();
    return error ? null : (data?.root_folder_id ?? null);
  },
})));

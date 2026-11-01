// Edge 함수 index.ts를 import 줄을 지우고 직접 실행하는 시험용 도우미(EDGE-서버함수정리).
// 지운 import 대신 실제 _shared/web-cors.ts·_shared/safe-error.ts를 그대로 넘긴다(가짜 구현 없음).
import { withWebCors, applyWebCors, WEB2_ORIGINS } from '../../../supabase/functions/_shared/web-cors.ts';
import { safeErrorMessage, safeErrorLog, SAFE_ERROR_FALLBACK } from '../../../supabase/functions/_shared/safe-error.ts';

export const EDGE_SHARED = { withWebCors, applyWebCors, WEB2_ORIGINS, safeErrorMessage, safeErrorLog, SAFE_ERROR_FALLBACK };
globalThis.__edgeShared = EDGE_SHARED;
export const EDGE_PRELUDE = 'const { withWebCors, safeErrorMessage, safeErrorLog } = globalThis.__edgeShared;\n';
// import 줄 중 두 공용 도구만 지운다(다른 import는 각 시험이 원래대로 처리).
export const stripEdgeShared = source => source.replace(/^import .*_shared\/(?:web-cors|safe-error)\.ts.*$/gm, '');
export const withEdgeShared = source => EDGE_PRELUDE + stripEdgeShared(source);

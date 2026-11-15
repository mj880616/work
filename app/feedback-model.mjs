// FEEDBACK-의견보내기 PR5: 의견 보내기 계산(DOM·네트워크 없음). 서버(app_feedback_send)가 같은 상한을 다시 검사한다.
export const BODY_MAX = 2000, PHOTOS_MAX = 3, PHOTO_BYTES_MAX = 1024 * 1024;

/** 폭·앱 여부 → 서버가 받는 자동 정보 두 칸(폰·폴드·PC / 앱·브라우저). */
export function deviceOf(width) { return width <= 760 ? 'phone' : width <= 1100 ? 'fold' : 'pc'; }
export const DEVICE_LABEL = {phone: '폰', fold: '폴드', pc: 'PC'}, CLIENT_LABEL = {app: '앱', browser: '브라우저'};

/** 자동으로 함께 보내는 정보(글 내용·화면 안 기록은 넣지 않는다). */
export function contextOf({screen = '', width = 1280, app = false, version = ''} = {}) {
  return {screen: String(screen).slice(0, 40), device: deviceOf(width), client: app ? 'app' : 'browser', version: String(version || '').slice(0, 40)};
}
export const contextLine = ctx => [ctx.screen || '화면 이름 없음', DEVICE_LABEL[ctx.device] || '', CLIENT_LABEL[ctx.client] || '', ctx.version ? `판 ${ctx.version}` : ''].filter(Boolean).join(' · ');

/** 보내기 전 검사. 문제가 없으면 '' 아니면 한 줄 안내. */
export function feedbackProblem({body = '', photos = []} = {}) {
  const text = String(body).trim();
  if (!text) return '보낼 글을 써 주세요';
  if ([...text].length > BODY_MAX) return `글은 ${BODY_MAX}자까지예요`;
  if (photos.length > PHOTOS_MAX) return `사진은 ${PHOTOS_MAX}장까지예요`;
  if (photos.some(p => p.bytes > PHOTO_BYTES_MAX)) return '사진이 너무 커요';
  return '';
}

/** 서버 오류 → 한 줄. */
export function feedbackError(error) {
  const text = String(error?.message || error || '');
  if (/FEEDBACK_DAILY_LIMIT/.test(text)) return '오늘은 더 보낼 수 없어요. 내일 다시 보내 주세요';
  if (/FEEDBACK_PHOTOS/.test(text)) return '사진을 보내지 못했어요. 다른 사진으로 해 주세요';
  if (/FEEDBACK_BODY/.test(text)) return '보낼 글을 써 주세요';
  return '보내지 못했어요. 잠시 뒤 다시 해 주세요';
}

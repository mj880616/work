export const testOrigin=process.env.WEB2_TEST_ORIGIN||'http://127.0.0.1:8123';
// E2E 앱 주소: APP_E2E_ORIGIN으로 바꿀 수 있고, 없으면 CI 기본값(8123)이다.
export const appOrigin=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';

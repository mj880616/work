// HELP-그림(S71-33): '쓰는 법' 화면 그림을 다시 찍는 설정. 보통 시험(PR·main E2E)에는 들어가지 않는다(파일 이름이 *.spec이 아님).
// 찍기: 저장소 맨 위에서 정적 서버(python3 tests/app-e2e/helpers/static-server.py 8123)를 띄운 뒤
//   npx playwright test -c tests/app-e2e/help-shots
// 그림은 app/help-shots/<줄 id>.webp 로 덮어쓴다. 모든 화면은 흉내 낸 서버·지어낸 자료로만 그린다(실제 계정·자료 아님).
export default {
  testDir: '.',
  testMatch: 'capture.mjs',
  workers: 1,
  timeout: 90000,
  reporter: 'line',
  use: {browserName: 'chromium', viewport: {width: 390, height: 720}, deviceScaleFactor: 1.5, locale: 'ko-KR', timezoneId: 'Asia/Seoul'},
};

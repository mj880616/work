// HWP-서식변환: 반입한 편집기 번들(rhwp-studio 빌드 결과)에 "문서 엔진 클래스 하나"를 편집기 칸막이 안 전역에 내놓는 한 줄을 더한다.
// 편집기 화면은 엔진 클래스(HwpDocument)를 밖에 내놓지 않아, 칸막이 안 보조 스크립트(app/hwp-lab/studio-convert.js)가
// 편집 중인 문서와 따로 양식 파일을 열어 글을 채울 수 없다. 이 한 줄이 그 길이다(편집기 칸막이 안에서만 보인다: sandbox allow-scripts,
// 외부 연결 차단 CSP는 그대로). 변수 이름은 빌드마다 바뀌므로 이름이 아닌 모양으로 찾고, 못 찾으면 빌드를 멈춘다.
// finalize-rhwp-studio.mjs가 부르고, tests/hwp-convert.test.mjs가 반입본에 들어갔는지 확인한다.
export const ENGINE_MARK = 'window.rhwpStudio.engine=';

export function exposeEngine(js) {
  if (js.includes(ENGINE_MARK)) return js;
  const cls = /this\.doc\|\|=([\w$]+)\.createEmpty\(\)/.exec(js)?.[1];
  const anchor = /(window\.rhwpStudio\.automation=[\w$]+;)/;
  if (!cls || !anchor.test(js)) throw new Error('expose-engine: 엔진 클래스 또는 window.rhwpStudio 위치를 찾지 못했습니다');
  // getter로 내놓아, 클래스 선언 순서와 상관없이 부를 때 읽는다.
  return js.replace(anchor, `$1${ENGINE_MARK}{get Document(){return ${cls}}};`);
}

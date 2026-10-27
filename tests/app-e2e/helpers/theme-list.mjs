// UI-화면색10: 허용 색 목록은 app/view-prefs.js의 THEMES 한 곳이다. 브라우저 시험(Playwright)은 앱 .js를 모듈로 불러올 수 없어 그 줄을 읽어 쓴다.
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../../../app/view-prefs.js',import.meta.url),'utf8');
const list=source.match(/export const THEMES = Object\.freeze\(\[([^\]]*)\]\)/)?.[1];
if(!list)throw new Error('THEMES list not found in app/view-prefs.js');
export const THEMES=[...list.matchAll(/'([a-z]+)'/g)].map(match=>match[1]);

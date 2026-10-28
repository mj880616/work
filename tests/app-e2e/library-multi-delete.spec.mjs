import {test,expect} from '@playwright/test';
import {run} from './helpers/library-multi-delete-scenario.mjs';
// LIB-여러개삭제: [선택] 모드로 여러 자료를 골라 하나씩 같은 서버 경로로 차례로 지운다.
const BASE=process.env.APP_E2E_ORIGIN||'http://127.0.0.1:8123';
for(const width of [390,1280])test(`library multi delete: select, folder box, all chip, sequential delete with one failure ${width}px`,async({page})=>{
  await run(page,BASE,width,(actual,expected,label)=>expect(actual,label).toEqual(expected));
});

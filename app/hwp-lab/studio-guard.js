// HWP-편집기 1단계: rhwp 편집기 frame이 시작하기 전에 기기 저장소를 메모리로 바꾼다.
// 편집기는 자동 백업(문서 내용)·최근 문서·설정을 브라우저 저장소에 남기는데, Web2는 사용자 내용을 기기에 두지 않는다.
// 같은 origin의 Web2 로그인 정보도 편집기에서 보이지 않게 한다. 편집기는 저장소가 없으면 메모리 저장으로 동작한다.
(()=>{
  'use strict';
  const memoryStorage=()=>{
    const rows=new Map();
    return Object.freeze({
      get length(){return rows.size},
      key:index=>[...rows.keys()][index]??null,
      getItem:key=>rows.has(String(key))?rows.get(String(key)):null,
      setItem:(key,value)=>{rows.set(String(key),String(value))},
      removeItem:key=>{rows.delete(String(key))},
      clear:()=>rows.clear()
    });
  };
  const replace=(name,value)=>Object.defineProperty(window,name,{value,configurable:false,enumerable:true,writable:false});
  replace('localStorage',memoryStorage());
  replace('sessionStorage',memoryStorage());
  replace('indexedDB',undefined);
  replace('caches',undefined);
})();

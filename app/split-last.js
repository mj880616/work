// UI-PC프로젝트좌우 / ORG-PC좌우: the one "last item seen on this device" memory of the PC left-list / right-detail screens
// (projects, 담당조직). One id per screen and owner, no names or content. The key sits under the per-owner cache prefix
// (kptu_owner_cache:<name>-last-v1:<owner id>) that KPTURuntime clears on sign-out and owner change. A blocked or
// missing storage only means the screen opens its first item.
const PREFIX='kptu_owner_cache:';
export function lastSeen(name){
  const key=owner=>owner?`${PREFIX}${name}-last-v1:${owner}`:'';
  return {
    read(owner){const k=key(owner);if(!k)return '';try{return localStorage.getItem(k)||''}catch{return ''}},
    write(owner,id){const k=key(owner);if(!k||!id)return;try{localStorage.setItem(k,String(id))}catch{}}
  };
}

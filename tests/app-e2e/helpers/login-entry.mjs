export function loginEntry(targetUrl){
  const target=new URL(targetUrl);
  const entry=new URL('/app/login/',target.origin);
  entry.searchParams.set('return',target.href);
  return entry.href;
}

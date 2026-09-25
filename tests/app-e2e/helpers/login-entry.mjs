export function loginEntry(targetUrl){
  const target=new URL(targetUrl);
  const entry=new URL('/app/login/',target.origin);
  entry.searchParams.set('return',target.href);
  return entry.href;
}

export async function enterLogin(page){
  if(new URL(page.url()).pathname==='/app/login/')return;
  const fallback=loginEntry(page.url());
  try{
    await page.waitForURL(url=>url.pathname==='/app/login/',{timeout:5000});
  }catch{
    if(new URL(page.url()).pathname!=='/app/login/')await page.goto(fallback);
  }
}

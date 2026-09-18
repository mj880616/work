import json, re
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup

BASE="https://kptu.net/board/list.aspx?mid=F686C1F3"
START_DATE="2023-01-01"
MAX_PAGE=210
WORKERS=4
OUT=Path("analysis/kptu-corpus/metadata-2023-2026.json")
UA={"User-Agent":"Mozilla/5.0 KPTU-corpus-research/1.0"}

def clean(s):
    return re.sub(r"\s+"," ",s or "").strip()

def classify(title):
    m=re.match(r"^\s*\[([^\]]+)\]", title)
    if not m: return "기타"
    label=m.group(1).strip()
    if "취재요청" in label: return "취재요청"
    if "보도자료" in label: return "보도자료"
    if "성명" in label: return "성명"
    if "논평" in label: return "논평"
    return label

def fetch_page(page):
    url=BASE if page==1 else BASE+f"&page={page}"
    last=None
    for attempt in range(2):
        try:
            r=requests.get(url,headers=UA,timeout=30)
            r.raise_for_status()
            soup=BeautifulSoup(r.text,"html.parser")
            items=[]
            for a in soup.find_all("a",href=True):
                href=a.get("href","")
                if "detail.aspx" not in href or "bid=KPTU_NEW04" not in href:
                    continue
                full=urljoin(url,href.replace("&amp;","&"))
                qs=parse_qs(urlparse(full).query)
                idx=(qs.get("idx") or [None])[0]
                if not idx or idx=="39833": continue
                tr=a.find_parent("tr")
                title=clean(a.get_text(" ",strip=True))
                row_text=clean(tr.get_text(" ",strip=True) if tr else "")
                dates=re.findall(r"20\d{2}-\d{2}-\d{2}",row_text)
                date=dates[-1] if dates else None
                items.append({"idx":int(idx),"page":page,"title":title,"kind":classify(title),"date":date,"url":full,"row_text":row_text})
            return page,items,None
        except Exception as e:
            last=repr(e)
    return page,[],last

records={}
errors=[]
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    futures=[ex.submit(fetch_page,p) for p in range(1,MAX_PAGE+1)]
    for fut in as_completed(futures):
        page,items,error=fut.result()
        if error: errors.append({"page":page,"error":error})
        for rec in items:
            records[str(rec["idx"])]=rec
        dates=[x["date"] for x in items if x.get("date")]
        print(json.dumps({"page":page,"found":len(items),"dates":[min(dates) if dates else None,max(dates) if dates else None],"error":error},ensure_ascii=False),flush=True)

items=[x for x in records.values() if x.get("date") and x["date"]>=START_DATE]
items.sort(key=lambda x:(x["date"],x["idx"]),reverse=True)
summary={"total":len(items),"pages_scanned":MAX_PAGE,"errors":errors,"by_kind":{},"by_year":{},"earliest":items[-1]["date"] if items else None,"latest":items[0]["date"] if items else None}
for x in items:
    summary["by_kind"][x["kind"]]=summary["by_kind"].get(x["kind"],0)+1
    y=x["date"][:4]; summary["by_year"][y]=summary["by_year"].get(y,0)+1
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({"summary":summary,"items":items},ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps(summary,ensure_ascii=False),flush=True)

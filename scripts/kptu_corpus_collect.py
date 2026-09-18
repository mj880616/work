import json, re, time
from pathlib import Path
from urllib.parse import urljoin, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

BASE="https://kptu.net/board/list.aspx?mid=F686C1F3"
START_DATE="2023-01-01"
MAX_PAGES=300
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

s=requests.Session(); s.headers.update(UA)
records={}
pages_scanned=0
stop_reason=None

for page in range(1,MAX_PAGES+1):
    url=BASE if page==1 else BASE+f"&page={page}"
    r=s.get(url,timeout=30); r.raise_for_status()
    soup=BeautifulSoup(r.text,"html.parser")
    page_dates=[]
    found=0
    for a in soup.find_all("a",href=True):
        href=a.get("href","")
        if "detail.aspx" not in href or "bid=KPTU_NEW04" not in href:
            continue
        full=urljoin(url,href.replace("&amp;","&"))
        qs=parse_qs(urlparse(full).query)
        idx=(qs.get("idx") or [None])[0]
        if not idx or idx=="39833":
            continue
        tr=a.find_parent("tr")
        title=clean(a.get_text(" ",strip=True))
        row_text=clean(tr.get_text(" ",strip=True) if tr else "")
        dates=re.findall(r"20\d{2}-\d{2}-\d{2}",row_text)
        date=dates[-1] if dates else None
        if date: page_dates.append(date)
        rec={
            "idx":int(idx),
            "page":page,
            "title":title,
            "kind":classify(title),
            "date":date,
            "url":full,
            "row_text":row_text,
        }
        records[str(idx)]=rec
        found+=1
    pages_scanned=page
    print(json.dumps({"page":page,"found":found,"dates":[min(page_dates) if page_dates else None,max(page_dates) if page_dates else None]},ensure_ascii=False))
    if page_dates and max(page_dates)<START_DATE:
        stop_reason=f"page {page} entirely older than {START_DATE}"
        break
    time.sleep(0.25)

items=[x for x in records.values() if x.get("date") and x["date"]>=START_DATE]
items.sort(key=lambda x:(x["date"],x["idx"]),reverse=True)
summary={"total":len(items),"pages_scanned":pages_scanned,"stop_reason":stop_reason,"by_kind":{},"by_year":{}}
for x in items:
    summary["by_kind"][x["kind"]]=summary["by_kind"].get(x["kind"],0)+1
    y=x["date"][:4]; summary["by_year"][y]=summary["by_year"].get(y,0)+1
OUT.parent.mkdir(parents=True,exist_ok=True)
OUT.write_text(json.dumps({"summary":summary,"items":items},ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps(summary,ensure_ascii=False))

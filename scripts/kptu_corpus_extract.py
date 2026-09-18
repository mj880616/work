import json,re,subprocess,tempfile,os,html
from pathlib import Path
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor,as_completed

import requests
from bs4 import BeautifulSoup

SRC=Path("analysis/kptu-corpus/selected-180.json")
OUTDIR=Path("analysis/kptu-corpus/text")
SUMMARY=Path("analysis/kptu-corpus/extraction-summary.json")
UA={"User-Agent":"Mozilla/5.0 KPTU-corpus-research/1.0"}
WORKERS=4

def clean(s):
    return re.sub(r"\s+"," ",s or "").strip()

def parse_fields(page):
    soup=BeautifulSoup(page,"html.parser")
    tags=soup.find_all(["h1","h2","h3","h4","strong","dt","dd","th","td"])
    vals=[clean(t.get_text(" ",strip=True)) for t in tags]
    vals=[x for x in vals if x and len(x)<500]
    def after(label):
        for i,x in enumerate(vals):
            if x==label and i+1<len(vals): return vals[i+1]
        return None
    title=next((x for x in vals if x.startswith("[") and len(x)>8),None)
    return {"title_detail":title,"author":after("작성자"),"date_detail":after("작성일"),"views":after("조회수")}

def html_fallback(page):
    soup=BeautifulSoup(page,"html.parser")
    candidates=[]
    for t in soup.find_all(["div","article","section","td"]):
        txt=clean(t.get_text(" ",strip=True))
        if len(txt)>=300:
            score=len(txt)
            cls=" ".join(t.get("class",[]))+" "+(t.get("id") or "")
            if re.search(r"(view|content|cont|board|article|detail)",cls,re.I): score+=1000
            if "로그인 회원가입" in txt: score-=2000
            candidates.append((score,txt,cls))
    if not candidates: return ""
    candidates.sort(reverse=True,key=lambda x:x[0])
    return candidates[0][1]

def extract_hwp(data):
    with tempfile.NamedTemporaryFile(suffix=".hwp",delete=False) as f:
        f.write(data); p=f.name
    try:
        z=subprocess.run(["hwp5txt",p],capture_output=True,timeout=90)
        out=z.stdout.decode("utf-8","replace")
        err=z.stderr.decode("utf-8","replace")
        return clean(out),z.returncode,err[:500]
    finally:
        try: os.unlink(p)
        except: pass

def one(item):
    url=item["url"]
    r=requests.get(url,headers=UA,timeout=30); r.raise_for_status()
    page=r.text
    fields=parse_fields(page)
    soup=BeautifulSoup(page,"html.parser")
    hwps=[]
    for a in soup.find_all("a",href=True):
        href=html.unescape(a["href"])
        if "FileDown.aspx" in href and re.search(r"\.hwp(?:&|$)",href,re.I):
            hwps.append(urljoin(url,href))
    seen=[]; hwp_results=[]
    for fu in hwps:
        if fu in seen: continue
        seen.append(fu)
        try:
            fr=requests.get(fu,headers=UA,timeout=45); fr.raise_for_status()
            text,rc,err=extract_hwp(fr.content)
            hwp_results.append({"url":fu,"bytes":len(fr.content),"chars":len(text),"returncode":rc,"stderr":err,"text":text})
        except Exception as e:
            hwp_results.append({"url":fu,"error":repr(e),"chars":0,"text":""})
    best=max(hwp_results,key=lambda x:x.get("chars",0),default=None)
    best_text=(best or {}).get("text","")
    fallback=""
    source="hwp"
    if len(best_text)<500:
        fallback=html_fallback(page)
        if len(fallback)>len(best_text):
            best_text=fallback; source="html_fallback"
    rec=dict(item)
    rec.update(fields)
    rec["hwp_count"]=len(hwp_results)
    rec["hwp_results"]=[{k:v for k,v in x.items() if k!="text"} for x in hwp_results]
    rec["text_source"]=source
    rec["text_chars"]=len(best_text)
    rec["text"]=best_text
    rec["low_text"]=len(best_text)<500
    return rec

data=json.loads(SRC.read_text(encoding="utf-8"))
items=data["items"]
results=[]; errors=[]
with ThreadPoolExecutor(max_workers=WORKERS) as ex:
    futs={ex.submit(one,x):x for x in items}
    for i,fut in enumerate(as_completed(futs),1):
        src=futs[fut]
        try:
            rec=fut.result(); results.append(rec)
            print(json.dumps({"done":i,"idx":rec["idx"],"kind":rec["kind"],"date":rec["date"],"chars":rec["text_chars"],"source":rec["text_source"],"low":rec["low_text"]},ensure_ascii=False),flush=True)
        except Exception as e:
            errors.append({"idx":src["idx"],"url":src["url"],"error":repr(e)})
            print(json.dumps({"done":i,"idx":src["idx"],"error":repr(e)},ensure_ascii=False),flush=True)

OUTDIR.mkdir(parents=True,exist_ok=True)
groups={}
for r in results:
    key=f'{r["kind"]}-{r["date"][:4]}'
    groups.setdefault(key,[]).append(r)
for key,rows in groups.items():
    rows.sort(key=lambda x:(x["date"],x["idx"]),reverse=True)
    (OUTDIR/f"{key}.json").write_text(json.dumps({"group":key,"count":len(rows),"items":rows},ensure_ascii=False,indent=2),encoding="utf-8")
summary={
    "requested":len(items),"completed":len(results),"errors":errors,
    "low_text_count":sum(1 for x in results if x["low_text"]),
    "hwp_source":sum(1 for x in results if x["text_source"]=="hwp"),
    "html_fallback_source":sum(1 for x in results if x["text_source"]=="html_fallback"),
    "groups":{k:len(v) for k,v in sorted(groups.items())},
}
SUMMARY.write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps(summary,ensure_ascii=False),flush=True)

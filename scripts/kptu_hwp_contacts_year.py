import os,json,re,subprocess,tempfile
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor,as_completed
from urllib.parse import urljoin
import requests
from bs4 import BeautifulSoup

YEAR=os.environ["YEAR"]
ROOT=Path("analysis/kptu-corpus")
SRC=ROOT/"metadata-2023-2026.json"
OUT=Path(f"/tmp/hwp-contacts-{YEAR}.json")
UA={"User-Agent":"Mozilla/5.0 KPTU-author-research/1.0"}
TARGET={"성명","보도자료","취재요청"}
PHONE=re.compile(r"(?:02|0[3-6][1-5]|01[016789])[-.\s]?\d{3,4}[-.\s]?\d{4}")
ROLE=r"(?:사무국장|정책국장|조직국장|사업국장|노안국장|본부장|위원장|국장|부장|팀장|실장|차장|간사)"
STOP={"공공운수","민주노총","전국공공","전국철도","공공기관","공공철도","조직쟁의","정책기획","미디어소","노동안전","공공서비"}

def clean(s):return re.sub(r"\s+"," ",s or "").strip()

def extract_name(block):
    pats=[
      r"(?:문의(?:\s*및\s*담당)?|담당|취재문의|보도문의)\s*[:：.#*·\-☛]*\s*(?:[-–]\s*)?(?:[가-힣A-Za-z0-9·()]+\s+){0,6}?([가-힣]{2,4})\s+[가-힣A-Za-z0-9·()]*"+ROLE,
      r"([가-힣]{2,4})\s+(?:[가-힣A-Za-z0-9·()]+\s+){0,5}[가-힣A-Za-z0-9·()]*"+ROLE+r"\s*[\(\[]?\s*$"
    ]
    for p in pats:
        m=re.search(p,block)
        if m and m.group(1) not in STOP:return m.group(1)
    return None

def hwp_text(data):
    with tempfile.NamedTemporaryFile(suffix=".hwp",delete=False) as f:
        f.write(data);p=f.name
    try:
        z=subprocess.run(["hwp5txt",p],capture_output=True,timeout=60)
        return z.stdout.decode("utf-8","replace") if z.returncode==0 else ""
    finally:
        try:os.unlink(p)
        except:pass

def one(item):
    try:
        r=requests.get(item["url"],headers=UA,timeout=25);r.raise_for_status()
        soup=BeautifulSoup(r.text,"html.parser")
        links=[]
        for a in soup.find_all("a",href=True):
            h=a["href"]
            if "FileDown.aspx" in h and re.search(r"\.hwp(?:&|$)",h,re.I):
                u=urljoin(item["url"],h.replace("&amp;","&"))
                if u not in links:links.append(u)
        if not links:return {"idx":item["idx"],"contacts":[],"has_hwp":False},None
        fr=requests.get(links[0],headers=UA,timeout=40);fr.raise_for_status()
        t=hwp_text(fr.content)
        if not t:return {"idx":item["idx"],"contacts":[],"has_hwp":True,"extract_failed":True},None
        head=clean(t[:4500])
        contacts=[];seen=set()
        for pm in PHONE.finditer(head):
            pre=head[max(0,pm.start()-220):pm.start()]
            if not re.search(r"(문의|담당|국장|부장|팀장|실장|위원장|사무국장|본부장|차장|간사)",pre):continue
            name=extract_name(pre)
            if not name:continue
            phone=re.sub(r"[.\s]+","-",pm.group())
            if (name,phone) in seen:continue
            seen.add((name,phone))
            contacts.append({"name":name,"phone":phone,"snippet":clean(pre[-160:]+" "+pm.group())})
        return {
          "idx":item["idx"],"date":item["date"],"kind":item["kind"],"title":item["title"],"url":item["url"],
          "contacts":contacts,"has_hwp":True,"text_chars":len(t)
        },None
    except Exception as e:return None,repr(e)

items=[x for x in json.loads(SRC.read_text(encoding="utf-8"))["items"] if x.get("kind") in TARGET and x.get("date","").startswith(YEAR)]
rows=[];errors=[]
with ThreadPoolExecutor(max_workers=8) as ex:
    futs={ex.submit(one,x):x for x in items}
    for i,f in enumerate(as_completed(futs),1):
        row,err=f.result()
        if row:rows.append(row)
        else:errors.append({"idx":futs[f]["idx"],"error":err})
        if i%50==0:print(YEAR,"DONE",i,"/",len(items),flush=True)
summary={"year":YEAR,"requested":len(items),"completed":len(rows),"with_hwp":sum(x.get("has_hwp") for x in rows),"with_named":sum(bool(x.get("contacts")) for x in rows),"errors":errors}
OUT.write_text(json.dumps({"summary":summary,"items":rows},ensure_ascii=False,indent=2),encoding="utf-8")
print("SUMMARY",json.dumps({k:v for k,v in summary.items() if k!="errors"},ensure_ascii=False),flush=True)

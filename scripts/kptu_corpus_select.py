import json,re
from pathlib import Path
from collections import defaultdict

SRC=Path("analysis/kptu-corpus/metadata-2023-2026.json")
OUT=Path("analysis/kptu-corpus/selected-180.json")
TARGET_KINDS=["보도자료","취재요청","성명"]
YEARS=["2023","2024","2025","2026"]
PER_CELL=15  # 3 genres x 4 years x 15 = 180
PRIORITY_RE=re.compile(r"(철도|지하철|도시철도|GTX|공항철도|신분당|서해선|김포골드|서울교통|교통공사|공공기관|공기업|공공부문|기획재정부|기재부|행정안전부|국토교통부|국토부|공무직|자회사|민자철도|안전인력|인력충원|정원|인력감축)",re.I)

data=json.loads(SRC.read_text(encoding="utf-8"))
items=data["items"]

def normalize_title(t):
    t=re.sub(r"^\s*\[[^\]]+\]\s*","",t or "")
    t=re.sub(r"\s+"," ",t).strip()
    return t

def novelty_score(item, seen_tokens):
    title=normalize_title(item["title"])
    toks=set(re.findall(r"[가-힣A-Za-z0-9]{2,}",title))
    overlap=len(toks & seen_tokens)
    return -overlap, len(toks)

selected=[]
report={}
for kind in TARGET_KINDS:
    report[kind]={}
    for year in YEARS:
        pool=[x for x in items if x.get("kind")==kind and (x.get("date") or "").startswith(year)]
        priority=[x for x in pool if PRIORITY_RE.search(x.get("title",""))]
        general=[x for x in pool if not PRIORITY_RE.search(x.get("title",""))]
        # aim roughly 60% priority when available, but preserve comparison docs
        want_p=min(len(priority),9)
        want_g=min(len(general),PER_CELL-want_p)
        if want_p+want_g<PER_CELL:
            want_p=min(len(priority),PER_CELL-want_g)
        chosen=[]
        seen=set()
        def pick(src,n):
            nonlocal_seen=seen
            src=sorted(src,key=lambda x:(x.get("date",""),x.get("idx",0)),reverse=True)
            out=[]
            while src and len(out)<n:
                best=max(src,key=lambda x: novelty_score(x,nonlocal_seen))
                src.remove(best)
                out.append(best)
                nonlocal_seen.update(re.findall(r"[가-힣A-Za-z0-9]{2,}",normalize_title(best["title"])))
            return out
        chosen += pick(priority.copy(),want_p)
        chosen += pick(general.copy(),want_g)
        if len(chosen)<PER_CELL:
            rest=[x for x in pool if x not in chosen]
            chosen += pick(rest,PER_CELL-len(chosen))
        chosen=chosen[:PER_CELL]
        for x in chosen:
            y=dict(x)
            y["priority_topic"]=bool(PRIORITY_RE.search(y.get("title","")))
            selected.append(y)
        report[kind][year]={"pool":len(pool),"selected":len(chosen),"priority_selected":sum(1 for x in chosen if PRIORITY_RE.search(x.get("title","")))}

# de-dup and stable sort
uniq={x["idx"]:x for x in selected}
selected=list(uniq.values())
selected.sort(key=lambda x:(x["kind"],x["date"],x["idx"]),reverse=True)
summary={"total":len(selected),"by_kind":defaultdict(int),"by_year":defaultdict(int),"priority_topic":0,"cells":report}
for x in selected:
    summary["by_kind"][x["kind"]]+=1
    summary["by_year"][x["date"][:4]]+=1
    summary["priority_topic"]+=1 if x["priority_topic"] else 0
summary["by_kind"]=dict(summary["by_kind"]); summary["by_year"]=dict(summary["by_year"])
OUT.write_text(json.dumps({"summary":summary,"items":selected},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps(summary,ensure_ascii=False,indent=2))

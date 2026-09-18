import json,re,datetime
from pathlib import Path

SRC=Path("analysis/kptu-corpus/metadata-2023-2026.json")
OUT=Path("analysis/kptu-corpus/user-archive-matches.json")

targets=[
 {"file":"240805_보도자료_0805_서교공_해고자복직_촉구_양대노총_기자회견.hwp","date":"2024-08-05","keywords":["서교공","해고자","복직","양대노총","기자회견"]},
 {"file":"20240819_성명_서울교통공사는_지노위판정_존중하고_노조탄압_중단하라 (2).hwp","date":"2024-08-19","keywords":["서울교통공사","지노위","판정","노조탄압","중단"]},
 {"file":"240827_취재요청서_서울메트로9호선지부_기자회견_최종.hwp","date":"2024-08-27","keywords":["서울메트로9호선","9호선","지부","기자회견"]},
 {"file":"240827_보도자료_서울메트로9호선지부_기자회견_2차수정완료.hwp","date":"2024-08-27","keywords":["서울메트로9호선","9호선","지부","기자회견"]},
 {"file":"취재요청_240904_공공 철도-지하철 정책대회.hwp","date":"2024-09-04","keywords":["공공","철도","지하철","정책대회"]},
 {"file":"공공철도지하철_정책대회_보도자료_2024_9_9_수정.hwp","date":"2024-09-09","keywords":["공공","철도","지하철","정책대회"]},
 {"file":"241010_고_박OO_동지_투쟁_연대_기자회견_취재요청서초안.hwp","date":"2024-10-10","keywords":["투쟁","연대","기자회견"]},
 {"file":"241010_고_박OO_동지_투쟁_연대_기자회견_보도자료.hwp","date":"2024-10-10","keywords":["투쟁","연대","기자회견"]},
]

data=json.loads(SRC.read_text(encoding="utf-8"))["items"]

def norm(s):
    return re.sub(r"[^가-힣A-Za-z0-9]","",s or "").lower()

def score(t,item):
    title=item["title"]
    ntitle=norm(title)
    kw=sum(1 for k in t["keywords"] if norm(k) in ntitle)
    d0=datetime.date.fromisoformat(t["date"]); d1=datetime.date.fromisoformat(item["date"])
    days=abs((d1-d0).days)
    date_score=max(0,10-days)
    genre=0
    fn=t["file"]
    if "취재요청" in fn and "취재요청" in title: genre=5
    if "보도자료" in fn and "보도자료" in title: genre=5
    if "성명" in fn and "성명" in title: genre=5
    return kw*10+date_score+genre,kw,days

out=[]
for t in targets:
    ranked=[]
    for item in data:
        days=abs((datetime.date.fromisoformat(item["date"])-datetime.date.fromisoformat(t["date"])).days)
        if days>14: continue
        s,kw,d=score(t,item)
        if kw==0: continue
        ranked.append((s,kw,d,item))
    ranked.sort(key=lambda x:(x[0],-x[2]),reverse=True)
    out.append({"target":t,"matches":[{"score":s,"keyword_hits":kw,"date_diff_days":d,**item} for s,kw,d,item in ranked[:8]]})
OUT.write_text(json.dumps({"targets":out},ensure_ascii=False,indent=2),encoding="utf-8")
for x in out:
    print("\nTARGET",x["target"]["file"])
    for m in x["matches"][:3]:
        print(m["score"],m["date_diff_days"],m["date"],m["idx"],m["title"])

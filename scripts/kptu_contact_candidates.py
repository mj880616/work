import json,re
from pathlib import Path
ROOT=Path("analysis/kptu-corpus")
SRC=ROOT/"contact-authors-2023-2026.json"
OUT=ROOT/"contact-author-candidates.json"

data=json.loads(SRC.read_text(encoding="utf-8"))
bad=set("""조직쟁의 공공운수 공공기관 회서비스 미디어소 민주우체 수석부지 전략조직 택시지부 희망연대 교육선전 라이더유 연금행동 정책기획 노동안전 의료연대 대외협력 공무직본 민주버스 의회 충북지역 공공서비 공동 공동집행 구로승무 니온 든든한콜 미조직비 부산지하 연대사업 윤진영조 이류한승 조합 경북지역 공공철도 공기관사 교육소통 국가공무 국민건강 국민연금 궤도협의 꿀잠 노조전략 대외사업 대책위 도협의회 무상의료 상임집행 서비스지 아리 업회 예술강사 우체국본 인천지역 전북지역 정규직사 철노동조 충북평등""".split())

by={}
for row in data["items"]:
    for c in row.get("contacts",[]):
        n=c.get("name")
        if not n or n in bad or not re.fullmatch(r"[가-힣]{2,4}",n):continue
        by.setdefault(n,[]).append({
            "idx":row["idx"],"date":row["date"],"kind":row["kind"],"title":row["title"],"url":row["url"],
            "role":c.get("role"),"snippet":c.get("snippet")
        })
out=[]
for n,rows in by.items():
    if len(rows)>=2:
        # dedupe docs
        uniq={r["idx"]:r for r in rows}
        rows=sorted(uniq.values(),key=lambda x:(x["date"],x["idx"]),reverse=True)
        out.append({"name":n,"count":len(rows),"documents":rows})
out.sort(key=lambda x:(-x["count"],x["name"]))
OUT.write_text(json.dumps({"candidates":out},ensure_ascii=False,indent=2),encoding="utf-8")
print(json.dumps([{"name":x["name"],"count":x["count"],"titles":[r["title"] for r in x["documents"][:8]]} for x in out[:40]],ensure_ascii=False,indent=2))

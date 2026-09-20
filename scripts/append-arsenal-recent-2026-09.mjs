import fs from 'node:fs';

const path = 'personal/arsenal-match-archive/matches.js';
const raw = fs.readFileSync(path, 'utf8').trim();
const json = raw
  .replace(/^window\.ARSENAL_MATCHES\s*=\s*/, '')
  .replace(/;\s*$/, '');
const matches = JSON.parse(json);

const additions = [
  {
    "id": "2026-09-15-ipswich-away-carabao",
    "date": "2026-09-15",
    "season": "2026-27",
    "competition": "Carabao Cup",
    "round": "3R",
    "venue": "Portman Road",
    "home": "입스위치 타운",
    "away": "아스날",
    "homeScore": 2,
    "awayScore": 4,
    "result": "승",
    "title": "입스위치 타운 2-4 아스날",
    "subtitle": "9명 로테이션 속에서도 전반 16분까지 두 골, 다우먼의 개인 돌파와 중원 장악으로 일찍 승부를 기울인 컵 경기",
    "verdict": "주전 다수를 쉬게 하고도 초반 압박과 개인 질로 4-0까지 벌렸다는 점은 스쿼드 깊이를 보여줬음. 다만 승부가 끝난 뒤 두 골을 허용하며 경기 통제 강도가 떨어진 점은 남았음.",
    "summary": [
      "아르테타는 선덜랜드전 대비 9명을 바꿨고, 케파가 골문을 지킨 가운데 17세 말리 새먼이 가브리엘과 센터백을 이뤘음. 주비멘디가 오른쪽 풀백, 루이스-스켈리가 왼쪽 풀백으로 출전했고 브루노 기마랑이스-메리노가 중원을 구성했음.",
      "다우먼이 7분 직접 운반과 드리블로 선제골을 만들었고 16분 마두에케가 메리노의 패스를 받아 추가골을 넣었음. 후반 47분 다우먼이 주비멘디의 패스를 받아 두 번째 골, 58분 메리노가 네 번째 골을 기록했음.",
      "아스날은 58% 점유율과 12개의 슈팅, 6개의 유효슈팅을 기록했음. 365Scores 기준 xG는 0.95로 높지 않았지만 빅찬스 4개를 만들며 제한된 슈팅을 높은 효율로 득점으로 전환했음.",
      "입스위치는 62분 메흐메티, 추가시간 아크폼이 만회골을 넣었음. 4-0 이후 아스날이 템포와 압박 강도를 낮춘 구간에서 박스 접근을 허용했다는 점은 결과와 별개로 점검할 부분임."
    ],
    "decisive": [
      "다우먼이 오른쪽에 고정된 윙어라기보다 공을 직접 운반해 안쪽으로 진입하며 수비 기준점을 무너뜨렸고, 두 골을 직접 만들어냈음.",
      "브루노-메리노 중원이 경기 초반 세컨드볼과 전진 패스를 장악해 입스위치가 압박을 지속하지 못하게 했고, 메리노는 1골 1도움으로 공격 마무리까지 담당했음.",
      "요케레스가 득점하지는 못했지만 센터백을 깊게 묶으면서 2선의 다우먼·에제·마두에케가 박스 앞에서 전진할 공간을 확보했음.",
      "4-0 이후 교체와 경기 강도 하락 속에 두 골을 허용함. 로테이션 경기에서 승부를 끝낸 뒤에도 수비 간격과 박스 보호를 유지하는 문제가 남았음."
    ],
    "arteta": [
      "9명 로테이션으로 케파, 새먼, 다우먼 등 비주전·유망주에게 큰 역할을 주면서도 가브리엘, 브루노, 메리노, 요케레스 같은 중심축을 남겨 경기 구조를 보호했음.",
      "아르테타는 경기 후 초반부터 지배적이고 유동적이며 공격적으로 경기 결과에 영향을 주려 했고, 이른 두 골이 좋은 플랫폼을 만들었다고 평가했음.",
      "64분 테오 줄리엔을 투입하고 76분 츠올리스·외데고르를 넣는 등 유망주 경험과 주전 감각을 동시에 관리했음. 다만 4-0 이후 수비 집중력 저하는 다음 로테이션 경기의 관리 포인트임."
    ],
    "nextWatch": [
      "다우먼이 더 강한 수비를 상대로도 오른쪽에서 안쪽 운반과 박스 진입을 반복할 수 있는지.",
      "요케레스가 직접 득점하지 않는 날에도 2선의 전진 공간을 만드는 역할이 리그 경기에서 유지되는지.",
      "브루노가 선발 중원에서 세컨드볼 장악과 템포 조절을 동시에 수행할 때 라이스·주비멘디 조합과 어떤 차이를 만드는지.",
      "큰 리드를 잡은 뒤 로테이션과 유망주 투입에도 전환수비와 박스 보호 강도를 끝까지 유지할 수 있는지."
    ],
    "stats": {
      "possession": "58%",
      "shots": "12",
      "xg": "0.95",
      "bigChances": "4"
    },
    "opponentStats": {
      "possession": "42%",
      "shots": "8",
      "xg": "0.72",
      "bigChances": "1"
    },
    "lineup": {
      "startingXI": ["케파", "마르틴 주비멘디", "말리 새먼", "가브리엘", "마일스 루이스-스켈리", "브루노 기마랑이스", "미켈 메리노", "맥스 다우먼", "에베레치 에제", "노니 마두에케", "빅토르 요케레스"],
      "substitutions": ["46분 에즈리 콘사 ↔ 가브리엘", "64분 테오 줄리엔 ↔ 브루노 기마랑이스", "76분 크리스토스 츠올리스 ↔ 에베레치 에제", "76분 마르틴 외데고르 ↔ 노니 마두에케", "85분 이페올루와 이브라힘 ↔ 마르틴 주비멘디"]
    },
    "events": [
      "7분 다우먼 골(에제 도움)",
      "16분 마두에케 골(메리노 도움)",
      "47분 다우먼 골(주비멘디 도움)",
      "58분 메리노 골(다우먼 도움)",
      "62분 메흐메티 골(입스위치)",
      "90+1분 아크폼 골(입스위치)",
      "아스날 경고 0장"
    ],
    "media": [
      {
        "label": "공식 경기 리포트·사진 · Arsenal",
        "url": "https://www.arsenal.com/news/report-ipswich-town-2-4-arsenal-ajWTj8V8S3qK"
      },
      {
        "label": "공식 하이라이트 · Sky Sports",
        "url": "https://www.skysports.com/football/video/30998/13586378/ipswich-town-2-4-arsenal-carabao-cup-highlights"
      }
    ],
    "sources": [
      {
        "label": "Arsenal 공식 경기 리포트",
        "url": "https://www.arsenal.com/news/report-ipswich-town-2-4-arsenal-ajWTj8V8S3qK"
      },
      {
        "label": "Football Web Pages 경기 기록·라인업·통계",
        "url": "https://www.footballwebpages.co.uk/match/2026-2027/efl-cup/ipswich-town/arsenal/591936"
      },
      {
        "label": "365Scores 경기 데이터",
        "url": "https://www.365scores.com/football/match/efl-cup-9/arsenal-ipswich-9-104-9"
      },
      {
        "label": "Arteta 경기 후 발언 · TWTD",
        "url": "https://www.twtd.co.uk/ipswich-town-news/52803/"
      },
      {
        "label": "Reuters 경기 리포트",
        "url": "https://www.reuters.com/sports/soccer/teenager-dowman-scores-twice-arsenal-progress-league-cup-2026-09-15/"
      }
    ]
  },
  {
    "id": "2026-09-09-napoli-away-ucl",
    "date": "2026-09-09",
    "season": "2026-27",
    "competition": "UEFA Champions League",
    "round": "League Phase MD1",
    "venue": "Stadio Diego Armando Maradona",
    "home": "나폴리",
    "away": "아스날",
    "homeScore": 0,
    "awayScore": 1,
    "result": "승",
    "title": "나폴리 0-1 아스날",
    "subtitle": "26슈팅과 4.05 xG로 완전히 지배했지만 마무리가 따라오지 않다가 외데고르의 한 방으로 겨우 점수에 반영한 경기",
    "verdict": "1-0이라는 스코어만 보면 접전이지만 내용은 일방적이었음. 높은 압박을 굳이 롱볼로 건너뛸 필요 없이 짧은 빌드업과 위치 교환으로 풀었고, 문제는 탈압박이 아니라 마무리 효율이었음.",
    "summary": [
      "아스날은 첼시전에서 4명을 바꾸고 벤 화이트-콘사-가브리엘-힌카피에의 수비라인, 메리노-라이스 중원, 사카-외데고르-에제와 요케레스를 선발로 구성했음.",
      "전반에만 13개의 슈팅을 만들었고 사카가 약 0.95 xG에 해당하는 다섯 차례 슈팅을 기록했지만 득점하지 못했음. 나폴리는 전반 전체 xG가 0.12에 그쳤음.",
      "후반에도 아스날의 점유와 박스 진입이 이어졌고, 66분 투입된 츠올리스가 75분 외데고르와 원투패스를 주고받은 뒤 결승골을 도왔음. 득점 장면은 29개의 패스를 거친 긴 점유 공격이었음.",
      "Opta 기준 아스날은 58% 점유율, 26슈팅, 4.05 xG를 기록했고 나폴리는 5슈팅, 0.22 xG에 그쳤음. 26슈팅은 아스날의 챔피언스리그 단일 경기 최다 기록이었음."
    ],
    "decisive": [
      "나폴리의 전방 압박을 상대로 라야-센터백-메리노·라이스가 짧게 연결하며 첫 압박선을 지속적으로 넘었고, 사카·에제·외데고르가 하프스페이스에서 공을 받는 장면이 반복됐음.",
      "요케레스가 센터백을 깊게 끌고 가면서 외데고르와 에제가 박스 앞에서 전진 패스를 받을 공간이 생겼고, 공격이 한쪽 윙이나 세트피스에만 의존하지 않았음.",
      "문제는 찬스 생산이 아니라 결정력이었음. 다섯 차례 빅찬스를 놓치고도 결국 승리했지만, 비슷한 경기에서 선제골이 늦어질 경우 경기 리스크가 불필요하게 커질 수 있음.",
      "츠올리스 투입 후 왼쪽과 중앙의 패스 속도가 다시 올라갔고, 외데고르가 박스 밖에서 직접 마무리하며 최근 첼시전에 이어 다시 결과를 결정했음."
    ],
    "arteta": [
      "첼시전에서 체력 소모가 있었음에도 수비멘디와 브루노를 모두 선발로 쓰기보다 메리노-라이스를 유지하고 외데고르·에제·사카를 함께 배치해 공격 창조성을 우선했음.",
      "65~73분 사이 브루노, 츠올리스, 하베르츠, 마두에케를 연속 투입해 점유 구조는 유지하면서 전방의 다이내믹과 신선도를 바꿨고, 그중 츠올리스가 결승골 도움을 기록했음.",
      "아르테타는 경기 후 완전히 승점 3점을 받을 만한 경기였고 경기력에 비해 1-0이라는 결과가 작았다고 평가했음. 이 경기는 강한 원정에서도 보수적으로 내려서기보다 공격적으로 지배하는 선택의 사례였음."
    ],
    "nextWatch": [
      "강한 압박을 상대로도 라야가 롱킥보다 짧은 연결을 우선할 조건과, 반대로 롱킥으로 전환할 기준이 무엇인지.",
      "요케레스가 센터백을 뒤로 밀어 만든 공간을 외데고르·에제·사카가 얼마나 지속적으로 활용하는지.",
      "4 xG를 만들고도 한 골에 그친 마무리 문제가 일시적인 변동인지 반복되는 패턴인지.",
      "브루노와 츠올리스 같은 교체 자원이 후반 공격의 속도와 세컨드볼 회수 강도를 얼마나 안정적으로 높이는지."
    ],
    "stats": {
      "possession": "58%",
      "shots": "26",
      "xg": "4.05",
      "bigChances": "5"
    },
    "opponentStats": {
      "possession": "42%",
      "shots": "5",
      "xg": "0.22",
      "bigChances": "0"
    },
    "lineup": {
      "startingXI": ["다비드 라야", "벤 화이트", "에즈리 콘사", "가브리엘", "피에로 힌카피에", "미켈 메리노", "데클란 라이스", "부카요 사카", "마르틴 외데고르", "에베레치 에제", "빅토르 요케레스"],
      "substitutions": ["66분 브루노 기마랑이스 ↔ 미켈 메리노", "66분 크리스토스 츠올리스 ↔ 에베레치 에제", "73분 카이 하베르츠 ↔ 빅토르 요케레스", "73분 노니 마두에케 ↔ 부카요 사카", "82분 마르틴 주비멘디 ↔ 벤 화이트"]
    },
    "events": [
      "75분 외데고르 골(츠올리스 도움)",
      "90+1분 외데고르 경고",
      "나폴리 경고: 42분 길모어, 85분 루카"
    ],
    "media": [
      {
        "label": "공식 경기 리포트·사진 · Arsenal",
        "url": "https://www.arsenal.com/news/report-napoli-0-1-arsenal-ajEWm0d9QpRX"
      },
      {
        "label": "공식 하이라이트·매치 페이지 · UEFA",
        "url": "https://www.uefa.com/uefachampionsleague/match/2049563--napoli-vs-arsenal/"
      }
    ],
    "sources": [
      {
        "label": "UEFA 공식 결과·하이라이트",
        "url": "https://www.uefa.com/uefachampionsleague/match/2049563--napoli-vs-arsenal/"
      },
      {
        "label": "Arsenal 공식 경기 리포트",
        "url": "https://www.arsenal.com/news/report-napoli-0-1-arsenal-ajEWm0d9QpRX"
      },
      {
        "label": "Opta Analyst 경기 분석·xG",
        "url": "https://theanalyst.com/articles/napoli-vs-arsenal-stats-champions-league-09-2026"
      },
      {
        "label": "Football Web Pages 경기 기록·라인업",
        "url": "https://www.footballwebpages.co.uk/match/2026-2027/uefa-champions-league/napoli/arsenal/591971"
      },
      {
        "label": "Arteta 경기 후 발언",
        "url": "https://www.aol.com/articles/napoli-0-1-arsenal-arteta-215233000.html"
      }
    ]
  }
];

const existing = new Set(matches.map((m) => m.id));
for (const match of additions) {
  if (!existing.has(match.id)) matches.push(match);
}
matches.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
fs.writeFileSync(path, `window.ARSENAL_MATCHES = ${JSON.stringify(matches, null, 2)};\n`);

# CES Archive (시안 2차: 구글 시트 5,097건 적용)

GIF.News 디자인을 그대로 가져와 **us.aving.net의 CES 기사 전체를 CES 행사 연도별로** 보여주는 사이트입니다.
DB 없이 JSON 파일만 쓰고, 기사 5,000건 이상이어도 필요한 파일만 나눠 읽도록 만들었습니다.

## 바로 보기
JSON을 `fetch`로 읽기 때문에 **index.html 더블클릭으로는 열리지 않습니다.** (GIF와 다른 점)
- VS Code **Live Server** → index.html 우클릭 → *Open with Live Server*
- 또는 이 폴더에서 `python -m http.server 8000` 실행 → http://localhost:8000

## 파일 구조
```
CES/
├─ index.html            페이지 뼈대
├─ assets/style.css      GIF.News 디자인 그대로 (GIF에서 고치면 복사만 하면 됨)
├─ assets/ces.css        CES 사이트에만 필요한 추가 스타일 (글자 로고, 더보기 버튼 등)
├─ assets/app.js         화면 그리는 스크립트
├─ data/                 ← tools/build_data.py 가 자동으로 만드는 폴더 (직접 고치지 않음)
│  ├─ meta.json          갱신 시각, 연도별·태그별 건수
│  ├─ search.json        전체 색인 (제목·날짜·연도·썸네일) → 홈, 검색, 메뉴에 사용
│  ├─ list-2026.json     연도별 목록 + 요약 → 그 연도 화면을 열 때만 읽음
│  └─ body/12345.json    기사 본문 → 기사를 열 때만 읽음 (없으면 요약 + 원문 링크)
├─ source/               ← 기사 목록 파일을 넣는 곳 (ces_sheet.txt = 구글 시트 내보내기, 5,097건)
└─ tools/build_data.py   엑셀 → data/ 변환 스크립트 (인터넷 접속 안 함)
```

## 메뉴
| 메뉴 | 주소 | 분류 기준 (제목에서 자동) |
|---|---|---|
| Latest | `#latest` | 전체, 날짜순 |
| Video | `#video`, `#video-2015` | YouTube 주소가 있는 기사 (팝업 재생) |
| Innovation Awards | `#tag-awards` | "Innovation Award", "Best of Innovation", "Honoree" |
| Pavilions | `#tag-pavilion` | "Pavilion" |
| CES Unveiled | `#tag-unveiled` | "Unveiled" |
| Interviews | `#tag-interview` | "Interview" |
| News by Year | `#year-2026` 등 | 행사 연도 (아래 규칙) |

**행사 연도**: 구글 시트의 시트 이름("CES 2026")을 그대로 씁니다. 시트에 넣은 기사는 제목에 CES가 없어도 모두 들어갑니다.
(시트 이름에 연도가 없는 파일일 때만: 제목의 "CES 2026" → 없으면 9~12월 기사는 다음 해로 계산, 제목에 대문자 `CES` 단어가 있는 기사만 사용)

**이미지**: 대표이미지 열 → 없으면 YouTube 썸네일 → 둘 다 없으면 "CES 2011" 같은 연도 글자.
**홈 사이드바 Most Read**: 최신 연도 기사 중 조회수 순.

## 데이터 갱신
1. 구글 시트를 고친 뒤 **파일 → 다운로드 → Microsoft Excel(.xlsx)** 로 받아 `source/` 폴더에 넣기 (가장 최근 파일을 자동으로 읽음, 모든 시트를 읽음)
2. CES 폴더에서 실행: `python tools/build_data.py` (처음 한 번은 `pip install openpyxl`)
3. 열 이름을 못 찾으면 현재 열을 알려 줍니다 → `build_data.py`의 `COLS`에 이름 추가

### 대표이미지·요약·본문 채우기 (보충 파일)
관리자 페이지 엑셀에 대표이미지·본문 열이 있으면, 목록 파일 뒤에 이어서 지정하세요.
같은 기사번호끼리 이미지·요약·본문만 채워 넣습니다 (기사 목록과 연도는 구글 시트 기준 그대로).
```
python tools/build_data.py source/ces_sheet.xlsx source/관리자엑셀.xlsx
```
본문이 들어가면 `data/body/`에 기사별 파일이 생기고, 사이트 안에서 기사 전문을 읽을 수 있습니다.

## 배포
GIF와 같은 방식(GitHub `tec-create/aving-ces` + Vercel `aving-ces`)입니다. 자세한 순서는 **배포가이드.md** 를 보세요.
`.vercelignore`로 `source/`, `tools/`, README, 쓰지 않는 로고는 사이트에 올라가지 않게 했습니다.

## 주의
- 사이트와 변환 스크립트는 에이빙 서버에 접속하지 않습니다. 썸네일·요약(`source/thumbs.json`)은 2026-10-27에 기사당 1.5초 간격으로 한 번 모아 둔 것이고, 새 기사의 사진은 관리자 엑셀(대표이미지 열)로 채우는 걸 권장합니다 (IP 차단 위험).
- 로고: `assets/logo-header.png`(투명 배경) 하나를 상단(폭 250px)과 푸터(높이 80px, 모바일 72px)에 같이 씁니다. 크기는 `ces.css`의 `.brand` 에서 조절합니다.
- CES® 로고는 CTA 상표라 사용하지 않았습니다.

# -*- coding: utf-8 -*-
"""
CES 사이트 데이터 만들기
------------------------------------------------------------
기사 목록 파일을 읽어서 사이트가 쓰는 JSON 파일들을 data/ 폴더에 만듭니다.
이 스크립트는 인터넷에 접속하지 않습니다 (에이빙 서버에 요청 없음).

읽을 수 있는 파일 (source 폴더에 넣으면 가장 최근 파일을 자동으로 읽음):
  - 구글 시트를 엑셀로 받은 .xlsx   시트 이름이 "CES 2026" 이면 그 시트 기사는 CES 2026 으로 분류
  - 시트 내보내기 .txt               "## Sheet name: CES 2026" 아래에 CSV 가 이어지는 형식
  - 관리자 페이지 엑셀 .xlsx / .csv  시트 이름에 연도가 없으면 제목·날짜로 연도를 계산

사용법 (CES 폴더에서):
    python tools/build_data.py                         source 폴더에서 자동으로 찾음
    python tools/build_data.py source/기사목록.xlsx      파일을 직접 지정
    python tools/build_data.py 목록.xlsx 관리자엑셀.xlsx  두 번째 파일부터는 "보충용":
                                                         같은 기사번호의 대표이미지·요약·본문만 채워 넣음

만들어지는 파일:
    data/meta.json          갱신 시각, 연도별 건수, 태그별 건수
    data/search.json        전체 색인 [id, 제목, 날짜, 연도, 썸네일, 기자, 태그, YouTube, 조회수, 카테고리]
    data/list-2026.json     연도별 목록 (요약 포함)
    data/body/12345.json    기사 본문 (본문 열이 있을 때만)

열 이름이 다르면 COLS 에 이름을 추가하세요.
"""
import csv, glob, html, io, json, os, re, sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CDN = "https://cdn.us.aving.net/news/photo/"

COLS = {
    "id":    ["idxno", "기사번호", "기사 번호", "번호", "id", "no"],
    "url":   ["URL 주소", "URL", "기사 URL", "기사주소", "링크", "link"],
    "title": ["기사 제목", "제목", "기사제목", "title"],
    "sub":   ["부제", "부제목", "subtitle", "sub_title"],
    "lead":  ["요약", "리드", "lead", "summary"],
    "sec":   ["카테고리", "섹션", "섹션명", "1차섹션", "section", "category"],
    "by":    ["기자명", "기자", "작성자", "writer", "byline"],
    "date":  ["등록일", "출고일", "발행일", "작성일", "입력일", "date", "regdate"],
    "img":   ["대표이미지", "대표 이미지", "썸네일", "이미지", "image", "thumbnail"],
    "body":  ["본문", "내용", "기사본문", "content", "body"],
    "yt":    ["YouTube 주소", "YouTube", "유튜브", "유튜브 주소", "영상", "video"],
    "views": ["조회수", "views", "hit", "hits"],
}

# 연도 정보가 없는 파일일 때만 쓰는 규칙 ---------------------------
# 제목에 대문자 CES 가 "단어"로 들어간 기사만 (Success, Access, Services 제외)
CES_WORD = re.compile(r"\bCES\b")
# 행사 연도: "CES 2026", "CES2026", "CES Innovation Awards 2027" ...
CES_YEAR = re.compile(r"\bCES\s*(?:Innovation\s+Awards?\s*|Asia\s+|Unveiled\s+)?(20\d\d)\b", re.I)

TAGS = [
    ("awards",    re.compile(r"Innovation\s+Award|Best\s+of\s+Innovation|Honoree", re.I)),
    ("pavilion",  re.compile(r"Pavilion", re.I)),
    ("unveiled",  re.compile(r"\bUnveiled\b", re.I)),
    ("interview", re.compile(r"Interview", re.I)),
]


# ---------- 읽기 ----------
def sheet_year(name):
    m = re.search(r"(20\d\d)", name or "")
    return int(m.group(1)) if m else None


def map_rows(head, raw, sheet):
    """열 이름 → 표준 키. 시트마다 열 순서가 달라도 이름으로 맞춥니다."""
    head = [str(h or "").strip() for h in head]
    low = {h.lower().replace(" ", ""): i for i, h in enumerate(head) if h}
    pick = {}
    for key, names in COLS.items():
        for n in names:
            i = low.get(n.lower().replace(" ", ""))
            if i is not None:
                pick[key] = i
                break
    # 머리글이 비어 있는 첫 열에 카테고리가 들어 있는 시트 (예: CES 2012)
    if "sec" not in pick and head and head[0] == "" and "title" in pick and pick["title"] == 1:
        pick["sec"] = 0
    if "title" not in pick or ("id" not in pick and "url" not in pick):
        print("  ! [%s] 제목/기사번호(URL) 열을 찾지 못해 건너뜀. 현재 열: %s" % (sheet, head))
        return []
    y = sheet_year(sheet)
    out = []
    for r in raw:
        r = list(r)
        row = {k: (r[i] if i < len(r) else None) for k, i in pick.items()}
        row["_y"] = y
        out.append(row)
    return out


def read_file(path):
    """파일 하나 → 표준 행 목록"""
    ext = os.path.splitext(path)[1].lower()
    rows = []
    if ext == ".json":   # 시안용 표본: [id, title, by, date, img, lead]
        for r in json.load(open(path, encoding="utf-8")):
            rows.append({"id": r[0], "title": r[1], "by": r[2], "date": r[3], "img": r[4], "lead": r[5], "_y": None})
    elif ext in (".xlsx", ".xlsm"):
        try:
            import openpyxl
        except ImportError:
            sys.exit("엑셀을 읽으려면 먼저  pip install openpyxl  을 실행하세요.")
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for ws in wb.worksheets:   # 모든 시트를 읽음
            it = ws.iter_rows(values_only=True)
            head = next(it, None)
            if head:
                rows += map_rows(head, it, ws.title)
    elif ext in (".csv", ".txt", ".md"):
        text = None
        for enc in ("utf-8-sig", "cp949"):
            try:
                text = open(path, encoding=enc).read()
                break
            except UnicodeDecodeError:
                continue
        parts = re.split(r"^## Sheet name:\s*(.*)$", text, flags=re.M)
        sheets = [("", parts[0])] if len(parts) == 1 else [(parts[i].strip(), parts[i + 1]) for i in range(1, len(parts), 2)]
        for name, body in sheets:
            data = list(csv.reader(io.StringIO(body.strip("\n"))))
            if data:
                rows += map_rows(data[0], data[1:], name)
    else:
        sys.exit("지원하지 않는 파일 형식입니다: " + path)
    return rows


# ---------- 다듬기 ----------
def norm_date(v):
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M")
    s = str(v or "").strip().replace(".", "-").replace("/", "-")
    m = re.match(r"(\d{4})-(\d{1,2})-(\d{1,2})(?:\D+(\d{1,2}):(\d{2}))?", s)
    if not m:
        return ""
    y, mo, d, hh, mm = m.groups()
    return "%s-%02d-%02d %02d:%s" % (y, int(mo), int(d), int(hh or 0), mm or "00")


def event_year(title, date):
    """시트에 연도가 없을 때: 제목의 'CES 2026'이 우선, 없으면 9~12월 기사는 다음 해 CES."""
    m = CES_YEAR.search(title)
    if m:
        return int(m.group(1))
    y, mo = int(date[:4]), int(date[5:7])
    return y + 1 if mo >= 9 else y


def article_id(row):
    for v in (row.get("id"), row.get("url")):
        m = re.search(r"idxno=(\d+)", str(v or "")) or re.fullmatch(r"\s*(\d+)(?:\.0)?\s*", str(v or ""))
        if m:
            return int(m.group(1))
    return None


def youtube_id(v):
    m = re.search(r"(?:v=|youtu\.be/|shorts/|embed/|live/)([\w-]{11})", str(v or ""))
    return m.group(1) if m else ""


def to_int(v):
    try:
        return int(str(v or "0").replace(",", "").split(".")[0])
    except ValueError:
        return 0


def short_img(v):
    s = str(v or "").strip()
    if not s:
        return ""
    if s.startswith("//"):
        s = "https:" + s
    return s[len(CDN):] if s.startswith(CDN) else s   # CDN 앞부분은 줄여서 저장 (용량 절약)


class BodyParser(HTMLParser):
    """기사 본문 HTML → 문단/소제목/사진/영상 블록 (GIF 사이트와 같은 형식)"""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.buf, self.tag, self.cap, self.in_cap = [], [], "p", [], False

    def flush(self):
        t = re.sub(r"\s+", " ", "".join(self.buf)).strip()
        if t:
            self.out.append({"t": "h" if self.tag in ("h2", "h3", "h4") else "p", "x": t})
        self.buf, self.tag = [], "p"

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ("p", "div", "br", "h2", "h3", "h4", "li"):
            self.flush()
            if tag in ("h2", "h3", "h4"):
                self.tag = tag
        elif tag == "img" and a.get("src"):
            self.flush()
            self.out.append({"t": "img", "src": a["src"] if not a["src"].startswith("//") else "https:" + a["src"], "cap": ""})
        elif tag == "figcaption":
            self.flush()
            self.in_cap, self.cap = True, []
        elif tag == "iframe" and "youtube" in (a.get("src") or ""):
            yid = youtube_id(a["src"])
            if yid:
                self.flush()
                self.out.append({"t": "yt", "id": yid})

    def handle_endtag(self, tag):
        if tag == "figcaption":
            cap = re.sub(r"\s+", " ", "".join(self.cap)).strip()
            for b in reversed(self.out):
                if b["t"] == "img":
                    b["cap"] = cap
                    break
            self.in_cap = False
        elif tag in ("p", "div", "h2", "h3", "h4", "li"):
            self.flush()

    def handle_data(self, d):
        (self.cap if self.in_cap else self.buf).append(d)


def parse_body(v):
    s = str(v or "").strip()
    if not s:
        return []
    if "<" not in s:   # 태그 없는 일반 글
        return [{"t": "p", "x": p.strip()} for p in re.split(r"\n\s*\n|\r?\n", s) if p.strip()]
    p = BodyParser()
    p.feed(s)
    p.flush()
    return p.out


def clip(s, n=220):
    s = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(s or "")))).strip()
    s = re.sub(r"([a-z\)])\.([A-Z][a-z])", r"\1. \2", s)   # 문단이 붙어 "control.Founded" 가 된 곳 띄우기
    return s if len(s) <= n else s[:n].rsplit(" ", 1)[0] + "…"


# ---------- 실행 ----------
def find_source():
    pats = ("*.xlsx", "*.csv", "*.txt")
    found = [f for p in pats for f in glob.glob(os.path.join(ROOT, "source", p))]
    found.sort(key=os.path.getmtime, reverse=True)
    return found[0] if found else os.path.join(ROOT, "source", "sample.json")


def main():
    srcs = sys.argv[1:] or [find_source()]
    print("기본 목록:", srcs[0])
    rows = read_file(srcs[0])
    is_sample = srcs[0].endswith(".json")

    # 보충용 파일: 같은 기사번호의 이미지·요약·본문만 채움
    extra = {}
    # source/thumbs.json: 기사 페이지에서 모아 둔 {기사번호: [대표이미지, 요약]}
    tp = os.path.join(ROOT, "source", "thumbs.json")
    if os.path.exists(tp):
        for k, v in json.load(open(tp, encoding="utf-8")).items():
            img = v[0] if v and not re.search(r"/image/logo/|snslogo|noimage", v[0] or "") else ""
            extra[int(k)] = {"img": img, "lead": v[1] if len(v) > 1 else ""}
        print("썸네일 파일: %d건" % len(extra))
    for p in srcs[1:]:
        print("보충 파일:", p)
        for r in read_file(p):
            aid = article_id(r)
            if aid:   # 썸네일 파일 위에 덮어씀 (값이 있는 열만)
                extra[aid] = dict(extra.get(aid, {}), **{k: v for k, v in r.items() if v})

    items, seen, skipped, dup, moved = [], set(), 0, 0, []
    for r in rows:
        title = re.sub(r"\s+", " ", str(r.get("title") or "")).strip()
        aid = article_id(r)
        if not title or not aid:
            continue
        if aid in seen:
            dup += 1
            continue
        date = norm_date(r.get("date"))
        if not date:
            continue
        y = r.get("_y")
        if y:
            # 시트 연도보다 한 해 뒤 CES 를 제목에 적은 기사는 그 연도로 옮김
            # 예: "CES 2026" 시트의 [CES Innovation Awards 2027 Special] → CES 2027
            m = CES_YEAR.search(title)
            if m and int(m.group(1)) == y + 1:
                y += 1
                moved.append((r.get("_y"), y, aid, title))
        else:   # 연도가 정해진 시트가 아니면 제목으로 CES 기사인지 판정
            if not CES_WORD.search(title):
                skipped += 1
                continue
            y = event_year(title, date)
        seen.add(aid)
        e = extra.get(aid, {})
        body = parse_body(r.get("body") or e.get("body"))
        lead = clip(r.get("lead") or e.get("lead") or r.get("sub") or e.get("sub") or
                    " ".join(b["x"] for b in body if b["t"] == "p")[:400])
        img = short_img(r.get("img") or e.get("img")) or next((short_img(b["src"]) for b in body if b["t"] == "img"), "")
        items.append({
            "id": aid, "t": title, "d": date, "y": y, "by": str(r.get("by") or "").strip(),
            "img": img, "lead": lead, "sec": str(r.get("sec") or "").strip(),
            "tags": [k for k, rx in TAGS if rx.search(title)],
            "yt": youtube_id(r.get("yt")), "v": to_int(r.get("views")), "_body": body,
        })

    items.sort(key=lambda x: (x["d"], x["id"]), reverse=True)
    os.makedirs(os.path.join(DATA, "body"), exist_ok=True)

    # 연도별 목록
    years = sorted({x["y"] for x in items}, reverse=True)
    for f in glob.glob(os.path.join(DATA, "list-*.json")):   # 없어진 연도의 예전 파일 정리 (못 지우면 그냥 둠)
        if int(re.sub(r"\D", "", os.path.basename(f)) or 0) not in years:
            try:
                os.remove(f)
            except OSError:
                pass
    for y in years:
        lst = [{k: v for k, v in x.items() if k not in ("_body", "y")} for x in items if x["y"] == y]
        json.dump(lst, open(os.path.join(DATA, "list-%d.json" % y), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # 검색 색인
    idx = [[x["id"], x["t"], x["d"], x["y"], x["img"], x["by"], x["tags"], x["yt"], x["v"], x["sec"]] for x in items]
    json.dump(idx, open(os.path.join(DATA, "search.json"), "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))

    # 본문
    nbody = 0
    for x in items:
        if x["_body"]:
            json.dump({"body": x["_body"]}, open(os.path.join(DATA, "body", "%d.json" % x["id"]), "w", encoding="utf-8"),
                      ensure_ascii=False, separators=(",", ":"))
            nbody += 1

    meta = {
        "updated": datetime.now(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M KST"),
        "sample": is_sample,
        "total": len(items),
        "videos": sum(1 for x in items if x["yt"]),
        "years": [{"y": y, "n": sum(1 for x in items if x["y"] == y), "v": sum(1 for x in items if x["y"] == y and x["yt"])} for y in years],
        "tags": {k: sum(1 for x in items if k in x["tags"]) for k, _ in TAGS},
    }
    json.dump(meta, open(os.path.join(DATA, "meta.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    print("기사 %d건 (중복 %d건 제외, CES 기사가 아니라 제외 %d건) · 영상 %d건 · 이미지 %d건 · 본문 %d건" % (
        len(items), dup, skipped, meta["videos"], sum(1 for x in items if x["img"]), nbody))
    if moved:
        print("다음 해 CES 로 옮긴 기사 %d건:" % len(moved))
        for a, b, aid, t in moved:
            print("  CES %d → CES %d  [%d] %s" % (a, b, aid, t[:80]))
    print("연도별:", ", ".join("%d년 %d건" % (m["y"], m["n"]) for m in meta["years"]))
    print("태그별:", meta["tags"])


if __name__ == "__main__":
    main()

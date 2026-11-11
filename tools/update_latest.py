"""
us.aving.net 새 CES 기사 자동 수집 (매일 GitHub Actions 에서 실행)

  python tools/update_latest.py            → 새 기사를 source/auto/ 에 추가
  python tools/update_latest.py --dry-run  → 무엇을 추가할지 보여 주기만 함

하는 일
  1. us.aving.net 에서 "CES" 로 검색한 목록을 최신순으로 읽어, 지난번에 확인한 기사번호(state.json)보다 새 기사를 찾음
  2. 새 기사 페이지를 하나씩 열어 CES 기사인지 판정
       - 제목에 CES 라는 단어가 있거나
       - 본문에 "CES 2027", "CES Innovation Awards 2027" 처럼 지금 사이트의 최신 CES 이상 연도가 나오면 CES 기사
       ("CES, MWC 같은 전시회" 처럼 이름만 비교로 나온 기사는 제외)
  3. CES 기사는 제목·섹션·기자·날짜·대표이미지·YouTube·본문을 저장
       source/auto/articles.json     기사 목록 (build_data.py 가 구글 시트 목록과 합침)
       source/bodies/ces_body_auto.json  본문
       source/auto/state.json        마지막으로 확인한 기사번호

서버 보호: 요청 사이 2초 이상 쉬고, 한 번에 하나씩만 접속. 403/429 가 오면 즉시 멈춤.
필요 패키지: beautifulsoup4
"""
import json, os, re, sys, time, urllib.error, urllib.request
from datetime import datetime

from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AUTO = os.path.join(ROOT, "source", "auto")
BODY_FILE = os.path.join(ROOT, "source", "bodies", "ces_body_auto.json")
BASE = "https://us.aving.net"
LIST_URL = BASE + "/news/articleList.html?page=%d&sc_area=A&view_type=sm&sc_word=CES"
VIEW_URL = BASE + "/news/articleView.html?idxno=%d"
WAIT = 2.0          # 요청 간격 (초)
MAX_PAGES = 10      # 한 번에 읽을 목록 페이지 수 (한 페이지 20건)
MAX_ARTICLES = 150  # 한 번에 열어 볼 기사 수

CES_WORD = re.compile(r"\bCES\b")
CES_YEAR = re.compile(r"\bCES\s*(?:Innovation\s+Awards?\s*|Asia\s+|Unveiled\s+|in\s+(?:January\s+)?)?(20\d\d)\b", re.I)
YT = re.compile(r"(?:embed/|youtu\.be/|v=|shorts/)([\w-]{11})")


class Blocked(Exception):
    pass


_last = [0.0]


def get(url):
    """천천히 한 건씩. 403/429 면 Blocked."""
    wait = WAIT - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; AVING-CES-archive-bot; +https://avingces.news)",
        "Accept-Language": "en-US,en;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        if e.code in (403, 429):
            raise Blocked("HTTP %d" % e.code)
        raise
    finally:
        _last[0] = time.time()


def load(path, default):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    if isinstance(obj, list):   # 기사 목록은 한 줄에 한 건 (GitHub 에서 바뀐 부분을 보기 쉽게)
        txt = "[\n" + ",\n".join(json.dumps(x, ensure_ascii=False) for x in obj) + "\n]\n"
    else:
        txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    open(tmp, "w", encoding="utf-8", newline="\n").write(txt)
    os.replace(tmp, path)


def known_ids():
    """이미 사이트에 있는 기사번호 (data/search.json) + 자동 추가분"""
    ids = {x[0] for x in load(os.path.join(ROOT, "data", "search.json"), [])}
    ids |= {a["id"] for a in load(os.path.join(AUTO, "articles.json"), [])}
    return ids


def newest_ces_year():
    years = [y["y"] for y in load(os.path.join(ROOT, "data", "meta.json"), {}).get("years", [])]
    return max(years) if years else datetime.now().year + 1


# ---------- 목록 ----------
def list_page(n):
    s = BeautifulSoup(get(LIST_URL % n), "html.parser")
    out = []
    for li in s.select("li"):
        a = li.select_one("h4.titles a[href*=idxno]")
        if a:
            m = re.search(r"idxno=(\d+)", a["href"])
            if m:
                out.append(int(m.group(1)))
    return out


# ---------- 기사 ----------
def parse_article(aid, html):
    s = BeautifulSoup(html, "html.parser")
    def meta(p):
        t = s.find("meta", property=p)
        return (t.get("content") or "").strip() if t else ""
    info = [li.get_text(" ", strip=True) for li in s.select("ul.infomation li")]
    by = next((re.sub(r"^기자명\s*", "", x) for x in info if x.startswith("기자명")), "") or meta("og:article:author")
    pub = next((x for x in info if "Published" in x), "")
    m = re.search(r"(\d{4})\.(\d\d)\.(\d\d)\s+(\d\d:\d\d)", pub)
    date = "%s-%s-%s %s" % m.groups() if m else ""
    sec = meta("article:section") or (info[1] if len(info) > 1 else "")
    title = meta("og:title") or (s.select_one("h3.heading") or s.new_tag("x")).get_text(strip=True)

    blocks = []
    body = s.select_one("#article-view-content-div")

    def walk(el):
        for n in el.find_all(recursive=False):
            tg = n.name
            if tg == "figure":
                im = n.find("img")
                if im and im.get("src"):
                    cap = n.find("figcaption")
                    blocks.append({"t": "img", "src": im["src"], "cap": cap.get_text(" ", strip=True) if cap else ""})
            elif tg == "iframe":
                y = YT.search(n.get("src", ""))
                if y:
                    blocks.append({"t": "yt", "id": y.group(1)})
            elif re.fullmatch(r"h[1-6]", tg or ""):
                x = re.sub(r"\s+", " ", n.get_text(" ")).strip()
                if x:
                    blocks.append({"t": "h", "x": x})
            elif tg == "p":
                f = n.find("iframe")
                y = YT.search(f.get("src", "")) if f else None
                if y:
                    blocks.append({"t": "yt", "id": y.group(1)})
                    continue
                x = re.sub(r"\s+", " ", n.get_text()).strip()
                if x:
                    blocks.append({"t": "p", "x": x})
            elif tg in ("div", "section"):
                walk(n)

    if body:
        walk(body)
    text = body.get_text(" ") if body else ""
    yt = next((b["id"] for b in blocks if b["t"] == "yt"), "")
    return {"id": aid, "t": re.sub(r"\s+", " ", title).strip(), "sec": sec, "by": by, "d": date,
            "img": meta("og:image"), "yt": ("https://www.youtube.com/watch?v=" + yt) if yt else "",
            "_blocks": blocks, "_text": text}


def ces_year(a, min_year):
    """CES 기사면 행사 연도, 아니면 None"""
    m = CES_YEAR.search(a["t"])
    if m:
        return int(m.group(1))
    body_years = [int(y) for y in CES_YEAR.findall(a["_text"]) if int(y) >= min_year]
    if body_years:
        return max(body_years)
    if CES_WORD.search(a["t"]):   # 제목에 CES 는 있는데 연도가 없으면 날짜로: 1월 20일 이후 기사는 다음 CES
        y, mo, d = int(a["d"][:4]), int(a["d"][5:7]), int(a["d"][8:10])
        return y if (mo == 1 and d <= 20) else y + 1
    return None


def main():
    dry = "--dry-run" in sys.argv
    state = load(os.path.join(AUTO, "state.json"), {})
    last = state.get("last_id", 0)
    have = known_ids()
    if not last:
        last = max(have) if have else 0
    min_year = newest_ces_year()
    print("지난번 확인 기사번호: %d · 기준 CES 연도: %d 이상" % (last, min_year))

    # 1) 목록: 지난번 번호보다 새 기사만
    new_ids, reached = [], False
    try:
        for p in range(1, MAX_PAGES + 1):
            ids = list_page(p)
            if not ids:
                break
            new_ids += [i for i in ids if i > last and i not in have]
            if min(ids) <= last:
                reached = True
                break
    except Blocked as e:
        print("! 목록에서 차단 응답 (%s) → 오늘은 중단" % e)
        return 2
    new_ids = sorted(set(new_ids))[:MAX_ARTICLES]
    print("새로 확인할 기사: %d건%s" % (len(new_ids), "" if reached or not new_ids else " (목록 끝까지 못 감, 다음 실행 때 이어서)"))

    # 2) 기사 하나씩
    added, checked, fails = [], last, 0
    for aid in new_ids:
        try:
            a = parse_article(aid, get(VIEW_URL % aid))
        except Blocked as e:
            print("! 기사 %d 에서 차단 응답 (%s) → 중단, 다음 실행 때 이어서" % (aid, e))
            break
        except Exception as e:  # 네트워크 오류 등
            fails += 1
            print("  ? %d 읽기 실패: %s" % (aid, e))
            if fails >= 3:
                print("! 연속 실패 3회 → 중단")
                break
            continue
        fails = 0
        checked = aid
        if not a["t"] or not a["d"]:
            continue
        y = ces_year(a, min_year)
        if y:
            a["y"] = y
            added.append(a)
            print("  + [%d] CES %d  %s" % (aid, y, a["t"][:90]))
    else:
        if new_ids:
            checked = max(checked, new_ids[-1])
    if not new_ids and reached:
        checked = max(last, checked)

    print("CES 기사 %d건 추가 · 마지막 확인 번호 %d" % (len(added), checked))
    if dry:
        return 0

    if added:
        arts = load(os.path.join(AUTO, "articles.json"), [])
        arts += [{k: v for k, v in a.items() if not k.startswith("_")} for a in added]
        arts.sort(key=lambda x: x["id"], reverse=True)
        save(os.path.join(AUTO, "articles.json"), arts)
        bodies = load(BODY_FILE, {})
        for a in added:
            if a["_blocks"]:
                bodies[str(a["id"])] = a["_blocks"]
        save(BODY_FILE, bodies)
    state.update(last_id=checked, last_run=datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"), last_added=len(added))
    save(os.path.join(AUTO, "state.json"), state)

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        open(out, "a").write("added=%d\n" % len(added))
    return 0


if __name__ == "__main__":
    sys.exit(main())

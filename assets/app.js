/*
 * CES Archive 화면 렌더링 스크립트
 * ------------------------------------------------------------
 * GIF.News(app.js) 구조를 그대로 따르되, 기사 5,000건을 감당하도록
 * 데이터를 한 번에 다 읽지 않고 "필요할 때 필요한 파일만" 읽습니다.
 *
 *   data/meta.json        처음에 읽음 (연도·태그별 건수)
 *   data/search.json      처음에 읽음 (전체 색인: 제목·날짜·연도·썸네일 — 요약 없음)
 *   data/list-2026.json   그 연도의 요약(lead)이 필요할 때만 읽음
 *   data/body/12345.json  기사를 열 때만 읽음 (없으면 요약 + 원문 링크)
 *
 * 주소 뒤 # 값으로 화면이 바뀝니다.
 *   (없음)           홈
 *   #latest          최신 기사
 *   #year-2026       CES 2026 기사
 *   #video           영상이 있는 기사 (#video-2015 처럼 연도 필터)
 *   #tag-awards      Innovation Awards   (#tag-pavilion, #tag-unveiled, #tag-interview)
 *   #article-12345   기사 상세
 *   #search-단어     검색 결과
 *
 * 주의: JSON 을 fetch 로 읽기 때문에 index.html 더블클릭(file://)으로는 열리지 않습니다.
 *       Live Server, python -m http.server, 또는 Vercel 에서 열어 주세요.
 */
(function () {
  "use strict";

  var AVING = "https://us.aving.net/news/articleView.html?idxno=";
  var CDN = "https://cdn.us.aving.net/news/photo/";
  var PAGE = 30;                      // 목록 한 번에 보여 줄 개수
  var app = document.getElementById("app");

  /* 메뉴 정의: 순서를 바꾸면 메뉴 순서도 바뀝니다 */
  var MENU = [
    { key: "latest",        name: "Latest",            desc: "Newest CES stories first" },
    { key: "video",         name: "Video",             desc: "AVING's CES videos on YouTube" },
    { key: "tag-awards",    name: "Innovation Awards", desc: "Honorees and Best of Innovation winners" },
    { key: "tag-pavilion",  name: "Pavilions",         desc: "Seoul, K-Startup, IFEZ, Gyeonggi and other national pavilions" },
    { key: "tag-unveiled",  name: "CES Unveiled",      desc: "First looks from the CES Unveiled media preview" },
    { key: "tag-interview", name: "Interviews",        desc: "On-site interviews with founders and organizers" },
    { key: "year",          name: "News by Year",      desc: "Every story, filed by CES edition" }
  ];
  var menuOf = {};
  MENU.forEach(function (m) { menuOf[m.key] = m; });
  var TAG_NAME = { awards: "Innovation Awards", pavilion: "Pavilion", unveiled: "CES Unveiled", interview: "Interview" };

  var META, IDX = [], byId = {}, LISTS = {}, LEAD = {}, BODY = {};

  /* ---------- 데이터 읽기 ---------- */
  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status + " " + url);
      return r.json();
    });
  }
  // 연도별 목록(요약 포함)을 필요할 때만 읽고, 한 번 읽은 건 기억해 둡니다
  function loadYears(years) {
    var need = years.filter(function (y, i) { return years.indexOf(y) === i && !LISTS[y]; });
    return Promise.all(need.map(function (y) {
      LISTS[y] = getJSON("data/list-" + y + ".json").then(function (list) {
        list.forEach(function (a) { LEAD[a.id] = a; });
        return list;
      }).catch(function () { return []; });
      return LISTS[y];
    }));
  }
  function withLeads(items) {
    return loadYears(items.map(function (a) { return a.y; })).then(function () { return items; });
  }

  /* ---------- 작은 도우미 함수 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function short(t) { return t.replace(/^\[[^\]]{3,60}\]\s*/, ""); }   // 앞의 [CES 2026 Special] 같은 말머리 떼기
  function day(a) { return a.d.slice(0, 10).replace(/-/g, "."); }
  function src(img) { return !img ? "" : /^https?:/.test(img) ? img : CDN + img; }
  function thumb(a) { return a.img ? src(a.img) : a.yt ? "https://i.ytimg.com/vi/" + a.yt + "/hqdefault.jpg" : ""; }
  function lead(a) { return (LEAD[a.id] && LEAD[a.id].lead) || ""; }
  function has(a, tag) { return a.tags.indexOf(tag) > -1; }
  function newest() { return META.years[0] ? META.years[0].y : new Date().getFullYear(); }
  function kicker(a) {
    var cls = a.y === newest() ? "tag--new" : "";
    var extra = has(a, "awards") ? ' <span class="tag tag--award">Award</span>' : "";
    return '<span class="tag ' + cls + '">CES ' + a.y + "</span>" + extra;
  }
  // 이미지 틀: 이미지가 없으면 "CES 2011" 같은 연도 글자를 보여 줍니다. 영상 기사에는 재생 표시
  function ph(a, cls) {
    var s = thumb(a);
    return '<span class="ph ' + (cls || "") + (s ? "" : " ph--none") + (a.yt ? " ph--video" : "") + '" data-y="CES ' + a.y + '">' +
      (s ? '<img src="' + esc(s) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'ph--none\');this.remove()">' : "") +
      (a.yt ? '<span class="vid__play" aria-hidden="true"></span>' : "") + "</span>";
  }
  function meta(a) { return '<span class="meta">' + esc(a.by) + (a.by ? " · " : "") + day(a) + "</span>"; }
  function link(a, inner, cls) { return '<a class="' + (cls || "") + '" href="#article-' + a.id + '">' + inner + "</a>"; }
  function num(n) { return n.toLocaleString("en-US"); }
  function stories(n) { return num(n) + (n === 1 ? " story" : " stories"); }

  function videoCard(a, big) {
    return '<button class="vid' + (big ? " vid--big" : "") + '" data-vid="' + a.id + '">' +
      ph(a) + '<span class="vid__t">' + esc(short(a.t)) + '</span><span class="meta">CES ' + a.y + " · " + day(a) + "</span></button>";
  }
  function row(a) {
    return "<li>" + link(a, ph(a, "ph--row") + "<div>" + kicker(a) + "<h4>" + esc(short(a.t)) + "</h4>" + meta(a) + "</div>") + "</li>";
  }
  function card(a) {
    return '<article class="card">' + link(a, ph(a) + "<div>" + kicker(a) + "</div><h4>" + esc(short(a.t)) + "</h4>" + meta(a)) + "</article>";
  }
  function listItem(a) {
    return "<li>" + link(a, ph(a, "ph--list") + '<div class="list__t"><div>' + kicker(a) + "</div><h3>" + esc(a.t) + "</h3>" +
      (lead(a) ? "<p>" + esc(lead(a)) + "</p>" : "") + meta(a) + "</div>") + "</li>";
  }
  function secHead(key, title, sub, more) {
    var m = menuOf[key] || {};
    return '<div class="sec"><h2>' + esc(title || m.name) + "</h2><span>" + esc(sub || m.desc) + '</span><a class="more" href="#' + (more || key) + '">More →</a></div>';
  }
  function pageHead(title, sub) {
    return '<div class="page__head"><h1>' + esc(title) + "</h1><span>" + esc(sub) + "</span></div>";
  }
  function yearTabs(active) {
    return '<div class="tabs" role="tablist">' + META.years.map(function (o) {
      return '<a role="tab" href="#year-' + o.y + '" class="' + (o.y === active ? "on" : "") + '" aria-selected="' + (o.y === active) + '">' +
        o.y + " <small>" + num(o.n) + "</small></a>";
    }).join("") + "</div>";
  }

  /* 긴 목록: 30개씩 보여 주고 "More stories" 버튼으로 이어서 붙입니다 */
  var pager = null;
  function pagedList(items) {
    pager = { items: items, shown: 0 };
    return '<ul class="list" id="plist"></ul><div class="pager"><button class="pager__btn" id="pmore" hidden>More stories</button></div>';
  }
  function pageMore() {
    if (!pager) return;
    var next = pager.items.slice(pager.shown, pager.shown + PAGE);
    var btn = document.getElementById("pmore");
    btn.disabled = true;
    withLeads(next).then(function () {
      document.getElementById("plist").insertAdjacentHTML("beforeend", next.map(listItem).join(""));
      pager.shown += next.length;
      var left = pager.items.length - pager.shown;
      btn.hidden = left <= 0;
      btn.disabled = false;
      btn.textContent = "More stories (" + num(left) + " left)";
    });
  }

  /* ---------- 홈 (assets/home.css) ----------
   * 히어로(기사 1건 = 사각형 1칸 배경) → 스크롤하면 커지는 대표 영상 → 최근 기사 띠
   * → Latest → Innovation Awards → Video → 연도 막대 → 주제 → 많이 본 기사
   * 화면을 그린 뒤 homeInit() 이 애니메이션(카운트업 · 스크롤 등장 · 배경 격자 등)을 붙입니다. */
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var HP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';

  function hImg(a) {
    var s = thumb(a);
    return '<div class="h-card__img' + (s ? "" : " is-none") + '" data-y="CES ' + a.y + '">' +
      (s ? '<img src="' + esc(s) + '" alt="" loading="lazy" onerror="this.parentNode.classList.add(\'is-none\');this.remove()">' : "") + "</div>";
  }
  function hCard(a, i, big) {
    return '<a class="h-card h-rv' + (big ? " h-card--big" : "") + '" style="--i:' + i + '" href="#article-' + a.id + '">' +
      (has(a, "awards") ? '<span class="h-badge">CES ' + a.y + " Honoree</span>" : "") +
      (a.yt ? '<span class="h-badge h-badge--yt">▶ Video</span>' : "") + hImg(a) +
      '<div class="h-card__body"><span class="h-label h-label--coral">CES ' + a.y + (a.sec ? " · " + esc(a.sec) : "") + "</span>" +
      "<h3>" + esc(short(a.t)) + "</h3>" + (big && lead(a) ? "<p>" + esc(lead(a)) + "</p>" : "") +
      '<div class="h-card__foot"><small>' + esc(a.by) + (a.by ? " · " : "") + day(a) + '</small><span class="h-go" aria-hidden="true">→</span></div></div></a>';
  }
  function home() {
    var ny = newest();
    var vids = IDX.filter(function (a) { return a.yt; });
    var feat = vids.filter(function (a) { return a.img; })[0] || vids[0];          // 대표 영상: 사진이 있는 최신 영상 기사
    var latest = IDX.filter(function (a) { return thumb(a); }).slice(0, 5);
    var aw = IDX.filter(function (a) { return has(a, "awards") && thumb(a) && latest.indexOf(a) < 0; });
    // 많이 본 기사: 최신 연도 (기사가 8건이 안 되면 그 전 연도까지)
    var pool = IDX.filter(function (a) { return a.y === ny; }), mostLabel = "CES " + ny;
    if (pool.length < 8) { pool = IDX.filter(function (a) { return a.y >= ny - 1; }); mostLabel = "CES " + (ny - 1) + "–" + ny; }
    var most = pool.slice().sort(function (a, b) { return b.v - a.v; }).slice(0, 8);
    var yrs = META.years.slice().reverse();
    var max = Math.max.apply(null, yrs.map(function (o) { return o.n; }));
    var topics = [
      { tag: "pavilion", name: "Pavilions", desc: "Seoul, K-Startup, Gyeonggi and the national pavilions bringing Korean tech to Las Vegas." },
      { tag: "unveiled", name: "CES Unveiled", desc: "First looks from the media preview, days before the show opens." },
      { tag: "interview", name: "Interviews", desc: "Founders and organizers, on the record from the show floor." }
    ];
    var ticker = IDX.slice(0, 12).map(function (a) { return '<a href="#article-' + a.id + '"><b>CES ' + a.y + "</b><span>" + esc(short(a.t)) + "</span></a>"; }).join("");

    return withLeads([latest[0]].filter(Boolean)).then(function () {
      return "" +
        // ① 히어로
        '<section class="h-hero" id="hHero">' +
          '<canvas id="hField" aria-hidden="true"></canvas>' +
          '<div class="h-wrap h-hero__in">' +
            '<span class="h-hero__eyebrow h-fade" style="--d:.1s">AVING CES archive · ' + META.years[META.years.length - 1].y + "–" + ny + "</span>" +
            '<h1><span class="ln"><span>' + (ny - META.years[META.years.length - 1].y) + ' years of CES,</span></span><span class="ln"><span><b>on file.</b></span></span></h1>' +
            '<div class="h-hero__row">' +
              '<div class="h-fade" style="--d:.5s">' +
                '<p class="h-hero__lede">Every CES story AVING has covered since ' + META.years[META.years.length - 1].y + ": Innovation Awards, national pavilions, CES Unveiled and on-site interviews, filed edition by edition.</p>" +
                '<div class="h-hero__cta"><a class="h-btn h-btn--coral" href="#year-' + ny + '">Explore CES ' + ny + '</a><button class="h-btn h-btn--line" data-scroll="hRoad">Browse by year</button></div>' +
              "</div>" +
              '<div class="h-stats h-fade" style="--d:.7s">' +
                '<div class="h-stat"><b data-count="' + META.total + '">0</b><span>Stories</span></div>' +
                '<div class="h-stat"><b data-count="' + META.videos + '">0</b><span>Videos</span></div>' +
                '<div class="h-stat"><b data-count="' + META.years.length + '">0</b><span>Editions</span></div>' +
              "</div>" +
            "</div>" +
            '<div class="h-hero__read h-fade" style="--d:.9s" id="hRead"><b>Behind this text</b><span>Each square is one story, oldest at the top left. Point at one to read it.</span></div>' +
          "</div>" +
        "</section>" +

        // 스크롤하면 커지는 대표 영상
        (feat ? '<section class="h-stage" id="hStage" aria-label="Featured video"><div class="h-stage__pin">' +
          '<button class="h-stage__media" id="hStageMedia" data-vid="' + feat.id + '" aria-label="Play video: ' + esc(short(feat.t)) + '">' +
            '<img src="' + esc(thumb(feat)) + '" alt="">' + '<span class="h-stage__frame"></span>' +
            '<span class="h-stage__cap"><span><span class="h-label h-label--coral">Featured video · CES ' + feat.y + "</span><strong class=\"h-stage__t\">" + esc(short(feat.t)) + "</strong></span>" +
            '<span class="h-play">' + HP + "Play video</span></span>" +
          "</button></div></section>" : "") +

        // 최근 기사 띠
        '<div class="h-marquee" aria-label="Recently filed"><div class="h-marquee__track">' + ticker + ticker + "</div></div>" +

        // ② Latest
        '<section class="h-sec"><div class="h-wrap">' +
          '<div class="h-head h-rv"><div><span class="h-label h-label--coral">Latest</span><h2>Fresh from <b>the floor.</b></h2></div>' +
            '<a class="h-btn h-btn--ink" href="#latest">All stories</a></div>' +
          '<div class="h-latest">' + latest.map(function (a, i) { return hCard(a, i, i === 0); }).join("") + "</div>" +
        "</div></section>" +

        // ③ Innovation Awards
        (aw.length ? '<section class="h-sec h-sec--flush"><div class="h-wrap">' +
          '<div class="h-awards-top">' +
            '<div class="h-trophy h-rv" id="hTrophy"><div><span class="h-label">CES Innovation Awards</span><b data-count-on-view="' + META.tags.awards + '">0</b>' +
              "<h3>stories on honorees and Best of Innovation winners</h3></div>" +
              '<a class="h-btn h-btn--coral" href="#tag-awards">See all honorees</a></div>' +
            "<div>" + hCard(aw[0], 1) + "</div>" +
          "</div>" +
          '<div class="h-awards">' + aw.slice(1, 5).map(function (a, i) { return hCard(a, i); }).join("") + "</div>" +
        "</div></section>" : "") +

        // ④ Video
        '<section class="h-sec h-dark"><div class="h-wrap">' +
          '<div class="h-head h-rv"><div><span class="h-label h-label--coral">AVING on YouTube</span><h2>Watch <b>the show.</b></h2>' +
            "<p>" + num(META.videos) + ' videos: demos, booth tours and founder interviews from the show floor. <a href="#video" style="color:var(--h-coral)">See all →</a></p></div>' +
            '<div class="h-rail-ctl"><button class="h-sq" data-rail="-1" aria-label="Previous videos">←</button><button class="h-sq" data-rail="1" aria-label="Next videos">→</button></div></div>' +
          '<div class="h-vrail" id="hRail">' + vids.slice(0, 14).map(function (a) {
            return '<button class="h-vcard" data-vid="' + a.id + '"><span class="h-vcard__img"><img src="https://i.ytimg.com/vi/' + esc(a.yt) + '/hqdefault.jpg" alt="" loading="lazy"><span class="h-vcard__play">' + HP + "</span></span>" +
              "<small>CES " + a.y + " · " + day(a) + '</small><span class="h-vcard__t">' + esc(short(a.t)) + "</span></button>";
          }).join("") + "</div>" +
          '<div class="h-progress"><i id="hProg"></i></div>' +
        "</div></section>" +

        // ⑤ 연도 막대
        '<section class="h-sec" id="hRoad"><div class="h-wrap">' +
          '<div class="h-head h-rv"><div><span class="h-label h-label--coral">By year</span><h2>The road <b>through CES.</b></h2>' +
            "<p>" + META.years.length + " editions on the show floor. Point at a year to see what we filed.</p></div></div>" +
          '<div class="h-road h-rv"><div class="h-road__top"><div class="h-road__sel"><b id="hSelY"></b><span id="hSelN"></span></div><div class="h-road__list" id="hSelList"></div></div>' +
            '<div class="h-bars" id="hBars" style="--n:' + yrs.length + '">' + yrs.map(function (o, i) {
              var h = Math.max(4, Math.sqrt(o.n / max) * 100);   // 2011(1,186건)만 너무 튀지 않게 제곱근 비율
              return '<a class="h-bar" href="#year-' + o.y + '" data-y="' + o.y + '" style="--h:' + h.toFixed(1) + "%;--i:" + i + '" aria-label="CES ' + o.y + ", " + stories(o.n) + '"><em>' + num(o.n) + "</em><i></i><small>'" + String(o.y).slice(2) + "</small></a>";
            }).join("") + "</div>" +
          "</div>" +
        "</div></section>" +

        // ⑥ 주제
        '<section class="h-sec h-sec--flush"><div class="h-wrap">' +
          '<div class="h-head h-rv"><div><span class="h-label h-label--coral">By topic</span><h2>Pick <b>a lane.</b></h2></div></div>' +
          '<div class="h-explore">' + topics.map(function (t, i) {
            var a = IDX.filter(function (b) { return has(b, t.tag) && b.img; })[0];
            return '<a class="h-xcard h-rv" style="--i:' + i + '" href="#tag-' + t.tag + '">' + (a ? '<img src="' + esc(thumb(a)) + '" alt="" loading="lazy">' : "") +
              '<span class="h-label">' + stories(META.tags[t.tag] || 0) + "</span><h3>" + t.name + "</h3><p>" + t.desc + '</p><span class="h-row"><span class="h-go" aria-hidden="true">→</span></span></a>';
          }).join("") + "</div>" +
        "</div></section>" +

        // ⑦ 많이 본 기사
        '<section class="h-sec h-sec--flush"><div class="h-wrap">' +
          '<div class="h-head h-rv"><div><span class="h-label h-label--coral">' + mostLabel + ' · by views</span><h2>Most <b>read.</b></h2></div></div>' +
          '<ol class="h-most">' + most.map(function (a, i) {
            return '<li><a class="h-rv" style="--i:' + (i % 4) + '" href="#article-' + a.id + '"><i>' + (i + 1) + "</i><div><h3>" + esc(short(a.t)) + "</h3><small>CES " + a.y + " · " + num(a.v) + ' views</small></div><span class="h-go" aria-hidden="true">→</span></a></li>';
          }).join("") + "</ol>" +
        "</div></section>";
    });
  }

  /* 홈을 그린 뒤 붙이는 움직임 */
  function homeInit() {
    // 스크롤 등장 + 들어올 때 숫자 올리기
    var els = document.querySelectorAll(".h-rv:not(.is-in)");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-in"); });
      document.querySelectorAll("[data-count-on-view]").forEach(function (el) { el.textContent = num(+el.getAttribute("data-count-on-view")); });
    } else {
      var io = new IntersectionObserver(function (ents) {
        ents.forEach(function (en) {
          if (!en.isIntersecting) return;
          en.target.classList.add("is-in"); io.unobserve(en.target);
          var c = en.target.querySelector("[data-count-on-view]");
          if (c) countTo(c, +c.getAttribute("data-count-on-view"), 1400);
        });
      }, { threshold: .15, rootMargin: "0px 0px -40px 0px" });
      els.forEach(function (el) { io.observe(el); });
    }
    // 히어로 숫자
    setTimeout(function () {
      document.querySelectorAll("[data-count]").forEach(function (el) { countTo(el, +el.getAttribute("data-count"), 1800); });
    }, reduceMotion ? 0 : 700);
    // 연도 막대: 처음엔 기사가 충분히 쌓인 가장 최근 행사
    selectYear((META.years.filter(function (o) { return o.n >= 30; })[0] || META.years[0]).y);
    heroField();
    onHomeScroll();
  }
  function countTo(el, to, ms) {
    if (reduceMotion) { el.textContent = num(to); return; }
    var t0 = performance.now();
    requestAnimationFrame(function step(t) {
      var p = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - p, 4);
      el.textContent = num(Math.round(to * e));
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    });
  }
  function selectYear(y) {
    var o = META.years.filter(function (x) { return x.y === y; })[0], sel = document.getElementById("hSelY");
    if (!o || !sel) return;
    sel.textContent = "CES " + y;
    document.getElementById("hSelN").textContent = stories(o.n) + (o.v ? " · " + o.v + " videos" : "");
    document.getElementById("hSelList").innerHTML = IDX.filter(function (a) { return a.y === y; }).slice(0, 3).map(function (a) {
      return '<a href="#article-' + a.id + '"><span>' + esc(short(a.t)) + "</span></a>";
    }).join("");
    document.querySelectorAll(".h-bar").forEach(function (b) { b.classList.toggle("is-on", +b.getAttribute("data-y") === y); });
  }

  /* 히어로 배경: 기사 1건 = 사각형 1칸 (오래된 기사부터). 밝기 물결이 천천히 지나가고, 가리키면 제목이 보임 */
  function heroField() {
    var cv = document.getElementById("hField"), hero = document.getElementById("hHero"), read = document.getElementById("hRead");
    if (!cv) return;
    var ctx = cv.getContext("2d");
    var items = IDX.slice().sort(function (a, b) { return a.y - b.y || (a.d < b.d ? -1 : 1); });
    var N = items.length, W, H, P, S, cols, cells, off, mx = -999, my = -999, hoverK = -1, run = true, last = 0;
    var idle = read.innerHTML;

    function layout() {
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.offsetWidth; H = cv.offsetHeight;
      P = W < 760 ? 10 : 14; S = P - 3;
      cols = Math.ceil(W / P); cells = cols * Math.ceil(H / P);
      off = Math.max(0, N - cells);                  // 칸이 모자라면(모바일) 최신 기사 쪽을 보여 줌
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw(t) {
      if (!cv.isConnected) return;                   // 다른 화면으로 가면 멈춤
      if (!run) return;
      if (!reduceMotion) requestAnimationFrame(draw);
      if (t - last < 33) return;                     // 30fps 면 충분
      last = t;
      var s = reduceMotion ? 0 : t * .0006;
      ctx.clearRect(0, 0, W, H);
      for (var c = 0; c < cells; c++) {
        var k = c + off; if (k >= N) break;
        var a = items[k], x = (c % cols) * P, y = Math.floor(c / cols) * P;
        var wave = .5 + .5 * Math.sin(x * .008 - y * .006 + s * 2.2);            // 대각선으로 지나가는 밝기 물결
        var mask = W < 760 ? .45 : .25 + .75 * Math.min(1, x / W * 1.5);          // 글자 쪽(왼쪽)은 옅게, 모바일은 전체를 옅게
        var near = Math.max(0, 1 - Math.hypot(x - mx, y - my) / 140);
        var al = (.06 + wave * .1) * mask + near * .5;
        ctx.fillStyle = k === hoverK ? "#fff" :
          has(a, "awards") ? "rgba(232,176,35," + Math.min(1, al * 3.2) + ")" :
          a.yt ? "rgba(237,56,64," + Math.min(1, al * 2.6) + ")" : "rgba(243,242,239," + al + ")";
        ctx.fillRect(x, y, S, S);
      }
    }
    function at(e) {
      var b = cv.getBoundingClientRect(), c = Math.floor((e.clientX - b.left) / P), r = Math.floor((e.clientY - b.top) / P), k = r * cols + c + off;
      return c >= 0 && c < cols && r >= 0 && k < N ? k : -1;
    }
    layout();
    cv._layout = layout;
    hero.addEventListener("pointermove", function (e) {
      var b = cv.getBoundingClientRect(); mx = e.clientX - b.left; my = e.clientY - b.top;
      var k = e.target.closest("a, button") ? -1 : at(e);
      if (k === hoverK) return;
      hoverK = k;
      hero.style.cursor = k > -1 ? "pointer" : "";
      if (k < 0) read.innerHTML = idle;
      else {
        var a = items[k];
        read.innerHTML = "<b>CES " + a.y + "</b><span><strong>" + esc(short(a.t)) + "</strong> · " + day(a) + " · story " + num(k + 1) + " of " + num(N) + "</span>";
      }
      if (reduceMotion) draw(0);
    });
    hero.addEventListener("pointerleave", function () { mx = my = -999; hoverK = -1; hero.style.cursor = ""; read.innerHTML = idle; if (reduceMotion) draw(0); });
    hero.addEventListener("click", function (e) {
      if (e.target.closest("a, button")) return;
      var k = at(e); if (k > -1) location.hash = "article-" + items[k].id;
    });
    if ("IntersectionObserver" in window && !reduceMotion) {
      new IntersectionObserver(function (en) { var was = run; run = en[0].isIntersecting; if (run && !was) requestAnimationFrame(draw); }).observe(cv);
    }
    requestAnimationFrame(draw);
  }

  /* 스크롤: 헤더 얇게 · 대표 영상 키우기 (홈이 아닐 때는 요소가 없어서 그냥 지나감) */
  var hHd = document.getElementById("hHd"), scrollTick = false;
  function onHomeScroll() {
    if (scrollTick) return; scrollTick = true;
    requestAnimationFrame(function () {
      scrollTick = false;
      hHd.classList.toggle("is-scrolled", window.scrollY > 40);
      var stage = document.getElementById("hStage");
      if (!stage) return;
      var r = stage.getBoundingClientRect();
      var p = Math.min(1, Math.max(0, -r.top / (r.height - window.innerHeight)));
      document.getElementById("hStageMedia").style.setProperty("--p", reduceMotion ? 1 : p.toFixed(4));
    });
  }
  window.addEventListener("scroll", onHomeScroll, { passive: true });
  window.addEventListener("resize", function () {
    var cv = document.getElementById("hField");
    if (cv && cv._layout) cv._layout();
    onHomeScroll();
  });

  /* 홈의 클릭: 연도 막대 · 영상 레일 화살표 · 섹션으로 스크롤 */
  document.addEventListener("mouseover", function (e) {
    var b = e.target.closest && e.target.closest(".h-bar"); if (b) selectYear(+b.getAttribute("data-y"));
  });
  document.addEventListener("focusin", function (e) {
    var b = e.target.closest && e.target.closest(".h-bar"); if (b) selectYear(+b.getAttribute("data-y"));
  });
  document.addEventListener("click", function (e) {
    var r = e.target.closest("[data-rail]");
    if (r) {
      var rail = document.getElementById("hRail"), card = rail.querySelector(".h-vcard");
      rail.scrollBy({ left: +r.getAttribute("data-rail") * (card ? card.offsetWidth + 24 : 300) * 2, behavior: reduceMotion ? "auto" : "smooth" });
      return;
    }
    var s = e.target.closest("[data-scroll]");
    if (s) { var t = document.getElementById(s.getAttribute("data-scroll")); if (t) t.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" }); }
  });
  document.addEventListener("scroll", function (e) {
    if (!e.target || e.target.id !== "hRail") return;
    var rail = e.target, max = rail.scrollWidth - rail.clientWidth;
    document.getElementById("hProg").style.transform = "translateX(" + (max ? rail.scrollLeft / max * 400 : 0) + "%)";
  }, true);

  /* 홈 헤더: 검색 · 모바일 메뉴 */
  function toggleDrop(btnId, panelId, focusId) {
    var btn = document.getElementById(btnId), panel = document.getElementById(panelId);
    btn.addEventListener("click", function () {
      var open = !panel.classList.contains("is-open");
      document.querySelectorAll(".h-drop.is-open").forEach(function (p) { p.classList.remove("is-open"); });
      document.querySelectorAll("#hSrchBtn, #hMenuBtn").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
      panel.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open);
      if (open && focusId) setTimeout(function () { document.getElementById(focusId).focus(); }, 150);
    });
  }
  toggleDrop("hSrchBtn", "hSrch", "hq");
  toggleDrop("hMenuBtn", "hMenu");
  function closeDrops() {
    document.querySelectorAll(".h-drop.is-open").forEach(function (p) { p.classList.remove("is-open"); });
    document.querySelectorAll("#hSrchBtn, #hMenuBtn").forEach(function (b) { b.setAttribute("aria-expanded", "false"); });
  }
  document.getElementById("hSrchForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = document.getElementById("hq").value.trim();
    if (q) { closeDrops(); location.hash = "search-" + encodeURIComponent(q); }
  });
  document.getElementById("hMenu").addEventListener("click", function (e) { if (e.target.closest("a")) closeDrops(); });

  /* ---------- 목록 화면 ---------- */
  function latestPage() {
    return '<div class="page">' + pageHead("Latest", stories(IDX.length) + ", newest first") + pagedList(IDX) + "</div>";
  }
  function videoPage(y) {
    var list = IDX.filter(function (a) { return a.yt && (!y || a.y === y); });
    var chips = '<div class="tabs"><a href="#video" class="' + (y ? "" : "on") + '">All <small>' + num(META.videos) + "</small></a>" +
      META.years.filter(function (o) { return o.v; }).map(function (o) {
        return '<a href="#video-' + o.y + '" class="' + (o.y === y ? "on" : "") + '">' + o.y + " <small>" + o.v + "</small></a>";
      }).join("") + "</div>";
    vpager = { items: list, shown: 0 };
    return '<div class="page">' + pageHead("Video", num(list.length) + " videos" + (y ? " from CES " + y : "") + " · AVING on YouTube") + chips +
      '<div class="vgrid" id="vgrid"></div><div class="pager"><button class="pager__btn" id="vmore" hidden>More videos</button></div></div>';
  }
  var vpager = null;
  function videoMore() {
    if (!vpager) return;
    var next = vpager.items.slice(vpager.shown, vpager.shown + 24);
    document.getElementById("vgrid").insertAdjacentHTML("beforeend", next.map(function (a) { return videoCard(a); }).join(""));
    vpager.shown += next.length;
    var left = vpager.items.length - vpager.shown, btn = document.getElementById("vmore");
    btn.hidden = left <= 0;
    btn.textContent = "More videos (" + num(left) + " left)";
  }
  function yearPage(y) {
    var ya = IDX.filter(function (a) { return a.y === y; });
    return '<div class="page">' + pageHead("CES " + y, stories(ya.length) + " · filed by CES edition, not publish date") +
      yearTabs(y) + (ya.length ? pagedList(ya) : '<p class="empty">Nothing for ' + y + " yet.</p>") + "</div>";
  }
  function tagPage(tag) {
    var m = menuOf["tag-" + tag] || { name: tag, desc: "" };
    var list = IDX.filter(function (a) { return has(a, tag); });
    var years = META.years.filter(function (o) { return list.some(function (a) { return a.y === o.y; }); });
    var chips = '<div class="tabs">' + years.map(function (o) {
      var n = list.filter(function (a) { return a.y === o.y; }).length;
      return '<a href="#tag-' + tag + '" data-jump="' + o.y + '">CES ' + o.y + " <small>" + n + "</small></a>";
    }).join("") + "</div>";
    return '<div class="page">' + pageHead(m.name, stories(list.length) + " · " + m.desc) + chips + pagedList(list) + "</div>";
  }
  function searchPage(q) {
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    var res = IDX.filter(function (a) {
      var t = (a.t + " " + a.by).toLowerCase();
      return words.every(function (w) { return t.indexOf(w) > -1; });
    });
    return '<div class="page">' + pageHead("Search: " + q, stories(res.length) + " · titles and bylines") +
      (res.length ? pagedList(res) : '<p class="empty">No matches. Try a company name, “Seoul Pavilion” or “Innovation Award”.</p>') + "</div>";
  }

  /* ---------- 기사 상세 ---------- */
  function block(b) {
    if (b.t === "p") return "<p>" + esc(b.x) + "</p>";
    if (b.t === "h") return "<h2>" + esc(b.x) + "</h2>";
    if (b.t === "img") return '<figure><img src="' + esc(src(b.src)) + '" alt="' + esc(b.cap) + '" loading="lazy" onerror="this.parentNode.remove()">' +
      (b.cap ? "<figcaption>" + esc(b.cap) + "</figcaption>" : "") + "</figure>";
    if (b.t === "yt") return '<div class="art__ytframe"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(b.id) +
      '?rel=0" title="Video" allow="encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe></div>';
    return "";
  }
  function sameStart(text, blocks) {
    var first = blocks.filter(function (x) { return x.t === "p"; })[0];
    if (!first) return false;
    var norm = function (t) { return t.replace(/[\s…]+/g, " ").trim().slice(0, 60).toLowerCase(); };
    return norm(first.x).indexOf(norm(text).slice(0, 40)) === 0;
  }
  /* 검색 엔진용: 기사 화면에서는 원문(us.aving.net)을 대표 주소(canonical)로 알려 중복 콘텐츠로 보지 않게 함 */
  var SITE = "https://avingces.news/";
  function setPageMeta(a) {
    var link = document.querySelector('link[rel="canonical"]');
    if (link) link.href = a ? AVING + a.id : SITE;
    document.title = a ? a.t + " · AVING CES" : "AVING CES · CES Issue Discovery Hub";
  }
  function articlePage(id) {
    var a = byId[id];
    if (!a) return Promise.resolve('<div class="page"><p class="empty">This story could not be found. <a href="#latest">See the latest stories →</a></p></div>');
    // 관련 기사: 같은 연도 + 같은 태그 → 같은 연도
    var others = IDX.filter(function (x) { return x !== a && x.y === a.y; });
    var sameTag = others.filter(function (x) { return x.tags.some(function (t) { return has(a, t); }); });
    var rel = sameTag.concat(others.filter(function (x) { return sameTag.indexOf(x) < 0; })).slice(0, 5);
    var bodyP = BODY[id] ? Promise.resolve(BODY[id]) :
      getJSON("data/body/" + id + ".json").then(function (j) { return (BODY[id] = j.body || []); }).catch(function () { return []; });

    return Promise.all([withLeads([a]), bodyP]).then(function (r) {
      // 맨 위에 영상 플레이어를 보여 주므로, 본문 속 같은 영상은 빼서 두 번 나오지 않게 함
      var b = r[1].filter(function (x) { return !(x.t === "yt" && x.id === a.yt); });
      var hasImg = b.some(function (x) { return x.t === "img"; });
      var crumbs = ['<a href="#year-' + a.y + '">CES ' + a.y + "</a>"].concat(a.tags.map(function (t) {
        return '<a href="#tag-' + t + '">' + esc(TAG_NAME[t]) + "</a>";
      }));
      var body = b.length ? b.map(block).join("") :
        (lead(a) ? "<p>" + esc(lead(a)) + "</p>" : "") +
        '<p class="art__cta"><a href="' + AVING + a.id + '" target="_blank" rel="noopener">Read the full story on AVING USA ↗</a></p>';
      return '<div class="art">' +
        '<article class="art__main">' +
          '<nav class="crumbs" aria-label="Categories">' + crumbs.join('<span aria-hidden="true">/</span>') + "</nav>" +
          "<h1>" + esc(a.t) + "</h1>" +
          // 요약이 본문 첫 문단과 같으면(대부분 그렇습니다) 두 번 보이지 않게 생략
          (b.length && lead(a) && !sameStart(lead(a), b) ? '<p class="art__dek">' + esc(lead(a)) + "</p>" : "") +
          '<div class="art__meta"><span>' + esc(a.by) + (a.by ? " · " : "") + day(a) + " " + esc(a.d.slice(11, 16)) + "</span>" +
            (a.v ? "<span>" + num(a.v) + " views</span>" : "") + (a.sec ? "<span>" + esc(a.sec) + "</span>" : "") +
            '<a href="' + AVING + a.id + '" target="_blank" rel="noopener">Original on AVING USA ↗</a></div>' +
          (a.yt ? '<div class="art__ytframe art__video"><iframe src="https://www.youtube-nocookie.com/embed/' + esc(a.yt) +
            '?rel=0" title="' + esc(a.t) + '" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>'
            : hasImg ? "" : "<figure>" + ph(a) + "</figure>") +
          '<div class="art__body">' + body + "</div>" +
          '<p class="art__src">This story was first published by <a href="' + AVING + a.id + '" target="_blank" rel="noopener">AVING USA</a>.</p>' +
          '<a class="art__back" href="#year-' + a.y + '">← All CES ' + a.y + " stories</a>" +
        "</article>" +
        '<aside class="side">' +
          '<div class="side__box"><h2 class="side__h">More from CES ' + a.y + '</h2><ul class="rows">' + rel.map(row).join("") + "</ul></div>" +
        "</aside></div>";
    });
  }

  /* ---------- 메뉴 ---------- */
  function renderNav() {
    var html = MENU.map(function (m) {
      var href = m.key === "year" ? "year-" + newest() : m.key;
      return '<a href="#' + href + '" data-key="' + m.key + '">' + esc(m.name) + "</a>";
    }).join("");
    document.getElementById("gnb").innerHTML = html;
    document.getElementById("footNav").innerHTML = html;
    document.getElementById("hNav").innerHTML = html;
    document.getElementById("hMenuNav").innerHTML = html;
    document.getElementById("hFootNav").innerHTML = MENU.map(function (m) {
      return '<li><a href="#' + (m.key === "year" ? "year-" + newest() : m.key) + '">' + esc(m.name) + "</a></li>";
    }).join("");
  }
  function markNav(key) {
    document.querySelectorAll("#gnb a").forEach(function (a) {
      var on = a.getAttribute("data-key") === key;
      a.classList.toggle("on", on);
      if (on) { a.setAttribute("aria-current", "page"); a.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      else a.removeAttribute("aria-current");
    });
  }

  /* ---------- 라우터 ---------- */
  var seq = 0;
  function route() {
    var h = decodeURIComponent(location.hash.replace(/^#/, ""));
    var i = h.indexOf("-"), base = i < 0 ? h : h.slice(0, i), arg = i < 0 ? "" : h.slice(i + 1);
    var key = base, out;
    pager = null; vpager = null;
    if (!h) { out = home(); key = ""; }
    else if (base === "latest") out = latestPage();
    else if (base === "video") { var vy = parseInt(arg, 10); out = videoPage(META.years.some(function (o) { return o.y === vy; }) ? vy : null); }
    else if (base === "year") {
      var y = parseInt(arg, 10);
      out = yearPage(META.years.some(function (o) { return o.y === y; }) ? y : newest());
    }
    else if (base === "tag" && TAG_NAME[arg]) { out = tagPage(arg); key = "tag-" + arg; }
    else if (base === "article") { out = articlePage(parseInt(arg, 10)); key = null; }
    else if (base === "search") { document.getElementById("q").value = arg; out = searchPage(arg); key = null; }
    else { out = home(); key = ""; }

    var my = ++seq;
    Promise.resolve(out).then(function (html) {
      if (my !== seq) return;            // 그 사이 다른 화면으로 이동했으면 무시
      document.documentElement.classList.toggle("is-home", key === "");   // 홈이면 새 헤더/푸터 (assets/home.css)
      app.innerHTML = html;
      setPageMeta(base === "article" ? byId[parseInt(arg, 10)] : null);
      markNav(key);
      window.scrollTo(0, 0);
      if (key === "") homeInit();
      if (pager) pageMore();
      if (vpager) videoMore();
    });
  }

  /* 태그 화면의 연도 칩: 그 연도 첫 기사까지 목록을 펼친 뒤 스크롤 */
  document.addEventListener("click", function (e) {
    var more = e.target.closest("#pmore");
    if (more) { pageMore(); return; }
    if (e.target.closest("#vmore")) { videoMore(); return; }
    var v = e.target.closest("[data-vid]");
    if (v) { e.preventDefault(); openVideo(+v.getAttribute("data-vid")); return; }
    if (e.target === modal || e.target.id === "modalClose") { closeVideo(); return; }
    var j = e.target.closest("[data-jump]");
    if (j && pager) {
      e.preventDefault();
      var y = +j.getAttribute("data-jump");
      var at = pager.items.findIndex(function (a) { return a.y === y; });
      (function grow() {
        if (pager.shown > at) {
          var el = document.querySelectorAll("#plist > li")[at];
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          return;
        }
        var next = pager.items.slice(pager.shown, pager.shown + PAGE);
        withLeads(next).then(function () {
          document.getElementById("plist").insertAdjacentHTML("beforeend", next.map(listItem).join(""));
          pager.shown += next.length;
          var left = pager.items.length - pager.shown, btn = document.getElementById("pmore");
          btn.hidden = left <= 0; btn.textContent = "More stories (" + num(left) + " left)";
          grow();
        });
      })();
    }
  });

  /* ---------- 영상 팝업 (GIF 와 같은 방식) ---------- */
  var modal = document.getElementById("modal"), lastFocus = null;
  function openVideo(id) {
    var a = byId[id];
    if (!a || !a.yt) return;
    lastFocus = document.activeElement;
    document.getElementById("player").innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + a.yt +
      '?autoplay=1&rel=0" title="' + esc(a.t) + '" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>';
    document.getElementById("modalTitle").textContent = a.t;
    document.getElementById("modalStory").href = "#article-" + a.id;
    document.getElementById("modalLink").href = "https://www.youtube.com/watch?v=" + a.yt;
    modal.hidden = false;
    document.getElementById("modalClose").focus();
  }
  function closeVideo() {
    modal.hidden = true;
    document.getElementById("player").innerHTML = "";
    if (lastFocus) lastFocus.focus();
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modal.hidden) closeVideo(); });
  document.getElementById("modalStory").addEventListener("click", closeVideo);

  /* ---------- 검색 ---------- */
  document.getElementById("searchForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var q = document.getElementById("q").value.trim();
    location.hash = q ? "search-" + encodeURIComponent(q) : "";
  });

  /* ---------- 시작 ---------- */
  document.getElementById("today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  Promise.all([getJSON("data/meta.json"), getJSON("data/search.json")]).then(function (r) {
    META = r[0];
    // [id, 제목, 날짜, 연도, 썸네일, 기자, 태그] → 객체로
    IDX = r[1].map(function (x) { return { id: x[0], t: x[1], d: x[2], y: x[3], img: x[4], by: x[5], tags: x[6] || [], yt: x[7] || "", v: x[8] || 0, sec: x[9] || "" }; });
    IDX.forEach(function (a) { byId[a.id] = a; });
    document.getElementById("updated").textContent = META.updated;
    document.getElementById("hUpdated").textContent = META.updated;
    // 푸터 로고 아래 줄: 데이터 기준으로 (예: 2006–2027 · 5,097 CES stories · 21 years of coverage)
    var y0 = META.years[META.years.length - 1].y;
    document.getElementById("hFacts").innerHTML = [y0 + "–" + newest(), num(META.total) + " CES stories", (newest() - y0) + ' years<span class="h-ft__long"> of coverage</span>']
      .map(function (t) { return "<span>" + t + "</span>"; }).join(" · ");   // 항목 단위로만 줄바꿈
    renderNav();
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (err) {
    app.innerHTML = '<div class="page"><p class="empty">Could not load the story data (' + esc(err.message) + ').<br>' +
      "If you opened index.html by double-clicking, open it through a local web server instead (see README).</p></div>";
  });
})();

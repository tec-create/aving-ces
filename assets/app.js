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

  /* ---------- 홈 ---------- */
  function home() {
    // 톱기사: 최신 10건 중 사진(또는 영상 썸네일)이 있는 첫 기사
    var top = IDX.slice(0, 10).filter(function (a) { return thumb(a); })[0] || IDX[0];
    var heads = IDX.filter(function (a) { return a !== top; }).slice(0, 4);
    var vids = IDX.filter(function (a) { return a.yt; });
    // 많이 본 기사: 최신 연도에서 조회수 순
    var mostRead = IDX.filter(function (a) { return a.y === newest(); }).sort(function (a, b) { return b.v - a.v; }).slice(0, 8);
    var ny = newest();
    // 띠: 가장 최근 연도의 Innovation Awards 기사 (없으면 그 전 연도)
    var awardYear = META.years.map(function (o) { return o.y; }).filter(function (y) {
      return IDX.some(function (a) { return a.y === y && has(a, "awards"); });
    })[0];
    var awards = IDX.filter(function (a) { return a.y === awardYear && has(a, "awards"); });
    var pav = IDX.filter(function (a) { return has(a, "pavilion"); });
    var unv = IDX.filter(function (a) { return has(a, "unveiled"); });
    var itv = IDX.filter(function (a) { return has(a, "interview"); });

    return withLeads([top, pav[0]].filter(Boolean)).then(function () {
      return "" +
        '<section class="lead">' +
          '<article class="lead__top">' +
            link(top, ph(top) + '<div class="lead__txt"><div>' + kicker(top) + "</div><h1>" + esc(top.t) + "</h1>" +
              (lead(top) ? "<p>" + esc(lead(top)) + "</p>" : "") + meta(top) + "</div>") +
          "</article>" +
          '<div class="lead__side"><div class="lead__h"><h2>Latest</h2><a class="more" href="#latest">All →</a></div>' +
          '<ol class="lead__list">' + heads.map(function (a) {
            return "<li>" + link(a, '<div class="lead__li-t"><div>' + kicker(a) + "</div><h3>" + esc(short(a.t)) + "</h3>" + meta(a) + "</div>" + ph(a, "ph--sq")) + "</li>";
          }).join("") + "</ol></div>" +
        "</section>" +

        // 띠: 영상 (GIF 의 Spotlight Video 와 같은 구성)
        (vids.length ? '<section class="band">' +
          '<div class="band__head"><h2>Video</h2><span>AVING at CES on YouTube</span>' +
            '<a href="#video" class="more">All ' + num(META.videos) + " videos →</a></div>" +
          '<div class="band__grid">' + videoCard(vids[0], true) +
            '<div class="band__small">' + vids.slice(1, 5).map(function (a) { return videoCard(a); }).join("") + "</div>" +
          "</div>" +
        "</section>" : "") +

        '<div class="cols"><div class="cols__main">' +
          // Innovation Awards
          (awards.length ? secHead("tag-awards", "CES " + awardYear + " Innovation Awards") +
            '<div class="cards">' + awards.slice(0, 3).map(card).join("") + "</div>" : "") +

          // Pavilions
          (pav.length ? secHead("tag-pavilion") +
          '<div class="feat">' +
            '<article class="feat__big">' + link(pav[0], ph(pav[0]) + "<div>" + kicker(pav[0]) + "</div><h3>" + esc(pav[0].t) + "</h3>" +
              (lead(pav[0]) ? "<p>" + esc(lead(pav[0])) + "</p>" : "") + meta(pav[0])) + "</article>" +
            '<ul class="rows">' + pav.slice(1, 5).map(row).join("") + "</ul>" +
          "</div>" : "") +

          // CES Unveiled
          (unv.length ? secHead("tag-unveiled") + '<div class="cards">' + unv.slice(0, 3).map(card).join("") + "</div>" : "") +

          // Interviews
          (itv.length ? secHead("tag-interview") + '<div class="cards">' + itv.slice(0, 3).map(card).join("") + "</div>" : "") +

          // News by Year
          secHead("year", null, null, "year-" + ny) +
          '<div class="years">' + META.years.slice(0, 6).map(function (o) {
            var ya = IDX.filter(function (a) { return a.y === o.y; });
            return '<div class="years__col"><a class="years__y" href="#year-' + o.y + '"><b>CES ' + o.y + "</b><span>" + stories(o.n) + "</span></a>" +
              '<ul class="years__list">' + ya.slice(0, 3).map(function (a) { return "<li>" + link(a, esc(short(a.t))) + "</li>"; }).join("") + "</ul></div>";
          }).join("") + "</div>" +
        "</div>" +

        '<aside class="side">' +
          '<div class="side__box"><h2 class="side__h">Most Read · CES ' + newest() + '</h2><ol class="rank">' +
            mostRead.map(function (a) { return "<li>" + link(a, "<span>" + esc(short(a.t)) + "</span>") + "</li>"; }).join("") +
          "</ol></div>" +
          '<div class="side__box"><h2 class="side__h">Browse by Edition</h2><ul class="yearlist">' +
            META.years.map(function (o) { return '<li><a href="#year-' + o.y + '"><span>CES ' + o.y + "</span><b>" + num(o.n) + "</b></a></li>"; }).join("") +
          "</ul></div>" +
          '<div class="side__box side__about"><h2 class="side__h">About this archive</h2>' +
            "<p>AVING has covered CES in Las Vegas every year since 2006, from CES Unveiled to the Innovation Awards and the national pavilions. This archive gathers " + num(META.total) + " of those stories from CES " + META.years[META.years.length - 1].y + " to CES " + newest() + ", filed by edition.</p>" +
            '<a href="https://us.aving.net" target="_blank" rel="noopener" class="more">Visit AVING USA ↗</a></div>' +
        "</aside></div>";
    });
  }

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
      var b = r[1];
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
          (b.length && lead(a) ? '<p class="art__dek">' + esc(lead(a)) + "</p>" : "") +
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
      app.innerHTML = html;
      markNav(key);
      window.scrollTo(0, 0);
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
    renderNav();
    window.addEventListener("hashchange", route);
    route();
  }).catch(function (err) {
    app.innerHTML = '<div class="page"><p class="empty">Could not load the story data (' + esc(err.message) + ').<br>' +
      "If you opened index.html by double-clicking, open it through a local web server instead (see README).</p></div>";
  });
})();

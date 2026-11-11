/* mtchart.v1.js — 종목 일봉 차트 표시 모듈.
   호출: MTChart.mount(요소, { market: 'US'|'KR', ticker: 'AEHR', markers: [{ date: '2026-08-13', side: 'buy'|'sell' }], pivot: 116.97, range: 'y1' })
     - 요소가 화면에 들어올 때(접힌 칸이면 펼쳐져 보일 때) 처음 데이터를 받는다. 같은 종목을 다시 열면 받아 둔 데이터를 쓴다(재요청 0).
     - markers 는 date·side 두 값만 읽는다(다른 값은 무시). 매수 ▲(봉 아래)·매도 ▼(봉 위).
     - pivot(선택) = 양수 가격(숫자 또는 숫자 글자). 주어지면 그 가격에 가로 점선 + 차트 안 왼쪽 끝, 선 바로 위에 작은 글씨 「피벗 <값>」
       (가격 축 라벨·선 제목 없음). 글씨는 확대·이동·일/주 전환·크기 변화 때 선을 따라가고, 선이 화면 밖이면 숨는다.
       글씨가 왼쪽 위 범례 줄에 닿으면 선 바로 아래로 내려 쓴다.
       최근 1년 일봉 종가의 최댓값 3배 초과 또는 최솟값 1/3 미만이면 표시하지 않는다(PIV_HI·PIV_LO).
     - range = 처음 보이는 구간 m1·m3·m6·y1·y3·all (기본 y1). 화면에 기간 단추는 없다 — 손가락·휠로 확대·이동.
   데이터: <이 파일 위치>/../data/<시장>/<티커>.json = { schema: 2, t: [YYYYMMDD…], o, h, l, c, v, last_bar_date }
     데이터가 없거나(404·목록 _missing) 연속성이 의심되는 종목(목록 _suspect)은 「차트 데이터 없음」 한 줄만 표시한다.
   라이브러리: TradingView Lightweight Charts™ 5.2.1 (Apache-2.0, 버전 고정 CDN + SRI). 못 불러오면 차트 자리에만 안내 문구.
   화면: 봉 + 거래량 막대(아래) + 단순이동평균 50·150·200일 상시 표시. 일봉/주봉 전환 1개 — 주봉(월요일 시작 주)은 10·30·40주선.
     이동평균은 받은 봉 전체로 계산한다 — 화면 왼쪽 끝부터 선이 그려진다(봉이 모자라면 계산되는 구간만).
     차트 안 왼쪽 위에 색 점 + 기간 숫자 1줄(일봉 「50 150 200」 · 주봉 「10 30 40」). 십자선 날짜·가격은 축 라벨(라이브러리 기본).
     출처: 차트 안 TradingView 로고(링크) + 차트 아래 NOTICE 문구 1줄(라이선스 요건 — 로고는 링크 요건만 충족).
   색: 호스트 페이지 글자색·배경 밝기를 읽어 맞춘다(배경 판정 = bgDark 한 함수). 상승·하락 색은 CSS 변수로 바꿀 수 있다
     --mtc-up·--mtc-dn(두 시장 공통) 또는 --mtc-us-up·--mtc-us-dn·--mtc-kr-up·--mtc-kr-dn, 이동평균 --mtc-ma50·--mtc-ma150·--mtc-ma200.
     기본값: 미국 상승 초록·하락 빨강, 한국 상승 빨강·하락 파랑. 200일선(주봉 40주선)은 밝은 배경 검정 계열·어두운 배경 흰색 계열
     (범례 점도 같은 색).
   가격 표시(축·십자선): 미국 = 1 이상 소수 2자리(쉼표), 1 미만 유효숫자 3자리 / 한국 = 원 단위 정수(쉼표). */
(function () {
  'use strict';
  if (window.MTChart) return;
  var LIB = 'https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js';
  var SRI = 'sha384-KkYqTZlM13Zya6fVUF3IGCBOQ1ehFeJVVgxaVvD/0MebineF9EI8Jkd3NnWNChqN';
  var ME = document.currentScript && document.currentScript.src;
  var ROOT = ME ? new URL('../', ME).href : '';
  var DATA = ROOT + 'data/';
  var RANGES = { m1: 1, m3: 3, m6: 6, y1: 12, y3: 36, all: 0 };
  // 이동평균: d = 일봉 기간, w = 주봉 기간
  var MA = [{ k: '50', d: 50, w: 10, lw: 1 }, { k: '150', d: 150, w: 30, lw: 2 }, { k: '200', d: 200, w: 40, lw: 2 }];
  var PIV_HI = 3, PIV_LO = 1 / 3;                         // 피벗 허용 범위 = 최근 1년 종가 [최솟값 × 1/3, 최댓값 × 3]
  var PAL = {   // 이동평균 = 밝은/어두운 판 각각 판별 검사 통과 단계, 봉 = 시장 관행
    light: { ma: { '50': '#eb6834', '150': '#6250d6', '200': '#222222' },
             US: ['#16a34a', '#dc2626'], KR: ['#e03131', '#1c7ed6'] },
    dark:  { ma: { '50': '#d95926', '150': '#9085e9', '200': '#e8e8e8' },
             US: ['#22c55e', '#ef4444'], KR: ['#f05252', '#4c9aff'] }
  };
  var NOTICE = 'TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.';
  var TICK = { US: /^[A-Z0-9][A-Z0-9.\-]{0,9}$/, KR: /^[0-9A-Z]{6}$/ };
  var cache = {}, lists = null, libP = null, cssDone = false;

  function ensureCss() {
    if (cssDone || !ROOT) return; cssDone = true;
    var ls = document.querySelectorAll('link[rel="stylesheet"]');
    for (var i = 0; i < ls.length; i++) if (/mtchart\.v1\.css(\?|$)/.test(ls[i].href)) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = ROOT + 'assets/mtchart.v1.css'; document.head.appendChild(l);
  }
  function loadLib() {
    if (libP) return libP;
    libP = new Promise(function (ok, no) {
      if (window.LightweightCharts) return ok(window.LightweightCharts);
      var s = document.createElement('script'), done = false;
      s.src = LIB; s.integrity = SRI; s.crossOrigin = 'anonymous'; s.async = true;
      s.onload = function () { done = true; window.LightweightCharts ? ok(window.LightweightCharts) : no(); };
      s.onerror = function () { done = true; no(); };
      setTimeout(function () { if (!done) no(); }, 20000);
      document.head.appendChild(s);
    });
    libP.catch(function () { libP = null; });          // 실패 뒤 다른 차트가 열리면 다시 시도
    return libP;
  }
  function getJSON(url) {
    return fetch(url, { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }
  function getLists() {
    if (!lists) lists = Promise.all([getJSON(DATA + '_missing.json'), getJSON(DATA + '_suspect.json')]);
    return lists;
  }
  function listed(j, m, t) { return !!(j && j[m] && Object.prototype.hasOwnProperty.call(j[m], t)); }
  function getData(m, t) {                                // 반환 Promise(데이터 | null) — 종목별 1회
    var k = m + '/' + t;
    if (!cache[k]) cache[k] = getLists().then(function (L) {
      if (listed(L[0], m, t) || listed(L[1], m, t)) return null;
      return getJSON(DATA + m + '/' + t + '.json');
    });
    return cache[k];
  }

  function utc(y, mo, d) { return Date.UTC(y, mo - 1, d) / 1000; }
  function toTime(x) {                                    // 20261110 · '2026-11-10' · '20261110' → UTC 초, 그 밖 null
    if (typeof x === 'number' && isFinite(x)) return utc(Math.floor(x / 10000), Math.floor(x / 100) % 100, x % 100);
    if (typeof x !== 'string') return null;
    var s = x.replace(/-/g, '');
    return /^\d{8}$/.test(s) ? utc(+s.slice(0, 4), +s.slice(4, 6), +s.slice(6, 8)) : null;
  }
  function monthsBack(t, n) { var d = new Date(t * 1000); d.setUTCMonth(d.getUTCMonth() - n); return d.getTime() / 1000; }
  function bars(j) {
    var a = [], n = j && j.t ? j.t.length : 0;
    for (var i = 0; i < n; i++) {
      var t = toTime(j.t[i]); if (t === null || !(j.c[i] > 0)) continue;
      a.push({ time: t, open: j.o[i], high: j.h[i], low: j.l[i], close: j.c[i], vol: j.v[i] || 0, last: t });
    }
    return a;
  }
  function weekly(a) {                                    // 월요일 시작 주: 시가 첫 봉, 고가 최대, 저가 최소, 종가 마지막 봉, 거래량 합
    var w = [], cur = null, key = null;
    a.forEach(function (b) {
      var dow = new Date(b.time * 1000).getUTCDay(), k = b.time - ((dow + 6) % 7) * 86400;
      if (k !== key) { if (cur) w.push(cur); key = k; cur = { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close, vol: b.vol, last: b.time }; }
      else { if (b.high > cur.high) cur.high = b.high; if (b.low < cur.low) cur.low = b.low; cur.close = b.close; cur.vol += b.vol; cur.last = b.time; }
    });
    if (cur) w.push(cur);
    return w;
  }
  function sma(a, n) {                                    // 단순이동평균(종가) — 봉 n개가 모인 뒤부터
    var out = [], s = 0;
    for (var i = 0; i < a.length; i++) {
      s += a[i].close; if (i >= n) s -= a[i - n].close;
      out.push(i >= n - 1 ? { time: a[i].time, value: s / n } : { time: a[i].time });
    }
    return out;
  }
  function fmtUS(p) {                                    // 0 이하 = 빈 글자(거래량 막대 자리의 축 눈금 — 가격은 0 이하가 없다)
    if (typeof p !== 'number' || !isFinite(p) || p <= 0) return '';
    var a = Math.abs(p);
    if (a >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    var s = p.toPrecision(3);
    if (s.indexOf('e') >= 0) s = p.toFixed(Math.min(20, 2 - Math.floor(Math.log10(a))));
    return s;
  }
  function fmtKR(p) { return (typeof p === 'number' && isFinite(p) && p > 0) ? Math.round(p).toLocaleString('en-US') : ''; }
  function rgb(s) { var m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  // 배경 판정(한 함수): 요소에서 조상으로 올라가며 처음 만나는 불투명(알파 > 0.5) 배경색의 상대 휘도 < 0.5 면 어두움.
  // 끝까지 투명이면 브라우저 기본 바탕을 따른다 — 사용자 설정 prefers-color-scheme 이 dark 이고 페이지가 color-scheme 에 dark 를 허용할 때만 어두움.
  // 반환 { dark: 참/거짓, bg: [r,g,b] (찾은 배경색, 못 찾으면 흰색/검정) }
  function bgDark(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var c = rgb(getComputedStyle(e).backgroundColor);
      if (c && c[3] > 0.5) return { dark: (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.5, bg: c.slice(0, 3) };
    }
    var d = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.documentElement).colorScheme.indexOf('dark') >= 0);
    return { dark: d, bg: d ? [18, 18, 18] : [255, 255, 255] };
  }
  function cleanMarks(x) {                                // date·side 만 남긴다(가격 등 다른 값은 버림)
    if (!Array.isArray(x)) return [];
    var out = [];
    x.forEach(function (m) {
      if (!m || typeof m !== 'object') return;
      var t = toTime(m.date), s = String(m.side || '').toLowerCase();
      s = (s === 'buy' || s === 'b' || s === '매수') ? 'buy' : (s === 'sell' || s === 's' || s === '매도') ? 'sell' : '';
      if (t !== null && s) out.push({ date: t, side: s });
    });
    return out;
  }
  function cleanPivot(x) {                                // 양수 유한 숫자(숫자 또는 '116.97'·'34000' 같은 글자)만, 그 밖 null
    if (typeof x === 'string') x = /^\s*\d+(\.\d+)?\s*$/.test(x) ? parseFloat(x) : NaN;
    return (typeof x === 'number' && isFinite(x) && x > 0) ? x : null;
  }
  function pivotOk(p, D) {                                // 최근 1년(마지막 봉 기준 12개월) 일봉 종가 범위 대비 터무니없는 값이면 false
    if (p === null || !D.length) return false;
    var from = monthsBack(D[D.length - 1].time, 12), hi = 0, lo = Infinity;
    for (var i = D.length - 1; i >= 0 && D[i].time >= from; i--) { if (D[i].close > hi) hi = D[i].close; if (D[i].close < lo) lo = D[i].close; }
    return p <= hi * PIV_HI && p >= lo * PIV_LO;
  }
  function fade(c) {                                      // 거래량 막대 = 봉 색 45% 불투명
    if (/^#[0-9a-f]{6}$/i.test(c)) return c + '73';
    var x = rgb(c); return x ? 'rgba(' + x[0] + ',' + x[1] + ',' + x[2] + ',0.45)' : c;
  }

  function mount(el, opt) {
    if (!el || !opt) return null;
    var m = String(opt.market || '').toUpperCase(), t = String(opt.ticker || '').toUpperCase();
    if (el.__mtc) { if (el.__mtc.key === m + '/' + t) return el.__mtc; el.__mtc.destroy(); }
    ensureCss();
    var st = { iv: 'd', range: Object.prototype.hasOwnProperty.call(RANGES, opt.range) ? opt.range : 'y1' };
    var marks = cleanMarks(opt.markers), pv = cleanPivot(opt.pivot);
    var H = { key: m + '/' + t, el: el, st: st, state: 'wait', chart: null, cs: null, vs: null, mas: {}, D: null, W: null, mk: null, pl: null, io: null };
    var LW = null, fmt = m === 'KR' ? fmtKR : fmtUS, plot, ui = {}, mq = null, dead = false, raf = 0;
    el.__mtc = H;
    el.classList.add('mtc'); el.setAttribute('data-market', m);
    el.innerHTML = '<div class="mtc-msg mtc-wait">차트 불러오는 중…</div>';

    function msg(s, cls) {
      H.state = cls; el.innerHTML = '<div class="mtc-msg mtc-' + cls + '">' + s + '</div>';
      if (H.chart) { try { H.chart.remove(); } catch (e) {} H.chart = null; }
    }
    function cv(n) { return getComputedStyle(el).getPropertyValue(n).trim(); }
    function colors() {
      var B = bgDark(el), P = B.dark ? PAL.dark : PAL.light, ink = rgb(getComputedStyle(el).color) || [128, 128, 128, 1];
      var a = function (al) { return 'rgba(' + ink[0] + ',' + ink[1] + ',' + ink[2] + ',' + al + ')'; };
      var lo = m.toLowerCase(), ma = {};
      MA.forEach(function (x) { ma[x.k] = cv('--mtc-ma' + x.k) || P.ma[x.k]; });
      return { up: cv('--mtc-' + lo + '-up') || cv('--mtc-up') || P[m][0], dn: cv('--mtc-' + lo + '-dn') || cv('--mtc-dn') || P[m][1],
               text: a(0.78), grid: a(0.09), border: a(0.28), ink: a(0.92), piv: a(0.7), ma: ma,
               // 피벗 글씨 = 배경 판정에 맞춘 글자색 + 같은 배경색 반투명 바탕(밑의 봉이 비쳐 보이는 정도)
               pvText: B.dark ? 'rgba(240,240,240,0.92)' : 'rgba(20,20,20,0.85)', pvBg: 'rgba(' + B.bg.join(',') + ',0.6)' };
    }
    function pvPlace() {                                  // 피벗 글씨 위치 = 선 y 바로 위, 차트 안 왼쪽 끝. 선이 그림 영역 밖이면 숨김
      raf = 0;
      var L = ui.pv; if (!L || dead || !H.chart) return;
      var y = H.cs.priceToCoordinate(pv), ph = H.chart.paneSize ? H.chart.paneSize().height : plot.clientHeight - H.chart.timeScale().height();
      if (y === null || !isFinite(y) || y < 0 || y > ph) { L.style.display = 'none'; return; }
      L.style.display = '';
      var h = L.offsetHeight, top = y - h - 1;
      var lgB = ui.lg ? ui.lg.offsetTop + ui.lg.offsetHeight : 0;
      if (top < lgB) top = y + 2;                          // 범례 줄·위 끝에 닿으면 선 바로 아래로
      if (top + h > ph) { L.style.display = 'none'; return; }
      L.style.top = Math.round(top) + 'px';
    }
    function pvSoon() { if (ui.pv && !raf && !dead) raf = requestAnimationFrame(pvPlace); }
    function cur() { return st.iv === 'w' ? H.W : H.D; }
    function maLen(x) { return st.iv === 'w' ? x.w : x.d; }
    function legend() {                                   // 차트 안 왼쪽 위 1줄 — 지금 그려진 선의 기간 숫자
      ui.lg.innerHTML = MA.map(function (x) { return '<span><i style="background:' + H.col.ma[x.k] + '"></i>' + maLen(x) + '</span>'; }).join('');
    }
    function sync() {
      ui.iv.forEach(function (b) { var on = b.getAttribute('data-iv') === st.iv; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    }
    function setMarks() {
      if (!H.mk) return;
      var a = cur(), out = [];
      marks.forEach(function (q) {
        for (var i = 0; i < a.length; i++) {                     // 그 날짜가 든 봉(주봉 = 그 주, 일봉 = 그날 또는 다음 거래일)
          if ((st.iv === 'w' && a[i].time <= q.date && q.date <= a[i].last) || (st.iv === 'd' && a[i].time >= q.date && a[i].time - q.date < 7 * 86400)) {
            out.push(q.side === 'buy' ? { time: a[i].time, position: 'belowBar', shape: 'arrowUp', color: H.col.ink, size: 1.2 }
                                      : { time: a[i].time, position: 'aboveBar', shape: 'arrowDown', color: H.col.ink, size: 1.2 });
            break;
          }
        }
      });
      out.sort(function (p, q) { return p.time - q.time; });
      H.mk.setMarkers(out);
    }
    function rng() {
      var a = cur(), last = a[a.length - 1].time, n = RANGES[st.range];
      if (n) H.chart.timeScale().setVisibleRange({ from: Math.max(a[0].time, monthsBack(last, n)), to: last });
      else H.chart.timeScale().fitContent();
    }
    function apply() {
      var a = cur(), c = H.col;
      H.cs.setData(a.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
      H.vs.setData(a.map(function (b) { return { time: b.time, value: b.vol, color: fade(b.close >= b.open ? c.up : c.dn) }; }));
      MA.forEach(function (x) { H.mas[x.k].setData(sma(a, maLen(x))); });
      setMarks(); legend(); sync(); pvSoon();
    }
    function theme() {
      var c = H.col = colors();
      H.chart.applyOptions({ layout: { textColor: c.text }, grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.border }, timeScale: { borderColor: c.border } });
      H.cs.applyOptions({ upColor: c.up, downColor: c.dn, borderUpColor: c.up, borderDownColor: c.dn, wickUpColor: c.up, wickDownColor: c.dn });
      MA.forEach(function (x) { H.mas[x.k].applyOptions({ color: c.ma[x.k] }); });
      if (H.pl) H.pl.applyOptions({ color: c.piv });
      if (ui.pv) { ui.pv.style.color = c.pvText; ui.pv.style.background = c.pvBg; }
      if (H.D) apply();
    }
    function build(lw, j) {
      LW = lw; H.D = bars(j); H.W = weekly(H.D);
      if (!H.D.length) return msg('차트 데이터 없음', 'none');
      var bt = function (v, label) { return '<button type="button" class="mtc-b" data-iv="' + v + '">' + label + '</button>'; };
      el.innerHTML = '<div class="mtc-bar"><span class="mtc-seg">' + bt('d', '일봉') + bt('w', '주봉') + '</span></div>' +
        '<div class="mtc-plot"><div class="mtc-lg" aria-hidden="true"></div></div>' +
        '<div class="mtc-attr">' + NOTICE + '</div>';
      plot = el.querySelector('.mtc-plot'); ui.lg = el.querySelector('.mtc-lg');
      ui.iv = [].slice.call(el.querySelectorAll('[data-iv]'));
      var c = H.col = colors();
      H.chart = lw.createChart(plot, {
        autoSize: true,
        layout: { background: { type: lw.ColorType.Solid, color: 'rgba(0,0,0,0)' }, textColor: c.text, fontSize: 11, attributionLogo: true,
                  fontFamily: getComputedStyle(el).fontFamily },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        // 위 여백 = 맨 위 눈금 글자·범례 줄, 아래 24% = 거래량 막대 + 왼쪽 아래 TradingView 로고 자리(봉이 로고 밑으로 내려가지 않게)
        rightPriceScale: { borderColor: c.border, entireTextOnly: true, scaleMargins: { top: 0.1, bottom: 0.24 } },
        timeScale: { borderColor: c.border, fixLeftEdge: true, fixRightEdge: true, minBarSpacing: 0.01 },
        localization: { locale: 'ko-KR', dateFormat: 'yyyy-MM-dd', priceFormatter: fmt },
        handleScroll: { vertTouchDrag: false }, crosshair: { mode: lw.CrosshairMode.Magnet }   // 가로선·가격 축 라벨이 그 봉 종가(가까운 선이 이평이면 그 값)에 붙는다
      });
      var hasPiv = pivotOk(pv, H.D);
      H.cs = H.chart.addSeries(lw.CandlestickSeries, { priceLineVisible: false, upColor: c.up, downColor: c.dn, borderUpColor: c.up, borderDownColor: c.dn,
        wickUpColor: c.up, wickDownColor: c.dn, priceFormat: m === 'KR' ? { type: 'price', precision: 0, minMove: 1 } : { type: 'price', precision: 3, minMove: 0.001 },
        // 피벗 선이 화면 밖으로 밀리지 않게 가격 축 자동 범위에 피벗 포함
        autoscaleInfoProvider: hasPiv ? function (orig) {
          var r = orig(); if (!r || !r.priceRange) return r;
          r.priceRange.minValue = Math.min(r.priceRange.minValue, pv); r.priceRange.maxValue = Math.max(r.priceRange.maxValue, pv); return r;
        } : undefined });
      H.vs = H.chart.addSeries(lw.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      H.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
      MA.forEach(function (x) {
        H.mas[x.k] = H.chart.addSeries(lw.LineSeries, { color: c.ma[x.k], lineWidth: x.lw, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      });
      if (hasPiv) {
        H.pl = H.cs.createPriceLine({ price: pv, color: c.piv, lineWidth: 1, lineStyle: lw.LineStyle.Dashed, axisLabelVisible: false, title: '' });
        ui.pv = document.createElement('div'); ui.pv.className = 'mtc-pv'; ui.pv.setAttribute('aria-hidden', 'true');
        ui.pv.textContent = '피벗 ' + fmt(pv); ui.pv.style.color = c.pvText; ui.pv.style.background = c.pvBg; ui.pv.style.display = 'none';
        plot.appendChild(ui.pv);
        // 확대·이동(가로) = 보이는 구간 변화, 크기 변화, 세로 축 끌기·휠 = 포인터 이벤트 → 다음 화면 갱신 때 1회 재배치
        H.chart.timeScale().subscribeVisibleLogicalRangeChange(pvSoon);
        H.chart.timeScale().subscribeSizeChange(pvSoon);
        H.chart.subscribeCrosshairMove(pvSoon);
        ['pointermove', 'pointerup', 'wheel', 'touchmove', 'touchend', 'dblclick'].forEach(function (ev) { plot.addEventListener(ev, pvSoon, { passive: true }); });
      }
      if (marks.length && lw.createSeriesMarkers) H.mk = lw.createSeriesMarkers(H.cs, []);
      var w0 = 0;
      H.chart.timeScale().subscribeSizeChange(function (w) { if (Math.abs(w - w0) > 1) { w0 = w; rng(); } });
      ui.iv.forEach(function (b) { b.addEventListener('click', function () { if (st.iv === b.getAttribute('data-iv')) return; st.iv = b.getAttribute('data-iv'); apply(); rng(); }); });
      if (window.matchMedia) { mq = matchMedia('(prefers-color-scheme: dark)'); if (mq.addEventListener) mq.addEventListener('change', theme); }
      H.state = 'ok';
      apply();
    }
    function start() {
      if (!TICK[m] || !TICK[m].test(t)) return msg('차트 데이터 없음', 'none');
      H.state = 'loading';
      getData(m, t).then(function (j) {
        if (dead) return;
        if (!j || !j.t || !j.t.length) return msg('차트 데이터 없음', 'none');
        return loadLib().then(function (lw) { if (!dead) build(lw, j); }, function () { if (!dead) msg('차트를 불러오지 못했습니다.', 'fail'); });
      }).catch(function () { if (!dead) msg('차트를 불러오지 못했습니다.', 'fail'); });
    }
    H.destroy = function () {
      dead = true; if (H.io) H.io.disconnect();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (ui.pv) { if (ui.pv.parentNode) ui.pv.parentNode.removeChild(ui.pv); ui.pv = null; }
      if (mq && mq.removeEventListener) mq.removeEventListener('change', theme);
      if (H.chart) { try { H.chart.remove(); } catch (e) {} H.chart = null; }
      el.__mtc = null;
    };
    H.markers = function () { return H.mk ? H.mk.markers() : []; };
    H.pivot = function () { return H.pl ? H.pl.options().price : null; };
    H.pivotLabel = function () { return ui.pv || null; };
    if ('IntersectionObserver' in window) {
      H.io = new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) { H.io.disconnect(); H.io = null; start(); return; }
      }, { rootMargin: '200px 0px' });
      H.io.observe(el);
    } else start();
    return H;
  }
  window.MTChart = { mount: mount, version: '1' };
})();

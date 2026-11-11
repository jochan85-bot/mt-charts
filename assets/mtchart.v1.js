/* mtchart.v1.js — 종목 일봉 차트 표시 모듈.
   호출: MTChart.mount(요소, { market: 'US'|'KR', ticker: 'AEHR', markers: [{ date: '2026-08-13', side: 'buy'|'sell' }], range: 'y1' })
     - 요소가 화면에 들어올 때(접힌 칸이면 펼쳐져 보일 때) 처음 데이터를 받는다. 같은 종목을 다시 열면 받아 둔 데이터를 쓴다(재요청 0).
     - markers 는 date·side 두 값만 읽는다(다른 값은 무시). 매수 ▲(봉 아래)·매도 ▼(봉 위).
     - range = m1·m3·m6·y1·y3·all (기본 y1).
   데이터: <이 파일 위치>/../data/<시장>/<티커>.json = { schema: 2, t: [YYYYMMDD…], o, h, l, c, v, last_bar_date, kr_regular_from? }
     데이터가 없거나(404·목록 _missing) 연속성이 의심되는 종목(목록 _suspect)은 「차트 데이터 없음」 한 줄만 표시한다.
   라이브러리: TradingView Lightweight Charts™ 5.2.1 (Apache-2.0, 버전 고정 CDN + SRI). 못 불러오면 차트 자리에만 안내 문구.
   화면: 봉 + 거래량 막대(아래) + 단순이동평균 50·150·200일(기본 표시)·10·21일(기본 꺼짐). 주봉(월요일 시작 주로 묶음)에서는 10·30·40주선이
     50·150·200일선 자리를 맡고, 10·21일선은 주봉에 대응 기간이 없어 단추를 비활성으로 둔다(일봉으로 돌아오면 켜 둔 상태 그대로).
     이동평균은 받은 봉 전체로 계산한다 — 짧은 기간 화면에서도 선이 화면 왼쪽 끝부터 그려진다(봉이 모자라면 계산되는 구간만).
   색: 호스트 페이지 글자색·배경 밝기를 읽어 맞춘다. 상승·하락 색은 CSS 변수로 바꿀 수 있다
     --mtc-up·--mtc-dn(두 시장 공통) 또는 --mtc-us-up·--mtc-us-dn·--mtc-kr-up·--mtc-kr-dn, 이동평균 --mtc-ma50 … --mtc-ma21.
     기본값: 미국 상승 초록·하락 빨강, 한국 상승 빨강·하락 파랑.
   가격 표시(축·십자선·판독 줄 공통): 미국 = 1 이상 소수 2자리(쉼표), 1 미만 유효숫자 3자리 / 한국 = 원 단위 정수(쉼표). */
(function () {
  'use strict';
  if (window.MTChart) return;
  var LIB = 'https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js';
  var SRI = 'sha384-KkYqTZlM13Zya6fVUF3IGCBOQ1ehFeJVVgxaVvD/0MebineF9EI8Jkd3NnWNChqN';
  var ME = document.currentScript && document.currentScript.src;
  var ROOT = ME ? new URL('../', ME).href : '';
  var DATA = ROOT + 'data/';
  var RANGES = [['m1', '1개월', 1], ['m3', '3개월', 3], ['m6', '6개월', 6], ['y1', '1년', 12], ['y3', '3년', 36], ['all', '전체', 0]];
  // 이동평균: d = 일봉 기간, w = 주봉 기간(0 = 주봉에서 비활성), on = 기본 표시
  var MA = [{ k: '50', d: 50, w: 10, on: true, lw: 1 }, { k: '150', d: 150, w: 30, on: true, lw: 2 }, { k: '200', d: 200, w: 40, on: true, lw: 2 },
            { k: '10', d: 10, w: 0, on: false, lw: 1, dash: true }, { k: '21', d: 21, w: 0, on: false, lw: 1, dash: true }];
  var PAL = {   // 이동평균 = 밝은/어두운 판 각각 판별 검사 통과 단계, 봉 = 시장 관행
    light: { ma: { '50': '#eb6834', '150': '#6250d6', '200': '#1baf7a', '10': '#eda100', '21': '#e87ba4' },
             US: ['#16a34a', '#dc2626'], KR: ['#e03131', '#1c7ed6'] },
    dark:  { ma: { '50': '#d95926', '150': '#9085e9', '200': '#199e70', '10': '#c98500', '21': '#d55181' },
             US: ['#22c55e', '#ef4444'], KR: ['#f05252', '#4c9aff'] }
  };
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
  function ymd(t) { return new Date(t * 1000).toISOString().slice(0, 10); }
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
    if (!n) return out;
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
  function fmtN(v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v).toLocaleString('en-US') : ''; }
  function rgb(s) { var m = /rgba?\(([^)]+)\)/.exec(s || ''); if (!m) return null; var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(parseFloat); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
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
  function fade(c) {                                      // 거래량 막대 = 봉 색 45% 불투명
    if (/^#[0-9a-f]{6}$/i.test(c)) return c + '73';
    var x = rgb(c); return x ? 'rgba(' + x[0] + ',' + x[1] + ',' + x[2] + ',0.45)' : c;
  }

  function mount(el, opt) {
    if (!el || !opt) return null;
    var m = String(opt.market || '').toUpperCase(), t = String(opt.ticker || '').toUpperCase();
    if (el.__mtc) { if (el.__mtc.key === m + '/' + t) return el.__mtc; el.__mtc.destroy(); }
    ensureCss();
    var st = { iv: 'd', range: 'y1', log: false, ma: {} }, marks = cleanMarks(opt.markers);
    RANGES.forEach(function (r) { if (r[0] === opt.range) st.range = r[0]; });
    MA.forEach(function (x) { st.ma[x.k] = x.on; });
    var H = { key: m + '/' + t, el: el, st: st, state: 'wait', chart: null, cs: null, vs: null, mas: {}, D: null, W: null, mk: null, io: null };
    var LW = null, fmt = m === 'KR' ? fmtKR : fmtUS, rf = null, plot, read, note, ui = {}, mq = null, dead = false;
    el.__mtc = H;
    el.classList.add('mtc'); el.setAttribute('data-market', m);
    el.innerHTML = '<div class="mtc-msg mtc-wait">차트 불러오는 중…</div>';

    function msg(s, cls) {
      H.state = cls; el.innerHTML = '<div class="mtc-msg mtc-' + cls + '">' + s + '</div>';
      if (H.chart) { try { H.chart.remove(); } catch (e) {} H.chart = null; }
    }
    function cv(n) { return getComputedStyle(el).getPropertyValue(n).trim(); }
    function dark() {
      for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
        var c = rgb(getComputedStyle(e).backgroundColor);
        if (c && c[3] > 0.5) return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 < 0.5;
      }
      return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches && getComputedStyle(document.documentElement).colorScheme.indexOf('dark') >= 0);
    }
    function colors() {
      var P = dark() ? PAL.dark : PAL.light, ink = rgb(getComputedStyle(el).color) || [128, 128, 128, 1];
      var a = function (al) { return 'rgba(' + ink[0] + ',' + ink[1] + ',' + ink[2] + ',' + al + ')'; };
      var lo = m.toLowerCase(), ma = {};
      MA.forEach(function (x) { ma[x.k] = cv('--mtc-ma' + x.k) || P.ma[x.k]; });
      return { up: cv('--mtc-' + lo + '-up') || cv('--mtc-up') || P[m][0], dn: cv('--mtc-' + lo + '-dn') || cv('--mtc-dn') || P[m][1],
               text: a(0.78), grid: a(0.09), border: a(0.28), ink: a(0.92), ma: ma };
    }
    function cur() { return st.iv === 'w' ? H.W : H.D; }
    function maLen(x) { return st.iv === 'w' ? x.w : x.d; }
    function sync() {
      ui.iv.forEach(function (b) { var on = b.getAttribute('data-iv') === st.iv; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      ui.rg.forEach(function (b) { var on = b.getAttribute('data-rg') === st.range; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
      ui.log.classList.toggle('on', st.log); ui.log.setAttribute('aria-pressed', st.log);
      ui.ma.forEach(function (b) {
        var x = MA[+b.getAttribute('data-ma')], n = maLen(x), off = !n;
        b.disabled = off; b.classList.toggle('on', !off && st.ma[x.k]); b.setAttribute('aria-pressed', !off && st.ma[x.k]);
        b.querySelector('span').textContent = off ? x.d + '일' : n + (st.iv === 'w' ? '주' : '일');
        b.title = off ? '주봉에서는 쓰지 않습니다' : '';
      });
    }
    function readout(b) {
      if (!b) { read.textContent = ''; return; }
      var src = cur(), i = src.indexOf(b), mv = [], mk = '';
      MA.forEach(function (x) {
        var n = maLen(x); if (!n || !st.ma[x.k] || i < n - 1) return;
        var s = 0; for (var k = i - n + 1; k <= i; k++) s += src[k].close;
        mv.push('<i class="mtc-sw" style="background:' + H.col.ma[x.k] + '"></i>' + n + (st.iv === 'w' ? '주 ' : '일 ') + fmt(s / n));
      });
      marks.forEach(function (q) { if (q.date >= b.time && q.date <= b.last) mk = q.side === 'buy' ? ' · ▲ 매수' : ' · ▼ 매도'; });
      read.innerHTML = '<b>' + ymd(b.time) + '</b>' + (st.iv === 'w' ? ' 주' : '') + ' 시 ' + fmt(b.open) + ' 고 ' + fmt(b.high) + ' 저 ' + fmt(b.low) +
        ' 종 <b>' + fmt(b.close) + '</b> · 거래량 ' + fmtN(b.vol) + mk + (mv.length ? '<br>' + mv.join(' ') : '');
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
    function noteSync() {
      if (!note) return;
      var r = H.chart && H.chart.timeScale().getVisibleRange(), a = cur();
      note.hidden = !(rf !== null && r && a.length && a[0].time < rf && r.from < rf);
    }
    function rng() {
      var a = cur(), last = a[a.length - 1].time, R = RANGES.filter(function (r) { return r[0] === st.range; })[0];
      if (R[2]) { var d = new Date(last * 1000); d.setUTCMonth(d.getUTCMonth() - R[2]); H.chart.timeScale().setVisibleRange({ from: Math.max(a[0].time, d.getTime() / 1000), to: last }); }
      else H.chart.timeScale().fitContent();
      noteSync();
    }
    function scale() { H.chart.priceScale('right').applyOptions({ mode: st.log ? LW.PriceScaleMode.Logarithmic : LW.PriceScaleMode.Normal, autoScale: true }); }
    function apply() {
      var a = cur(), c = H.col;
      H.cs.setData(a.map(function (b) { return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }; }));
      H.vs.setData(a.map(function (b) { return { time: b.time, value: b.vol, color: fade(b.close >= b.open ? c.up : c.dn) }; }));
      MA.forEach(function (x) {
        var n = maLen(x), s = H.mas[x.k];
        s.setData(n ? sma(a, n) : []); s.applyOptions({ visible: !!n && st.ma[x.k] });
      });
      setMarks(); scale(); rng(); requestAnimationFrame(function () { if (H.chart) rng(); });
      readout(a[a.length - 1]); sync();
    }
    function theme() {
      var c = H.col = colors();
      H.chart.applyOptions({ layout: { textColor: c.text }, grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        rightPriceScale: { borderColor: c.border }, timeScale: { borderColor: c.border } });
      H.cs.applyOptions({ upColor: c.up, downColor: c.dn, borderUpColor: c.up, borderDownColor: c.dn, wickUpColor: c.up, wickDownColor: c.dn });
      MA.forEach(function (x) { H.mas[x.k].applyOptions({ color: c.ma[x.k] }); });
      ui.ma.forEach(function (b) { b.querySelector('i').style.background = c.ma[MA[+b.getAttribute('data-ma')].k]; });
      if (H.D) apply();
    }
    function build(lw, j) {
      LW = lw; H.D = bars(j); H.W = weekly(H.D);
      if (!H.D.length) return msg('차트 데이터 없음', 'none');
      rf = j.kr_regular_from ? toTime(j.kr_regular_from) : null;
      var bt = function (attr, v, label, extra) { return '<button type="button" class="mtc-b" ' + attr + '="' + v + '"' + (extra || '') + '>' + label + '</button>'; };
      el.innerHTML =
        '<div class="mtc-bar">' + bt('data-iv', 'd', '일봉') + bt('data-iv', 'w', '주봉') + '<span class="mtc-sp"></span>' + bt('data-log', '1', '로그 축') + '</div>' +
        '<div class="mtc-bar mtc-rg">' + RANGES.map(function (r) { return bt('data-rg', r[0], r[1]); }).join('') + '</div>' +
        '<div class="mtc-bar mtc-mab"><span class="mtc-lb">이동평균</span>' + MA.map(function (x, i) { return bt('data-ma', i, '<i class="mtc-sw' + (x.dash ? ' mtc-dash' : '') + '"></i><span>' + x.d + '일</span>'); }).join('') + '</div>' +
        '<div class="mtc-plot"></div><div class="mtc-read" aria-live="polite"></div>' +
        (marks.length ? '<div class="mtc-fine">▲ 매수 · ▼ 매도</div>' : '') +
        (rf !== null ? '<div class="mtc-fine mtc-krnote" hidden>과거 봉은 시간외 거래 포함</div>' : '') +
        '<div class="mtc-fine mtc-attr">가격 차트: TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc. <a href="https://www.tradingview.com/" rel="noopener" target="_blank">tradingview.com</a> · Apache License 2.0</div>';
      plot = el.querySelector('.mtc-plot'); read = el.querySelector('.mtc-read'); note = el.querySelector('.mtc-krnote');
      ui.iv = [].slice.call(el.querySelectorAll('[data-iv]')); ui.rg = [].slice.call(el.querySelectorAll('[data-rg]'));
      ui.log = el.querySelector('[data-log]'); ui.ma = [].slice.call(el.querySelectorAll('[data-ma]'));
      var c = H.col = colors();
      H.chart = lw.createChart(plot, {
        autoSize: true,
        layout: { background: { type: lw.ColorType.Solid, color: 'rgba(0,0,0,0)' }, textColor: c.text, fontSize: 11, attributionLogo: true,
                  fontFamily: getComputedStyle(el).fontFamily },
        grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
        // 위 여백 = 맨 위 눈금 글자, 아래 24% = 거래량 막대 + 왼쪽 아래 TradingView 로고 자리(봉이 로고 밑으로 내려가지 않게)
        rightPriceScale: { borderColor: c.border, entireTextOnly: true, scaleMargins: { top: 0.08, bottom: 0.24 } },
        timeScale: { borderColor: c.border, fixLeftEdge: true, fixRightEdge: true, minBarSpacing: 0.01 },
        localization: { locale: 'ko-KR', dateFormat: 'yyyy-MM-dd', priceFormatter: fmt },
        handleScroll: { vertTouchDrag: false }, crosshair: { mode: lw.CrosshairMode.Normal }
      });
      H.cs = H.chart.addSeries(lw.CandlestickSeries, { priceLineVisible: false, upColor: c.up, downColor: c.dn, borderUpColor: c.up, borderDownColor: c.dn,
        wickUpColor: c.up, wickDownColor: c.dn, priceFormat: m === 'KR' ? { type: 'price', precision: 0, minMove: 1 } : { type: 'price', precision: 3, minMove: 0.001 } });
      H.vs = H.chart.addSeries(lw.HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
      H.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
      MA.forEach(function (x) {
        H.mas[x.k] = H.chart.addSeries(lw.LineSeries, { color: c.ma[x.k], lineWidth: x.lw, lineStyle: x.dash ? lw.LineStyle.Dashed : lw.LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      });
      if (marks.length && lw.createSeriesMarkers) H.mk = lw.createSeriesMarkers(H.cs, []);
      ui.ma.forEach(function (b) { b.querySelector('i').style.background = c.ma[MA[+b.getAttribute('data-ma')].k]; });
      H.chart.subscribeCrosshairMove(function (p) {
        var a = cur(), b = null;
        if (p && p.time !== undefined) for (var i = a.length - 1; i >= 0; i--) if (a[i].time === p.time) { b = a[i]; break; }
        readout(b || a[a.length - 1]);
      });
      H.chart.timeScale().subscribeVisibleTimeRangeChange(noteSync);
      var w0 = 0;
      H.chart.timeScale().subscribeSizeChange(function (w) { if (Math.abs(w - w0) > 1) { w0 = w; rng(); } });
      ui.iv.forEach(function (b) { b.addEventListener('click', function () { st.iv = b.getAttribute('data-iv'); apply(); }); });
      ui.rg.forEach(function (b) { b.addEventListener('click', function () { st.range = b.getAttribute('data-rg'); rng(); sync(); }); });
      ui.log.addEventListener('click', function () { st.log = !st.log; scale(); sync(); });
      ui.ma.forEach(function (b) {
        b.addEventListener('click', function () {
          var x = MA[+b.getAttribute('data-ma')]; if (!maLen(x)) return;
          st.ma[x.k] = !st.ma[x.k]; H.mas[x.k].applyOptions({ visible: st.ma[x.k] }); sync(); readout(cur()[cur().length - 1]);
        });
      });
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
      if (mq && mq.removeEventListener) mq.removeEventListener('change', theme);
      if (H.chart) { try { H.chart.remove(); } catch (e) {} H.chart = null; }
      el.__mtc = null;
    };
    H.markers = function () { return H.mk ? H.mk.markers() : []; };
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

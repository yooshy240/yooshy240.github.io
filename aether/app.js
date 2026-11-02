"use strict";
(() => {
  const REFRESH_MS = 30000;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);
  const nf2 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const tFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const hFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const signed = (v, f = nf2) => (v > 0 ? "+" : v < 0 ? "−" : "") + f.format(Math.abs(v));
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const price = (p) => p == null ? "—" : p >= 100 ? nf2.format(p) : p >= 1 ? p.toFixed(4) : p.toPrecision(4);
  const prev = new Map();
  let state = { summary: null, conf: null, selected: null };

  // count-up for numbers (respects reduced motion)
  function countTo(el, to, fmt) {
    const from = prev.has(el) ? prev.get(el) : (reduce ? to : 0);
    prev.set(el, to);
    if (reduce || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  async function j(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }

  function ago(min) {
    if (min == null) return "inconnu";
    if (min < 1) return "moins d'une minute";
    if (min < 90) return Math.round(min) + " min";
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h + " h " + String(m).padStart(2, "0");
  }

  function renderStatus() {
    const s = state.summary; if (!s) return;
    const last = s.last_scan || s.last_activity;
    const base = Date.parse(s.last_activity || last);
    const min = isNaN(base) ? null : (Date.now() - base) / 60000;
    const stale = min == null || min > s.stale_after_min;
    $("statusDot").className = "dot " + (stale ? "stale" : "ok");
    $("statusText").innerHTML = "dernier scan il y a <b class='num'>" + ago(min) + "</b>" +
      (stale ? " · <span class='neg'>données périmées</span>" : "");
    $("status").title = "Dernier scan : " + (last ? tFmt.format(new Date(last)) + " (Paris)" : "—");
  }

  function renderSummary(s) {
    state.summary = s;
    countTo($("kEquity"), s.equity ?? 0, (v) => nf2.format(v));
    const t = $("kToday"); t.className = "kpi-value " + cls(s.pnl_today);
    countTo(t, s.pnl_today ?? 0, (v) => signed(v));
    $("kTodayPct").textContent = s.pnl_today_pct == null ? "" : signed(s.pnl_today_pct) + " % · ouverture " + nf2.format(s.day_open_equity);
    const g = $("kTotal"); g.className = "kpi-value " + cls(s.pnl_total);
    countTo(g, s.pnl_total ?? 0, (v) => signed(v));
    $("kTotalPct").textContent = s.pnl_total_pct == null ? "" : signed(s.pnl_total_pct) + " % · départ " + nf0.format(s.start_equity);
    countTo($("kOpen"), s.open_positions, (v) => nf0.format(v));
    $("kOpenMax").textContent = "sur " + s.max_positions + " max";
    const ex = $("kExpo"); ex.className = "kpi-value " + (s.exposure_pct >= s.exposure_cap_pct ? "neg" : "");
    countTo(ex, s.exposure_pct, (v) => nf1.format(v) + " %");
    $("kExpoBar").style.width = Math.min(100, s.exposure_pct / s.exposure_cap_pct * 100) + "%";
    $("kExpoCap").textContent = "plafond " + nf0.format(s.exposure_cap_pct) + " % · " + nf2.format(s.open_value) + " exposés";
    const h = $("kHalt");
    h.textContent = s.halted ? "Entrées suspendues" : "Actif";
    h.className = "kpi-value " + (s.halted ? "neg" : "pos");
    const gb = $("gateBanner");
    if (gb) { gb.hidden = !s.entries_blocked; gb.textContent = s.entries_blocked ? "⛔ " + (s.entries_banner || "Entrées bloquées — leçon 3") + " · " + (s.entries_blocked_reason || "") + " · aucune nouvelle position (paper ou réel) ; signaux, alertes et stops suiveurs continuent" : ""; }
    if (s.entries_blocked) { h.textContent = "Entrées bloquées"; h.className = "kpi-value neg"; }
    $("kHaltSub").textContent = "seuil −" + nf0.format(s.daily_loss_limit_pct) + " % / jour" +
      (s.pnl_today_pct != null ? " · jour " + signed(s.pnl_today_pct) + " %" : "");
    renderStatus();
  }

  function renderEquity(e, noAnim) {
    lastEquity = e;
    const pts = e.points.filter((p) => p.equity != null);
    const box = $("equityChart");
    $("eqMeta").textContent = pts.length + " points";
    if (!pts.length) { box.innerHTML = "<div class='empty'><b>Pas encore d'historique d'équité</b></div>"; return; }
    const W = Math.max(280, Math.round(box.clientWidth || 640)), H = Math.round(Math.min(260, Math.max(190, W * 0.42))), L = 50, R = 10, T = 12, B = 24;
    const xs = pts.map((p) => Date.parse(p.ts)), ys = pts.map((p) => p.equity);
    let lo = Math.min(...ys, e.start_equity ?? Infinity), hi = Math.max(...ys, e.start_equity ?? -Infinity);
    const pad = Math.max((hi - lo) * 0.15, hi * 0.005); lo -= pad; hi += pad;
    const x0 = xs[0], x1 = xs.length > 1 ? xs[xs.length - 1] : xs[0] + 1;
    const X = (x) => L + (x - x0) / (x1 - x0) * (W - L - R);
    const Y = (y) => T + (hi - y) / (hi - lo) * (H - T - B);
    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const v = lo + (hi - lo) * i / 4, y = Y(v);
      grid += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="axis" x="${L - 6}" y="${y + 3}" text-anchor="end">${nf0.format(v)}</text>`;
    }
    const ticks = Math.min(5, xs.length);
    for (let i = 0; i < ticks; i++) {
      const x = x0 + (x1 - x0) * (ticks === 1 ? 0 : i / (ticks - 1));
      grid += `<text class="axis" x="${X(x)}" y="${H - 8}" text-anchor="middle">${hFmt.format(new Date(x))}</text>`;
    }
    const d = pts.map((p, i) => (i ? "L" : "M") + X(xs[i]).toFixed(1) + " " + Y(p.equity).toFixed(1)).join(" ");
    const area = d + ` L ${X(xs[xs.length - 1]).toFixed(1)} ${H - B} L ${X(xs[0]).toFixed(1)} ${H - B} Z`;
    const base = e.start_equity != null ? `<line class="base" x1="${L}" x2="${W - R}" y1="${Y(e.start_equity)}" y2="${Y(e.start_equity)}"/>` : "";
    const dots = pts.map((p, i) => `<circle class="pt" r="2.6" cx="${X(xs[i]).toFixed(1)}" cy="${Y(p.equity).toFixed(1)}"><title>${tFmt.format(new Date(p.ts))} — ${nf2.format(p.equity)} USDT fictifs</title></circle>`).join("");
    const first = !noAnim && !box.querySelector("svg");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe d'équité paper">
      <defs><linearGradient id="eqGrad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#d4b06a" stop-opacity=".28"/><stop offset="1" stop-color="#d4b06a" stop-opacity="0"/></linearGradient></defs>
      ${grid}${base}<path class="area" d="${area}"/><path class="line${first ? " draw" : ""}" d="${d}"/>${dots}</svg>`;
    const ln = box.querySelector(".line"); if (ln && first) ln.style.setProperty("--len", Math.ceil(ln.getTotalLength()));
    const last = pts[pts.length - 1];
    $("eqLegend").innerHTML = `Dernier point : <b class="num">${nf2.format(last.equity)}</b> USDT fictifs le ${tFmt.format(new Date(last.ts))} (Paris) · cash ${nf2.format(last.cash)} · ligne pointillée = capital de départ ${nf0.format(e.start_equity)}`;
  }

  let lastEquity = null, rz = null;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => lastEquity && renderEquity(lastEquity, true), 200); });

  function renderPositions(p) {
    $("posMeta").textContent = p.count ? p.count + " ouverte" + (p.count > 1 ? "s" : "") : "";
    if (!p.count) { $("positions").innerHTML = "<div class='empty'><b>Aucune position ouverte</b><span>Le bot n'a validé aucune entrée paper pour l'instant.</span></div>"; return; }
    $("positions").innerHTML = `<table><thead><tr><th>Actif</th><th class="r">Entrée</th><th class="r">Prix</th><th class="r">PnL latent</th><th class="r">Stop / trailing</th></tr></thead><tbody>` +
      p.positions.map((r) => `<tr><td><b>${esc(r.asset)}</b><div class="time">${tFmt.format(new Date(r.opened_ts))} · ${esc(r.origin)}</div></td>
        <td class="r">${price(r.entry_price)}</td><td class="r">${price(r.current_price)}</td>
        <td class="r ${cls(r.unrealized_pnl)}">${r.unrealized_pnl == null ? "—" : signed(r.unrealized_pnl)}<div class="time">${r.unrealized_pct == null ? "" : signed(r.unrealized_pct) + " %"}</div></td>
        <td class="r">${price(r.stop_price)}<div class="time">trail ${nf1.format(r.trail_pct)} %</div></td></tr>`).join("") +
      `</tbody></table><p class="ref">Prix : ${esc(p.price_source)}.</p>`;
  }

  function renderTrades(t) {
    $("trMeta").textContent = t.count ? t.count + " · réussite " + nf1.format(t.win_rate_pct) + " %" : "";
    countTo($("trWin"), t.winners, (v) => nf0.format(v));
    countTo($("trLoss"), t.losers, (v) => nf0.format(v));
    $("trWinPnl").textContent = signed(t.pnl_winners) + " USDT";
    $("trLossPnl").textContent = signed(t.pnl_losers) + " USDT";
    if (!t.count) {
      $("trades").innerHTML = `<div class="empty"><b>${esc(t.empty_message)}</b><span>Les trades paper apparaîtront ici dès leur clôture (trailing stop).</span></div>`;
    } else {
      $("trades").innerHTML = `<table><thead><tr><th>Actif</th><th class="r">Entrée → sortie</th><th class="r">PnL</th></tr></thead><tbody>` +
        t.trades.map((r) => `<tr><td><b>${esc(r.asset)}</b><div class="time">${r.closed_ts ? tFmt.format(new Date(r.closed_ts)) : ""}</div></td>
          <td class="r">${price(r.entry_price)} → ${price(r.exit_price)}</td>
          <td class="r ${cls(r.pnl)}">${signed(r.pnl ?? 0)}<div class="time">${r.ret_pct == null ? "" : signed(r.ret_pct) + " %"}</div></td></tr>`).join("") + "</tbody></table>";
    }
    const b = t.backtest_reference;
    $("btRef").innerHTML = b ? `Référence backtest #${b.run_id} (simulation historique, pas du paper) : ${b.trades} trades, réussite ${nf1.format(b.win_rate_pct)} %, PF ${b.profit_factor}, PnL clos ${signed(b.net_pnl_closed_usdt)} USDT fictifs.` : "";
  }

  function renderAlerts(a) {
    $("alMeta").textContent = a.count ? a.count + " crypto" : "";
    if (!a.count) { $("alerts").innerHTML = "<div class='empty'><b>Aucune alerte pour l'instant</b></div>"; return; }
    $("alerts").innerHTML = a.alerts.map((x) => {
      const tag = x.entered ? "<span class='tag in'>entrée paper</span>"
        : x.status === "suppressed" ? "<span class='tag sup'>supprimée</span>"
        : x.decision ? "<span class='tag out'>refusée</span>" : "<span class='tag'>sans décision</span>";
      return `<div class="alert"><div class="alert-h"><b>${esc(x.asset)}</b>${tag}</div>
        <div class="time">${tFmt.format(new Date(x.ts))} (Paris) · ${esc(x.tier || "")}${x.small_cap ? " · petite cap" : ""}</div>
        <div class="metrics"><div>Volume<b>${x.volume_multiple == null ? "—" : "×" + nf1.format(x.volume_multiple)}</b></div>
          <div>Score vol.<b>${x.volume_score == null ? "—" : nf1.format(x.volume_score)}</b></div>
          <div>Confiance<b>${x.confidence == null ? "—" : nf1.format(x.confidence)}</b></div></div>
        <div class="reason">${esc(x.reason || x.message || "")}</div></div>`;
    }).join("");
  }

  function radar(asset) {
    const C = 150, Rr = 100, axes = [["volume", "Volume"], ["wallets", "Wallets"], ["sentiment", "Sentiment"]];
    const ang = (i) => -Math.PI / 2 + i * 2 * Math.PI / axes.length;
    const P = (i, r) => [C + Math.cos(ang(i)) * r, C + Math.sin(ang(i)) * r];
    let s = "";
    [25, 50, 75, 100].forEach((v) => { s += `<polygon class="ring" points="${axes.map((_, i) => P(i, Rr * v / 100).join(",")).join(" ")}"/>`; });
    axes.forEach(([k, lbl], i) => {
      const [x, y] = P(i, Rr), [lx, ly] = P(i, Rr + 22), a = asset ? asset[k] : null;
      s += `<line class="spoke" x1="${C}" y1="${C}" x2="${x}" y2="${y}"/>
        <text class="lbl" x="${lx}" y="${ly}" text-anchor="middle">${lbl} ${a ? nf0.format(a.score) : ""}</text>
        ${a && a.stub ? `<text class="stub" x="${lx}" y="${ly + 12}" text-anchor="middle">non branché</text>` : ""}`;
    });
    const pts = axes.map(([k], i) => P(i, Rr * Math.max(2, Math.min(100, asset ? asset[k].score : 0)) / 100).join(",")).join(" ");
    s += `<polygon class="shape" points="${pts}"/>`;
    $("radar").innerHTML = `<svg viewBox="0 0 300 300" role="img" aria-label="Radar de confiance">${s}</svg>`;
  }

  function renderConfidence(c) {
    state.conf = c;
    $("cfMeta").textContent = c.generated_at ? "état du " + tFmt.format(new Date(c.generated_at)) : "";
    if (!c.top.length) { $("radar").innerHTML = "<div class='empty'><b>dashboard_state.json indisponible</b></div>"; $("cfAssets").innerHTML = ""; return; }
    if (!state.selected || !c.top.find((r) => r.asset === state.selected)) state.selected = c.top[0].asset;
    const sel = c.top.find((r) => r.asset === state.selected);
    radar(sel);
    $("cfAssets").innerHTML = c.top.map((r) => `<button class="chip${r.asset === state.selected ? " active" : ""}" data-a="${esc(r.asset)}">${esc(r.asset)} · ${nf1.format(r.confidence)}</button>`).join("");
    const w = c.weights || {};
    $("cfNote").textContent = `${sel.asset} : confiance ${nf1.format(sel.confidence)}/100. Poids : volume ${w.abnormal_volume}, wallets ${w.wallet_accumulation}, sentiment ${w.social_sentiment}. Top ${c.top.length} sur ${c.assets_total} actifs scannés.`;
  }
  $("cfAssets").addEventListener("click", (ev) => {
    const b = ev.target.closest(".chip"); if (!b || !state.conf) return;
    state.selected = b.dataset.a; renderConfidence(state.conf);
  });

  // tabs <-> swipe sync (mobile)
  const cards = $("cards"), tabs = [...document.querySelectorAll("#tabs button")];
  tabs.forEach((b) => b.addEventListener("click", () => {
    $(b.dataset.target).scrollIntoView({ behavior: reduce ? "auto" : "smooth", inline: "center", block: "nearest" });
  }));
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) tabs.forEach((b) => b.classList.toggle("active", b.dataset.target === e.target.id));
    }), { root: cards, threshold: 0.6 });
    document.querySelectorAll(".card").forEach((c) => io.observe(c));
  }

  async function refresh() {
    const jobs = [["/api/summary", renderSummary], ["/api/equity", renderEquity], ["/api/positions", renderPositions],
      ["/api/trades", renderTrades], ["/api/alerts", renderAlerts], ["/api/confidence", renderConfidence]];
    const res = await Promise.allSettled(jobs.map(([u, f]) => j(u).then(f)));
    const failed = res.filter((r) => r.status === "rejected");
    if (failed.length) {
      $("statusDot").className = "dot stale";
      $("statusText").textContent = "serveur injoignable ou erreur (" + failed.length + ")";
      console.error(failed.map((f) => f.reason));
    }
  }
  refresh();
  setInterval(refresh, REFRESH_MS);
  setInterval(renderStatus, 15000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
})();

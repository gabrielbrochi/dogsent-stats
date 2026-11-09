// DOGSENT.gg: lê data/hub.json e monta a matilha (ranking), partidas, perfis e mano a mano.
(() => {
  const SRC_LABEL = { gc: "GC", premier: "Premier", faceit: "FACEIT", competitive: "Competitivo", wingman: "Wingman", outro: "Outro" };
  const PERIODS = [["7", "7 dias"], ["30", "30 dias"], ["90", "90 dias"], ["all", "Sempre"]];
  const MIN_GAMES = 3; // mínimo de partidas para disputar pódio e títulos
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const store = {
    get(k, d) { try { const v = localStorage.getItem("dogsent:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("dogsent:" + k, JSON.stringify(v)); } catch {} },
  };

  let HUB = null;
  let byId = new Map();
  const state = {
    src: store.get("src", "all"),
    period: store.get("period", "30"),
    sort: store.get("sort", { key: "lr", dir: -1 }),
    duelA: store.get("duelA", null),
    duelB: store.get("duelB", null),
  };

  // ---------- dados ----------
  function filteredMatches() {
    const cutoff = state.period === "all" ? 0 : Date.now() - Number(state.period) * 86400e3;
    return HUB.matches.filter((m) => (state.src === "all" || m.src === state.src) && new Date(m.t).getTime() >= cutoff);
  }

  function aggregate(lines) {
    const n = lines.length;
    const s = { w: 0, k: 0, d: 0, a: 0, dmg: 0, r: 0, hs: 0, lr: 0, m3: 0, m4: 0, m5: 0, surv: 0 };
    for (const x of lines) {
      if (x.w > 0) s.w++;
      s.k += x.k; s.d += x.d; s.a += x.a; s.dmg += x.dmg; s.r += x.r; s.hs += x.hs;
      s.lr += x.lr || 0; s.m3 += x.m3; s.m4 += x.m4; s.m5 += x.m5; s.surv += x.surv || 0;
    }
    return {
      n,
      wr: n ? s.w / n : 0,
      kd: s.d ? s.k / s.d : s.k,
      adr: s.r ? s.dmg / s.r : 0,
      hs: s.k ? s.hs / s.k : 0,
      lr: n ? s.lr / n : 0,
      kpr: s.r ? s.k / s.r : 0,
      surv: s.r ? s.surv / s.r : 0,
      multi: s.m3 + s.m4 + s.m5,
      m5: s.m5,
    };
  }

  function linesFor(id, matches) {
    const out = [];
    for (const m of matches) for (const p of m.p) if (p.id === id) out.push({ ...p, m });
    return out;
  }

  function table(ms) {
    return HUB.players.map((p) => ({ p, s: aggregate(linesFor(p.id, ms)) }));
  }

  // Títulos da zoeira: cada um vai para quem lidera (ou afunda) naquele quesito no filtro atual.
  const TITLES = [
    ["lr", 1, "Carregador oficial", false],
    ["lr", -1, "Vira-lata caramelo", true],
    ["hs", 1, "Mira de laser", false],
    ["hs", -1, "Mão de alface", true],
    ["adr", 1, "Britadeira", false],
    ["multi", 1, "Cachorro louco", false],
    ["surv", 1, "Mestre do baiting", true],
    ["wr", 1, "Pé quente", false],
    ["wr", -1, "Pé frio", true],
    ["n", 1, "Viciado", false],
    ["n", -1, "Turista", true],
  ];
  function titlesFor(rows) {
    const elig = rows.filter((r) => r.s.n >= MIN_GAMES);
    const out = new Map(rows.map((r) => [r.p.id, []]));
    if (elig.length < 2) return out;
    for (const [key, dir, label, meh] of TITLES) {
      const best = elig.reduce((a, b) => ((b.s[key] - a.s[key]) * dir > 0 ? b : a));
      const tie = elig.filter((r) => r.s[key] === best.s[key]).length > 1;
      if (!tie) out.get(best.p.id).push({ label, meh });
    }
    return out;
  }

  // ---------- formatação ----------
  const pct = (v) => (v * 100).toFixed(0) + "%";
  const f2 = (v) => v.toFixed(2);
  const f0 = (v) => v.toFixed(0);
  const rating = (v) => { const x = v * 100; return (x > 0 ? "+" : "") + x.toFixed(2); };
  const ratingCls = (v) => (v > 0 ? "pos-rating" : v < 0 ? "neg-rating" : "");
  const mapName = (m) => (m || "").replace(/^(de|cs)_/, "").replace(/^./, (c) => c.toUpperCase());
  const nick = (id) => byId.get(id)?.nick || "?";
  const srcBadge = (s) => `<span class="src ${esc(s)}">${esc(SRC_LABEL[s] || s)}</span>`;
  function when(t) {
    const d = new Date(t), diff = (Date.now() - d) / 3600e3;
    if (diff < 1) return "agora há pouco";
    if (diff < 24) return `há ${Math.floor(diff)}h`;
    if (diff < 48) return "ontem";
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  }
  const playerLink = (id) => `<a href="#jogador-${esc(id)}">${esc(nick(id))}</a>`;
  const empty = (msg) => `<div class="empty"><img src="assets/badge.png" alt="">${msg}</div>`;

  // ---------- filtros ----------
  function filtersHtml() {
    const order = ["all", "gc", "premier", "faceit", "competitive", "wingman"];
    const srcs = ["all", ...new Set(HUB.matches.map((m) => m.src))]
      .sort((a, b) => ((order.indexOf(a) + 99) % 99) - ((order.indexOf(b) + 99) % 99));
    return `<div class="filters" role="group" aria-label="Filtros">
      <div class="seg" data-f="src">${srcs.map((s) => `<button type="button" data-v="${s}" aria-pressed="${state.src === s}">${s === "all" ? "Tudo" : SRC_LABEL[s] || s}</button>`).join("")}</div>
      <div class="seg" data-f="period">${PERIODS.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${state.period === v}">${l}</button>`).join("")}</div>
    </div>`;
  }
  function bindFilters(root) {
    root.querySelectorAll(".seg").forEach((seg) => {
      seg.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        state[seg.dataset.f] = b.dataset.v; store.set(seg.dataset.f, b.dataset.v); render();
      });
    });
  }

  // ---------- Matilha (ranking) ----------
  const COLS = [
    ["lr", "Rating", (s) => `<span class="big ${ratingCls(s.lr)}">${rating(s.lr)}</span>`],
    ["n", "Partidas", (s) => s.n],
    ["wr", "Vitórias", (s) => pct(s.wr)],
    ["kd", "K/D", (s) => f2(s.kd)],
    ["adr", "ADR", (s) => f0(s.adr)],
    ["hs", "HS%", (s) => pct(s.hs)],
    ["multi", "3k+", (s) => s.multi],
    ["m5", "Aces", (s) => s.m5],
  ];

  function podiumHtml(rows) {
    const elig = rows.filter((r) => r.s.n >= MIN_GAMES).sort((a, b) => b.s.lr - a.s.lr);
    if (elig.length < 3) return "";
    const [p1, p2, p3] = elig;
    const last = elig[elig.length - 1];
    const step = (r, cls, place, title) => `<a class="step ${cls}" href="#jogador-${esc(r.p.id)}">
        ${cls === "p1" ? `<img class="crown" src="assets/badge.png" alt="">` : ""}
        <span class="who">${esc(r.p.nick)}</span>
        <span class="title">${title}</span>
        <span class="r ${ratingCls(r.s.lr)}">${rating(r.s.lr)}</span>
        <span class="block" aria-label="${place}º lugar">${place}</span></a>`;
    return `<section class="section"><h2>Pódio da matilha<small>Rating médio, mínimo de ${MIN_GAMES} partidas no filtro.</small></h2>
      <div><div class="podium">${step(p2, "p2", 2, "Vice-alfa")}${step(p1, "p1", 1, "Cão alfa")}${step(p3, "p3", 3, "Bronze honesto")}</div><div class="podium-base"></div></div>
      ${elig.length > 3 ? `<p class="lanterna">Lanterna: <b>${esc(last.p.nick)}</b> (${rating(last.s.lr)}). Força, guerreiro.</p>` : ""}
    </section>`;
  }

  function viewRanking() {
    const ms = filteredMatches();
    const rows = table(ms);
    const titles = titlesFor(rows);
    const active = rows.filter((r) => r.s.n > 0);
    const { key, dir } = state.sort;
    active.sort((a, b) => (b.s[key] - a.s[key]) * -dir || b.s.n - a.s.n);
    const inactive = rows.filter((r) => r.s.n === 0);
    const tag = (id) => { const t = titles.get(id)?.[0]; return t ? `<span class="tag">${esc(t.label)}</span>` : ""; };

    return `${filtersHtml()}
      ${podiumHtml(rows)}
      ${highlightsHtml(ms)}
      <section class="section">
        <h2>Tabela da matilha</h2>
        ${active.length ? `<div class="table-box"><table>
          <thead><tr><th class="pos">#</th><th class="name">Jogador</th>${COLS.map(([k, l]) =>
            `<th${key === k ? ` aria-sort="${dir < 0 ? "descending" : "ascending"}"` : ""}><button type="button" data-sort="${k}">${l}</button></th>`).join("")}</tr></thead>
          <tbody>${active.map((r, i) => `<tr class="${i === 0 ? "first" : i === active.length - 1 && active.length > 2 ? "last" : ""}"><td class="pos">${i + 1}</td><td class="name">${playerLink(r.p.id)}${tag(r.p.id)}</td>${COLS.map(([, , fmt]) => `<td>${fmt(r.s)}</td>`).join("")}</tr>`).join("")}</tbody>
        </table></div>` : empty("Ninguém jogou nesse filtro. A matilha tá dormindo.")}
        ${inactive.length ? `<p class="note">Sumidos nesse filtro: ${inactive.map((r) => esc(r.p.nick)).join(", ")}.</p>` : ""}
        <p class="note">Rating é o Leetify Rating médio por partida. Toque no nome da coluna para ordenar.</p>
      </section>`;
  }

  function highlightsHtml(ms) {
    const all = [];
    for (const m of ms) for (const p of m.p) all.push({ ...p, m });
    if (!all.length) return "";
    const max = (f) => all.reduce((a, b) => (f(b) > f(a) ? b : a));
    const best = max((x) => x.lr), worst = max((x) => -x.lr), kills = max((x) => x.k), adr = max((x) => x.dmg / x.r);
    const ace = all.filter((x) => x.m5 > 0)[0];
    const card = (label, x, what, cls = "") => `<a class="hl ${cls}" href="#jogador-${esc(x.id)}">
      <span class="label">${label}</span><span class="who">${esc(nick(x.id))}</span>
      <span class="what">${what} · ${esc(mapName(x.m.map))} · ${when(x.m.t)}</span></a>`;
    return `<section class="section"><h2>Destaques<small>As melhores e as piores do período.</small></h2><div class="highlights">
      ${card("Pai da partida", best, `rating ${rating(best.lr)}, ${best.k}/${best.d}`)}
      ${card("Fominha", kills, `${kills.k} kills em ${kills.r} rounds`)}
      ${card("Britadeira", adr, `${f0(adr.dmg / adr.r)} de ADR`)}
      ${ace ? card("Último ace", ace, `${ace.m5 > 1 ? ace.m5 + " aces" : "5 na conta"}, ${ace.k}/${ace.d}`) : ""}
      ${card("Bagre da rodada", worst, `rating ${rating(worst.lr)}, ${worst.k}/${worst.d}`, "bad")}
    </div></section>`;
  }

  // ---------- Partidas ----------
  function verdict(m) {
    if (m.p.length < 2) {
      const p = m.p[0];
      if (p.lr >= 0.06) return `<b>${esc(nick(p.id))}</b> amassou.`;
      if (p.lr <= -0.06) return `<b>${esc(nick(p.id))}</b> teve um dia difícil.`;
      return "";
    }
    const sorted = [...m.p].sort((a, b) => b.lr - a.lr);
    const top = sorted[0], low = sorted[sorted.length - 1];
    const win = top.w > 0;
    return win
      ? `Pai da partida: <b>${esc(nick(top.id))}</b>.${low.lr < -0.03 ? ` Passageiro: <b>${esc(nick(low.id))}</b>.` : ""}`
      : `Bagre: <b>${esc(nick(low.id))}</b>.${top.lr > 0.03 ? ` Tentou sozinho: <b>${esc(nick(top.id))}</b>.` : ""}`;
  }

  function matchCard(m, focusId) {
    const ref = focusId ? m.p.find((p) => p.id === focusId) : m.p[0];
    const res = ref.w > 0 ? "w" : ref.w < 0 ? "l" : "";
    const lines = [...m.p].sort((a, b) => b.lr - a.lr);
    const v = verdict(m);
    return `<article class="match ${res}">
      <div class="match-head"><span class="score">${ref.sc[0]}:${ref.sc[1]}</span><span class="map">${esc(mapName(m.map))}</span>${srcBadge(m.src)}<span class="when">${when(m.t)}</span></div>
      ${v ? `<p class="verdict">${v}</p>` : ""}
      <div class="lines">
        <div class="line"><span class="n lbl">&nbsp;</span><span class="lbl">K/D/A</span><span class="lbl">ADR</span><span class="lbl">HS%</span><span class="lbl">Rating</span></div>
        ${lines.map((p) => `<div class="line"><span class="n">${playerLink(p.id)}</span><span>${p.k}/${p.d}/${p.a}</span><span>${f0(p.dmg / p.r)}</span><span>${p.k ? pct(p.hs / p.k) : "–"}</span><span class="${ratingCls(p.lr)}">${rating(p.lr)}</span></div>`).join("")}
      </div></article>`;
  }

  function viewMatches() {
    const ms = filteredMatches();
    const shown = ms.slice(0, 60);
    return `${filtersHtml()}<section class="section"><h2>Partidas<small>Só aparecem os jogadores da matilha.</small></h2>
      ${shown.length ? `<div class="matches">${shown.map((m) => matchCard(m)).join("")}</div>` : empty("Nenhuma partida nesse filtro.")}
      ${ms.length > shown.length ? `<p class="note">Mostrando as ${shown.length} mais recentes de ${ms.length}.</p>` : ""}</section>`;
  }

  // ---------- Perfil ----------
  function sparkline(lines) {
    const pts = lines.slice(0, 30).reverse().map((l) => l.lr * 100);
    if (pts.length < 2) return "";
    const W = 600, H = 120, pad = 8;
    const max = Math.max(5, ...pts.map(Math.abs));
    const x = (i) => pad + (i * (W - 2 * pad)) / (pts.length - 1);
    const y = (v) => H / 2 - (v / max) * (H / 2 - pad);
    const d = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const last = pts.length - 1;
    return `<div class="spark-box"><h3>Rating nas últimas ${pts.length} partidas</h3>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Rating por partida">
        <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>
        <path d="${d}" fill="none" stroke="var(--yellow)" stroke-width="2" vector-effect="non-scaling-stroke"/>
        ${pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="${i === last ? 4.5 : 2.5}" fill="${v >= 0 ? "var(--win)" : "var(--loss)"}"/>`).join("")}
      </svg>
      <div class="spark-legend"><span>mais antiga</span><span>acima da linha = rating positivo</span><span>mais recente</span></div></div>`;
  }

  function viewPlayer(id) {
    const p = byId.get(id);
    if (!p) return empty(`Esse cachorro fugiu. <a href="#ranking">Voltar pra matilha</a>`);
    const ms = filteredMatches();
    const lines = linesFor(id, ms);
    const s = aggregate(lines);
    const titles = titlesFor(table(ms)).get(id) || [];
    const r = p.ranks || {};
    const rk = (cls, k, v) => (v ? `<div class="rank ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>` : "");

    const maps = new Map();
    for (const l of lines) { if (!maps.has(l.m.map)) maps.set(l.m.map, []); maps.get(l.m.map).push(l); }
    const mapRows = [...maps].map(([m, ls]) => ({ m, s: aggregate(ls) })).sort((a, b) => b.s.n - a.s.n);

    return `<section class="section player-head">
        <div><h2>${esc(p.nick)}</h2>${p.name && p.name !== p.nick ? `<div class="real">na Steam: ${esc(p.name)}</div>` : ""}</div>
        ${titles.length ? `<div class="chips">${titles.map((t) => `<span class="chip${t.meh ? " meh" : ""}">${esc(t.label)}</span>`).join("")}</div>` : ""}
        <div class="ranks">
          ${rk("premier", "Premier", r.premier ? r.premier.toLocaleString("pt-BR") : "")}
          ${rk("faceit", "FACEIT", r.faceit ? "Nível " + r.faceit + (r.faceit_elo ? ` · ${r.faceit_elo}` : "") : "")}
          ${rk("", "Mira (Leetify)", p.rating?.aim ? Math.round(p.rating.aim) : "")}
          ${rk("", "Utilitária", p.rating?.utility ? Math.round(p.rating.utility) : "")}
        </div>
      </section>
      ${filtersHtml()}
      ${s.n ? `<section class="section"><div class="stats-grid">
          ${[["Partidas", s.n], ["Vitórias", pct(s.wr)], ["Rating", rating(s.lr)], ["K/D", f2(s.kd)], ["ADR", f0(s.adr)], ["HS%", pct(s.hs)], ["3k+", s.multi], ["Aces", s.m5]]
            .map(([k, v]) => `<div class="stat"><span class="k">${k}</span><span class="v">${v}</span></div>`).join("")}
        </div></section>
        <section class="section">${sparkline(lines)}</section>
        <section class="section"><h2>Por mapa</h2><div class="table-box"><table>
          <thead><tr><th class="name">Mapa</th><th>Partidas</th><th>Vitórias</th><th>Rating</th><th>K/D</th><th>ADR</th></tr></thead>
          <tbody>${mapRows.map(({ m, s }) => `<tr><td class="name">${esc(mapName(m))}</td><td>${s.n}</td><td>${pct(s.wr)}</td><td class="${ratingCls(s.lr)}">${rating(s.lr)}</td><td>${f2(s.kd)}</td><td>${f0(s.adr)}</td></tr>`).join("")}</tbody>
        </table></div></section>
        <section class="section"><h2>Últimas partidas</h2><div class="matches">${lines.slice(0, 15).map((l) => matchCard(l.m, id)).join("")}</div></section>`
      : empty(`${esc(p.nick)} não jogou nada nesse filtro. Sumido.`)}`;
  }

  // ---------- Mano a mano ----------
  function viewDuel() {
    const ids = HUB.players.map((p) => p.id);
    if (!ids.includes(state.duelA)) state.duelA = ids[0];
    if (!ids.includes(state.duelB) || state.duelB === state.duelA) state.duelB = ids.find((i) => i !== state.duelA) || ids[0];
    const ms = filteredMatches();
    const A = aggregate(linesFor(state.duelA, ms)), B = aggregate(linesFor(state.duelB, ms));
    const opts = (sel) => HUB.players.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? " selected" : ""}>${esc(p.nick)}</option>`).join("");

    const metrics = [["Rating", "lr", rating], ["Vitórias", "wr", pct], ["K/D", "kd", f2], ["ADR", "adr", f0], ["HS%", "hs", pct], ["Kills/round", "kpr", f2], ["3k+", "multi", (v) => v], ["Partidas", "n", (v) => v]];
    let winsA = 0, winsB = 0;
    const row = ([label, k, fmt]) => {
      const a = A[k], b = B[k];
      if (a > b) winsA++; else if (b > a) winsB++;
      const lo = Math.min(a, b, 0), hi = Math.max(a, b);
      const w = (v) => (hi - lo ? Math.max(4, ((v - lo) / (hi - lo)) * 100) : 50);
      return `<div class="drow">
        <div class="side a${a > b ? " lead" : ""}"><span class="val">${fmt(a)}</span><div class="bar"><i style="width:${w(a)}%"></i></div></div>
        <div class="k">${label}</div>
        <div class="side b${b > a ? " lead" : ""}"><span class="val">${fmt(b)}</span><div class="bar"><i style="width:${w(b)}%"></i></div></div></div>`;
    };
    const rowsHtml = metrics.map(row).join("");
    const nA = esc(nick(state.duelA)), nB = esc(nick(state.duelB));
    const total = metrics.length;
    const verdictTxt = winsA === winsB ? "Empate técnico. Resolvam no x1."
      : winsA > winsB ? `${nA} leva em ${winsA} de ${total} quesitos.${winsA >= total - 1 ? " Atropelo." : ""}`
      : `${nB} leva em ${winsB} de ${total} quesitos.${winsB >= total - 1 ? " Atropelo." : ""}`;

    const both = ms.filter((m) => m.p.some((p) => p.id === state.duelA) && m.p.some((p) => p.id === state.duelB));
    const sameTeam = both.filter((m) => m.p.find((p) => p.id === state.duelA).team === m.p.find((p) => p.id === state.duelB).team);
    let aBetter = 0, bBetter = 0, wins = 0;
    for (const m of sameTeam) {
      const pa = m.p.find((p) => p.id === state.duelA), pb = m.p.find((p) => p.id === state.duelB);
      if (pa.lr > pb.lr) aBetter++; else if (pb.lr > pa.lr) bBetter++;
      if (pa.w > 0) wins++;
    }

    return `${filtersHtml()}
      <section class="section"><h2>Mano a mano</h2>
        <div class="duel-pick"><select id="duelA" aria-label="Jogador 1">${opts(state.duelA)}</select><span class="vs">VS</span><select id="duelB" aria-label="Jogador 2">${opts(state.duelB)}</select></div>
        ${A.n || B.n ? `<p class="duel-verdict">${verdictTxt}</p><div class="duel">${rowsHtml}</div>` : empty("Nenhum dos dois jogou nesse filtro.")}
      </section>
      <section class="section"><h2>Quem carrega quem<small>Partidas em que os dois estavam no mesmo time.</small></h2>
        ${sameTeam.length ? `<div class="together">
          <div class="stat"><span class="k">Partidas juntos</span><span class="v">${sameTeam.length}</span></div>
          <div class="stat"><span class="k">Vitórias juntos</span><span class="v">${pct(wins / sameTeam.length)}</span></div>
          <div class="stat"><span class="k">${nA} carregou</span><span class="v">${aBetter}×</span></div>
          <div class="stat"><span class="k">${nB} carregou</span><span class="v">${bBetter}×</span></div>
        </div><p class="note">"Carregou" é quando um teve rating maior que o outro na mesma partida.</p>`
        : empty("Esses dois não jogaram juntos nesse filtro.")}
      </section>`;
  }

  // ---------- roteamento ----------
  function route() {
    const h = location.hash.replace(/^#/, "");
    if (h.startsWith("jogador-")) return ["jogador", h.slice(8)];
    if (["partidas", "duelo"].includes(h)) return [h];
    return ["ranking"];
  }

  function render() {
    const [view, arg] = route();
    document.querySelectorAll("nav.tabs a").forEach((a) => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const main = $("#main");
    const demo = HUB.demo ? `<div class="demo-banner"><b>Prévia com dados de exemplo.</b> Os números são inventados. Quando o coletor rodar, entram as partidas de verdade do Leetify.</div>` : "";
    main.innerHTML = demo + (view === "jogador" ? viewPlayer(arg) : view === "partidas" ? viewMatches() : view === "duelo" ? viewDuel() : viewRanking());
    bindFilters(main);
    main.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
      const k = b.dataset.sort;
      state.sort = state.sort.key === k ? { key: k, dir: -state.sort.dir } : { key: k, dir: -1 };
      store.set("sort", state.sort); render();
    }));
    ["duelA", "duelB"].forEach((k) => {
      const el = $("#" + k, main);
      if (el) el.addEventListener("change", () => { state[k] = el.value; store.set(k, el.value); render(); });
    });
  }

  async function boot() {
    try {
      HUB = window.HUB_DATA || (await (await fetch("data/hub.json", { cache: "no-store" })).json());
    } catch {
      $("#main").innerHTML = empty("Ainda não tem partida aqui. O coletor roda a cada 3 horas; depois da primeira coleta, a matilha aparece.");
      return;
    }
    byId = new Map(HUB.players.map((p) => [p.id, p]));
    const up = new Date(HUB.updated_at);
    $("#updated").textContent = isNaN(up) ? "" : "Atualizado " + up.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });
    render();
  }
  boot();
})();

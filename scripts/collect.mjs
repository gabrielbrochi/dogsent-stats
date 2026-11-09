// Coletor do CS Hub: busca perfis e partidas no Leetify e acumula tudo em data/.
// Roda com: node scripts/collect.mjs
// Variáveis opcionais:
//   LEETIFY_API_KEY   chave da API pública do Leetify (aumenta o limite de uso)
//   LEETIFY_BASE_URL  troca o endereço da API (usado nos testes)
//   MAX_NEW_MATCHES   máximo de partidas novas por execução (padrão 200)

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.LEETIFY_BASE_URL || "https://api-public.cs-prod.leetify.com").replace(/\/$/, "");
const KEY = process.env.LEETIFY_API_KEY || "";
const MAX_NEW = Number(process.env.MAX_NEW_MATCHES || 200);
const DELAY_MS = Number(process.env.REQUEST_DELAY_MS ?? 600);

const DIR_MATCHES = path.join(ROOT, "data", "matches");
const DIR_PROFILES = path.join(ROOT, "data", "profiles");
const HUB_FILE = path.join(ROOT, "docs", "data", "hub.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname) {
  const headers = { Accept: "application/json", "User-Agent": "cs-hub-collector" };
  if (KEY) {
    headers.Authorization = `Bearer ${KEY}`;
    headers._leetify_key = KEY;
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(BASE + pathname, { headers });
    if (res.ok) {
      await sleep(DELAY_MS);
      return res.json();
    }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status >= 500) {
      const wait = attempt * 5000;
      console.warn(`  ${res.status} em ${pathname}, tentando de novo em ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    throw new Error(`${res.status} ${res.statusText} em ${pathname}`);
  }
  throw new Error(`Desisti depois de 4 tentativas: ${pathname}`);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

const writeJson = (file, data, pretty = true) =>
  writeFile(file, JSON.stringify(data, null, pretty ? 2 : 0) + "\n");

// O Leetify usa "matchmaking" (Premier ou competitivo, separados pelo rank_type) e às vezes
// "matchmaking_competitive" / "matchmaking_wingman". Tudo vira um nome curto para o site.
function classifySource(dataSource, rankType) {
  const s = String(dataSource || "");
  if (s === "gamers_club" || s === "gc") return "gc";
  if (s === "faceit") return "faceit";
  if (s === "premier" || s === "matchmaking_premier") return "premier";
  if (s === "competitive" || s === "matchmaking_competitive") return "competitive";
  if (s === "wingman" || s === "matchmaking_wingman") return "wingman";
  if (s === "matchmaking") {
    if (rankType === 11) return "premier";
    if (rankType === 7) return "wingman";
    return "competitive";
  }
  return s || "outro";
}

// Aceita steam64 direto, link /profiles/<id> ou link /id/<apelido>. Guarda o resultado em cache.
const STEAM_CACHE = path.join(ROOT, "data", "steam-ids.json");
async function resolvePlayers(players) {
  const cache = await readJson(STEAM_CACHE, {});
  const out = [];
  for (const p of players) {
    let id = p.steam64 || null;
    const url = (p.steam || "").trim();
    if (!id && /\/profiles\/(\d{17})/.test(url)) id = url.match(/\/profiles\/(\d{17})/)[1];
    if (!id && cache[url]) id = cache[url];
    const vanity = url.match(/\/id\/([^/?#]+)/)?.[1];
    if (!id && vanity) {
      try {
        const res = await fetch(`https://steamcommunity.com/id/${encodeURIComponent(vanity)}/?xml=1`, {
          headers: { "User-Agent": "cs-hub-collector" },
        });
        id = (await res.text()).match(/<steamID64>(\d{17})<\/steamID64>/)?.[1] || null;
        if (id) cache[url] = id;
        await sleep(500);
      } catch (err) {
        console.warn(`  não consegui ler a Steam de ${p.apelido}: ${err.message}`);
      }
    }
    if (!id) {
      console.warn(`Pulando ${p.apelido}: não achei o Steam64 (confira o link em players.json)`);
      continue;
    }
    out.push({ ...p, steam64: id });
  }
  await writeJson(STEAM_CACHE, cache);
  return out;
}

async function main() {
  await mkdir(DIR_MATCHES, { recursive: true });
  await mkdir(DIR_PROFILES, { recursive: true });
  await mkdir(path.dirname(HUB_FILE), { recursive: true });

  const players = await resolvePlayers(await readJson(path.join(ROOT, "players.json"), []));
  if (!players.length) throw new Error("players.json está vazio");

  const known = new Set((await readdir(DIR_MATCHES)).map((f) => f.replace(/\.json$/, "")));
  const pending = new Map(); // id -> info do perfil (rank, rank_type...)

  // 1. Perfis
  for (const p of players) {
    console.log(`Perfil ${p.apelido} (${p.steam64})`);
    let profile;
    try {
      profile = await api(`/v3/profile?steam64_id=${p.steam64}`);
    } catch (err) {
      console.warn(`  falhou: ${err.message}`);
      continue;
    }
    if (!profile) {
      console.warn("  perfil não encontrado no Leetify (talvez privado ou sem conta)");
      continue;
    }
    await writeJson(path.join(DIR_PROFILES, `${p.steam64}.json`), profile);
    for (const m of profile.recent_matches || []) {
      if (!known.has(m.id) && !pending.has(m.id)) pending.set(m.id, m);
    }
  }

  // 2. Partidas novas (mais antigas primeiro, para o histórico ficar em ordem se o limite cortar)
  const queue = [...pending.values()]
    .sort((a, b) => new Date(a.finished_at) - new Date(b.finished_at))
    .slice(-MAX_NEW);
  console.log(`${pending.size} partidas novas encontradas, buscando ${queue.length}`);

  let saved = 0;
  for (const m of queue) {
    try {
      const detail = await api(`/v2/matches/${m.id}`);
      if (!detail) continue;
      detail._hub = {
        source: classifySource(m.data_source || detail.data_source, m.rank_type),
        rank_type: m.rank_type ?? null,
        collected_at: new Date().toISOString(),
      };
      await writeJson(path.join(DIR_MATCHES, `${m.id}.json`), detail, false);
      saved++;
    } catch (err) {
      console.warn(`  partida ${m.id} falhou: ${err.message}`);
    }
  }
  console.log(`${saved} partidas salvas`);

  await buildHub(players);
}

// Gera o arquivo único e compacto que o site lê.
export async function buildHub(players) {
  players ??= await readJson(path.join(ROOT, "players.json"), []);
  const tracked = new Map(players.map((p) => [p.steam64, p]));

  const hubPlayers = [];
  for (const p of players) {
    const prof = await readJson(path.join(DIR_PROFILES, `${p.steam64}.json`), null);
    hubPlayers.push({
      id: p.steam64,
      nick: p.apelido,
      name: prof?.name || p.apelido,
      ranks: prof?.ranks || null,
      rating: prof?.rating || null,
      total_matches: prof?.total_matches ?? null,
      winrate: prof?.winrate ?? null,
    });
  }

  const files = existsSync(DIR_MATCHES) ? await readdir(DIR_MATCHES) : [];
  const matches = [];
  for (const f of files) {
    const d = await readJson(path.join(DIR_MATCHES, f), null);
    if (!d?.stats) continue;
    const ours = d.stats.filter((s) => tracked.has(s.steam64_id));
    if (!ours.length) continue;
    const scoreByTeam = Object.fromEntries((d.team_scores || []).map((t) => [t.team_number, t.score]));
    matches.push({
      id: d.id,
      t: d.finished_at,
      src: classifySource(d._hub?.source || d.data_source, d._hub?.rank_type ?? null),
      map: d.map_name,
      ban: d.has_banned_player || false,
      p: ours.map((s) => {
        const team = s.initial_team_number;
        const other = Object.keys(scoreByTeam).find((k) => Number(k) !== team);
        return {
          id: s.steam64_id,
          team,
          sc: [scoreByTeam[team] ?? s.rounds_won, other ? scoreByTeam[other] : s.rounds_lost],
          k: s.total_kills,
          d: s.total_deaths,
          a: s.total_assists,
          dmg: s.total_damage,
          r: s.rounds_count,
          hs: s.total_hs_kills,
          lr: round(s.leetify_rating, 4),
          ct: round(s.ct_leetify_rating, 4),
          tr: round(s.t_leetify_rating, 4),
          mvp: s.mvps,
          m2: s.multi2k,
          m3: s.multi3k,
          m4: s.multi4k,
          m5: s.multi5k,
          fa: s.flash_assist,
          tk: s.trade_kills_succeed,
          surv: s.rounds_survived,
          aim: round(s.accuracy_enemy_spotted, 4),
          ttd: round(s.reaction_time, 3),
          pre: round(s.preaim, 2),
          he: round(s.he_foes_damage_avg, 1),
          w: s.rounds_won > s.rounds_lost ? 1 : s.rounds_won < s.rounds_lost ? -1 : 0,
        };
      }),
    });
  }
  matches.sort((a, b) => new Date(b.t) - new Date(a.t));

  await writeJson(HUB_FILE, { updated_at: new Date().toISOString(), players: hubPlayers, matches }, false);
  console.log(`hub.json: ${hubPlayers.length} jogadores, ${matches.length} partidas`);
}

const round = (n, dp) => (typeof n === "number" ? Number(n.toFixed(dp)) : null);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

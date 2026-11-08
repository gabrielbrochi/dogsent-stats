// API falsa no formato do Leetify, só para testar o coletor e o site sem internet.
// Uso: node scripts/mock-api.mjs [porta]
import http from "node:http";

const PORT = Number(process.argv[2] || 8787);

// Gerador pseudoaleatório determinístico
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);

const players = [
  { id: "76561198306330610", name: "broqi", skill: 1.25 },
  { id: "76561100000000001", name: "kaze", skill: 1.1 },
  { id: "76561100000000002", name: "tuts", skill: 0.95 },
  { id: "76561100000000003", name: "mlkdoido", skill: 0.85 },
  { id: "76561100000000004", name: "zinho", skill: 1.0 },
];
const maps = ["de_mirage", "de_inferno", "de_nuke", "de_ancient", "de_anubis", "de_dust2", "de_train"];
const sources = [
  ["gamers_club", null],
  ["matchmaking", 11],
  ["faceit", null],
  ["matchmaking", 12],
];

const matches = new Map();
const profileMatches = new Map(players.map((p) => [p.id, []]));

function playerStats(p, rounds, won, lost, team) {
  const k = Math.max(2, Math.round(rounds * 0.72 * p.skill * between(0.55, 1.45)));
  const d = Math.max(3, Math.round(rounds * 0.68 / p.skill * between(0.65, 1.3)));
  const dmg = Math.round(k * between(85, 110) + between(0, 300));
  const hs = Math.round(k * between(0.3, 0.7));
  const m3 = rnd() < 0.35 * p.skill ? 1 + Math.floor(rnd() * 2) : 0;
  const m4 = rnd() < 0.12 * p.skill ? 1 : 0;
  const m5 = rnd() < 0.03 * p.skill ? 1 : 0;
  const lr = (k - d) / rounds * 0.12 + between(-0.04, 0.04);
  return {
    steam64_id: p.id, name: p.name, mvps: Math.round(between(0, 5)), preaim: between(6, 12),
    reaction_time: between(0.45, 0.7), accuracy: between(0.12, 0.22), accuracy_enemy_spotted: between(0.28, 0.45),
    accuracy_head: between(0.15, 0.3), shots_fired: 300, shots_hit_foe: 50, he_foes_damage_avg: between(5, 35),
    flash_assist: Math.round(between(0, 4)), score: k * 2, initial_team_number: team, spray_accuracy: between(0.2, 0.5),
    total_kills: k, total_deaths: d, kd_ratio: +(k / d).toFixed(2), rounds_survived: Math.max(0, rounds - d),
    dpr: dmg / rounds, total_assists: Math.round(between(1, 8)), total_damage: dmg, leetify_rating: lr,
    ct_leetify_rating: lr + between(-0.03, 0.03), t_leetify_rating: lr + between(-0.03, 0.03),
    multi1k: 5, multi2k: Math.round(between(1, 6)), multi3k: m3, multi4k: m4, multi5k: m5,
    rounds_count: rounds, rounds_won: won, rounds_lost: lost, total_hs_kills: hs,
    trade_kills_succeed: Math.round(between(0, 5)),
  };
}

const now = Date.now();
for (let i = 0; i < 140; i++) {
  const [ds, rt] = pick(sources);
  const map = pick(maps);
  const t = new Date(now - i * 9 * 3600e3 - between(0, 4) * 3600e3).toISOString();
  const squad = players.filter((p, idx) => idx === 0 ? rnd() < 0.8 : rnd() < 0.55);
  if (!squad.length) squad.push(players[0]);
  const win = rnd() < 0.55;
  const loserScore = Math.floor(between(2, 12));
  const ot = rnd() < 0.08;
  const a = ot ? 16 : 13, b = ot ? 14 : loserScore;
  const our = win ? a : b, their = win ? b : a;
  const rounds = our + their;
  const id = `mock-${String(i).padStart(4, "0")}-${map}`;
  matches.set(id, {
    id, finished_at: t, data_source: ds, map_name: map, has_banned_player: false,
    team_scores: [{ team_number: 2, score: our }, { team_number: 3, score: their }],
    stats: squad.map((p) => playerStats(p, rounds, our, their, 2)),
  });
  for (const p of squad) {
    profileMatches.get(p.id).push({
      id, finished_at: t, data_source: ds, outcome: win ? "win" : "loss", rank: 0, rank_type: rt,
      map_name: map, leetify_rating: 0, score: [our, their],
    });
  }
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    let body = null;
    if (url.pathname === "/v3/profile") {
      const p = players.find((x) => x.id === url.searchParams.get("steam64_id"));
      if (p) {
        body = {
          privacy_mode: "public", winrate: 0.55, total_matches: 900 + Math.round(p.skill * 400),
          first_match_date: "2021-01-02", name: p.name, bans: [], steam64_id: p.id, id: "x",
          ranks: { leetify: +(p.skill * 6).toFixed(2), premier: Math.round(p.skill * 20000), faceit: Math.min(10, Math.round(p.skill * 8)), faceit_elo: null, wingman: null, renown: null, competitive: [] },
          rating: { aim: Math.round(p.skill * 70), positioning: Math.round(p.skill * 60), utility: Math.round(between(40, 70)), clutch: 0.1, opening: 0.05, ct_leetify: 0.05, t_leetify: 0.05 },
          stats: {}, recent_matches: profileMatches.get(p.id).slice(0, 100), recent_teammates: [],
        };
      }
    } else if (url.pathname.startsWith("/v2/matches/")) {
      body = matches.get(decodeURIComponent(url.pathname.split("/").pop())) || null;
    }
    res.writeHead(body ? 200 : 404, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify(body ?? { error: "not found" }));
  })
  .listen(PORT, () => console.log(`API falsa em http://localhost:${PORT}`));

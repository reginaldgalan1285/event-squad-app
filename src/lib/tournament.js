// Round robin via the standard "circle method": fix one team, rotate the
// rest each round. If the team count is odd, a null "bye" seat is added —
// whoever draws it sits out that round.
export function generateRoundRobin(teamIds) {
  let arr = [...teamIds];
  if (arr.length % 2 !== 0) arr.push(null);

  const n = arr.length;
  const rounds = n - 1;
  const half = n / 2;
  const matches = [];

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== null && b !== null) {
        matches.push({ round: r + 1, matchIndex: i, team1: a, team2: b, isBye: false });
      } else {
        const solo = a !== null ? a : b;
        if (solo !== null) {
          matches.push({ round: r + 1, matchIndex: i, team1: solo, team2: null, isBye: true });
        }
      }
    }
    // Rotate everyone except the fixed first seat.
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }

  return matches;
}

function nextPowerOfTwo(n) {
  return Math.pow(2, Math.ceil(Math.log2(Math.max(n, 1))));
}

// Standard bracket seeding order (the same pattern tournament brackets
// use, e.g. 1v8, 4v5, 2v7, 3v6 for a field of 8) — this is what makes
// byes land on the top seeds and spread out, instead of stacking
// multiple byes onto one team when the field isn't a power of two.
function seedOrder(size) {
  let seeds = [1];
  while (seeds.length < size) {
    const n = seeds.length * 2;
    const next = [];
    for (const s of seeds) next.push(s, n + 1 - s);
    seeds = next;
  }
  return seeds;
}

// Builds a single-elimination bracket skeleton: round 1 has real teams
// seeded in standard bracket order (padded with byes up to the next
// power of two), every later round is empty placeholder matches
// waiting for winners to advance into them. Team order given is
// treated as seed order (first team = top seed). Returns a flat list;
// round r's match at matchIndex i feeds into round r+1's match at
// matchIndex floor(i/2), slot (i % 2) + 1 — the caller links these
// ids after inserting rows into the database.
export function buildBracketSkeleton(teamIds) {
  const size = nextPowerOfTwo(teamIds.length);
  const order = seedOrder(size);
  const slots = order.map((seed) => (seed <= teamIds.length ? teamIds[seed - 1] : null));

  const totalRounds = Math.log2(size);
  const matches = [];

  for (let i = 0; i < size / 2; i++) {
    const team1 = slots[i * 2];
    const team2 = slots[i * 2 + 1];
    matches.push({
      round: 1,
      matchIndex: i,
      team1,
      team2,
      isBye: !team1 || !team2,
    });
  }

  let count = size / 2;
  for (let r = 2; r <= totalRounds; r++) {
    count = count / 2;
    for (let i = 0; i < count; i++) {
      matches.push({ round: r, matchIndex: i, team1: null, team2: null, isBye: false });
    }
  }

  return matches;
}

// Names a bracket round based on how many rounds remain until the final —
// e.g. with 3 total rounds: round 1 = Quarterfinals, round 2 = Semifinals,
// round 3 = Final. Falls back to "Round of N" for anything bigger.
export function roundLabel(roundNumber, totalRounds) {
  const fromEnd = totalRounds - roundNumber;
  if (fromEnd === 0) return "FINAL";
  if (fromEnd === 1) return "SEMIFINALS";
  if (fromEnd === 2) return "QUARTERFINALS";
  const teamsInRound = Math.pow(2, fromEnd + 1);
  return `ROUND OF ${teamsInRound}`;
}

function pairKey(a, b) {
  return [a, b].sort().join("|");
}
function teamPairKey(teamA, teamB) {
  return [[...teamA].sort().join(","), [...teamB].sort().join(",")].sort().join("|");
}

// Generates ONE open-play round: dynamically pairs players (doubles) or
// matches them directly (singles). Players with fewer games played so
// far are prioritized for inclusion — this is what lets a latecomer
// catch up to everyone else's total over subsequent rounds. Repeat
// partners/opponents are avoided where possible, but with small groups
// or many rounds a repeat is sometimes unavoidable — this is a fairness
// heuristic, not a mathematically perfect covering design.
export function generateOpenPlayRound({ players, matchType, gamesPlayed, pastPartners, pastOpponents }) {
  const sorted = [...players].sort((a, b) => (gamesPlayed[a] || 0) - (gamesPlayed[b] || 0));

  if (matchType === "singles") {
    const used = new Set();
    const matches = [];
    for (const p of sorted) {
      if (used.has(p)) continue;
      let opp = sorted.find((o) => o !== p && !used.has(o) && !pastOpponents.has(pairKey(p, o)));
      if (!opp) opp = sorted.find((o) => o !== p && !used.has(o));
      if (opp) {
        used.add(p); used.add(opp);
        matches.push({ team1: [p], team2: [opp] });
      }
    }
    return { matches, sitOut: sorted.filter((p) => !used.has(p)) };
  }

  // Doubles: form partnerships first, then match partnerships against each other.
  const usedForPartner = new Set();
  const partnerships = [];
  for (const p of sorted) {
    if (usedForPartner.has(p)) continue;
    let partner = sorted.find((o) => o !== p && !usedForPartner.has(o) && !pastPartners.has(pairKey(p, o)));
    if (!partner) partner = sorted.find((o) => o !== p && !usedForPartner.has(o));
    if (partner) {
      usedForPartner.add(p); usedForPartner.add(partner);
      partnerships.push([p, partner]);
    }
  }
  const sitOutFromPartner = sorted.filter((p) => !usedForPartner.has(p));

  const usedForMatch = new Set();
  const matches = [];
  for (let i = 0; i < partnerships.length; i++) {
    const teamA = partnerships[i];
    const keyA = teamA.join(",");
    if (usedForMatch.has(keyA)) continue;
    let bestJ = -1;
    for (let j = i + 1; j < partnerships.length; j++) {
      const teamB = partnerships[j];
      const keyB = teamB.join(",");
      if (usedForMatch.has(keyB)) continue;
      if (bestJ === -1) bestJ = j;
      if (!pastOpponents.has(teamPairKey(teamA, teamB))) { bestJ = j; break; }
    }
    if (bestJ !== -1) {
      usedForMatch.add(keyA);
      usedForMatch.add(partnerships[bestJ].join(","));
      matches.push({ team1: teamA, team2: partnerships[bestJ] });
    }
  }
  const matchedPlayers = new Set(matches.flatMap((m) => [...m.team1, ...m.team2]));
  const sitOut = [...sitOutFromPartner, ...partnerships.flat().filter((p) => !matchedPlayers.has(p))];

  return { matches, sitOut };
}

// Rebuilds per-player games-played counts and the sets of past
// partnerships/opponent-team pairings from every match played so far,
// in the exact shape generateOpenPlayRound expects. Called fresh every
// time rounds are generated — the very first generation, after a
// latecomer joins mid-session, or "generate more rounds" once earlier
// ones are finished — so rotation always continues fairly from
// wherever the session actually is, with no separate state to track.
export function buildOpenPlayHistory(matches, teamsById) {
  const gamesPlayed = {};
  const pastPartners = new Set();
  const pastOpponents = new Set();

  function resolvePlayers(teamId) {
    const t = teamsById[teamId];
    if (!t || !t.player1_id) return [];
    return [t.player1_id, t.player2_id].filter(Boolean);
  }

  for (const m of matches) {
    if (!m.team1_id || !m.team2_id) continue;
    const p1s = resolvePlayers(m.team1_id);
    const p2s = resolvePlayers(m.team2_id);
    if (p1s.length === 2) pastPartners.add(pairKey(p1s[0], p1s[1]));
    if (p2s.length === 2) pastPartners.add(pairKey(p2s[0], p2s[1]));
    if (p1s.length && p2s.length) pastOpponents.add(teamPairKey(p1s, p2s));
    [...p1s, ...p2s].forEach((p) => { gamesPlayed[p] = (gamesPlayed[p] || 0) + 1; });
  }

  return { gamesPlayed, pastPartners, pastOpponents };
}

// Aggregates match results by individual PLAYER rather than by team —
// needed for open-play mode, where the same person gets a brand new
// "team" row every round (paired with someone different each time).
export function computePlayerStandings(players, teams, matches) {
  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const stats = Object.fromEntries(
    players.map((p) => [p.id, { player: p, played: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }])
  );

  function creditTeam(teamId, won, lost, tied, pf, pa) {
    const team = teamsById[teamId];
    if (!team) return;
    for (const pid of [team.player1_id, team.player2_id]) {
      const s = stats[pid];
      if (!s) continue;
      s.played += 1;
      if (won) s.wins += 1;
      if (lost) s.losses += 1;
      if (tied) s.ties += 1;
      if (pf != null && pa != null) { s.pointsFor += pf; s.pointsAgainst += pa; }
    }
  }

  for (const m of matches) {
    if (m.status !== "completed" || !m.team1_id || !m.team2_id) continue;
    const t1Won = m.winner_team_id === m.team1_id;
    const t2Won = m.winner_team_id === m.team2_id;
    creditTeam(m.team1_id, t1Won, t2Won, m.is_tie, m.team1_score, m.team2_score);
    creditTeam(m.team2_id, t2Won, t1Won, m.is_tie, m.team2_score, m.team1_score);
  }

  return Object.values(stats)
    .map((s) => ({
      ...s,
      winPct: s.played > 0 ? (s.wins + 0.5 * s.ties) / s.played : 0,
      pointDiff: s.pointsFor - s.pointsAgainst,
    }))
    .sort((a, b) => b.wins - a.wins || b.pointDiff - a.pointDiff);
}

// Standings for round robin: wins/losses/ties, win %, and point
// differential. Ties on wins are broken properly, not by overall
// point differential alone:
//  - exactly 2 teams tied -> head-to-head result between just those two
//  - 3+ teams tied -> a "mini-league" using only the matches those tied
//    teams played against EACH OTHER (wins, then point differential
//    scoped to that subgroup) — a team's results against everyone
//    else in the tournament never factor into this tiebreak.
// Each row's `tiebreakNote` explains what broke the tie, for display.
export function computeStandings(teams, matches) {
  const stats = Object.fromEntries(
    teams.map((t) => [t.id, { team: t, played: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }])
  );

  const completed = matches.filter((m) => m.status === "completed" && m.team1_id && m.team2_id);

  for (const m of completed) {
    const s1 = stats[m.team1_id];
    const s2 = stats[m.team2_id];
    if (!s1 || !s2) continue;

    s1.played += 1;
    s2.played += 1;

    if (m.is_tie) {
      s1.ties += 1;
      s2.ties += 1;
    } else if (m.winner_team_id === m.team1_id) {
      s1.wins += 1;
      s2.losses += 1;
    } else if (m.winner_team_id === m.team2_id) {
      s2.wins += 1;
      s1.losses += 1;
    }

    if (m.team1_score != null && m.team2_score != null) {
      s1.pointsFor += m.team1_score;
      s1.pointsAgainst += m.team2_score;
      s2.pointsFor += m.team2_score;
      s2.pointsAgainst += m.team1_score;
    }
  }

  const rows = Object.values(stats).map((s) => ({
    ...s,
    winPct: s.played > 0 ? (s.wins + 0.5 * s.ties) / s.played : 0,
    pointDiff: s.pointsFor - s.pointsAgainst,
    tiebreakNote: "",
  }));

  function matchBetween(idA, idB) {
    return completed.find(
      (m) => (m.team1_id === idA && m.team2_id === idB) || (m.team1_id === idB && m.team2_id === idA)
    );
  }

  const byWins = {};
  for (const r of rows) {
    (byWins[r.wins] ||= []).push(r);
  }

  const orderedGroups = [];
  for (const winsKey of Object.keys(byWins).map(Number).sort((a, b) => b - a)) {
    const group = byWins[winsKey];

    if (group.length === 1) {
      orderedGroups.push(group);
      continue;
    }

    if (group.length === 2) {
      const [a, b] = group;
      const h2h = matchBetween(a.team.id, b.team.id);
      if (h2h && !h2h.is_tie && h2h.winner_team_id) {
        const winner = h2h.winner_team_id === a.team.id ? a : b;
        const loser = winner === a ? b : a;
        winner.tiebreakNote = `Beat ${loser.team.name}`;
        loser.tiebreakNote = `Lost to ${winner.team.name}`;
        orderedGroups.push([winner, loser]);
      } else {
        if (h2h && h2h.is_tie) {
          a.tiebreakNote = "Tied H2H";
          b.tiebreakNote = "Tied H2H";
        }
        orderedGroups.push([...group].sort((x, y) => y.pointDiff - x.pointDiff));
      }
      continue;
    }

    // 3+ tied on wins: mini-league using only matches among this group.
    const groupIds = new Set(group.map((g) => g.team.id));
    const mini = Object.fromEntries(group.map((g) => [g.team.id, { wins: 0, pointDiff: 0 }]));
    for (const m of completed) {
      if (!groupIds.has(m.team1_id) || !groupIds.has(m.team2_id)) continue;
      if (m.winner_team_id && mini[m.winner_team_id]) mini[m.winner_team_id].wins += 1;
      if (m.team1_score != null && m.team2_score != null) {
        mini[m.team1_id].pointDiff += m.team1_score - m.team2_score;
        mini[m.team2_id].pointDiff += m.team2_score - m.team1_score;
      }
    }
    for (const g of group) {
      const d = mini[g.team.id].pointDiff;
      g.tiebreakNote = `Group ${d > 0 ? "+" : ""}${d}`;
    }
    orderedGroups.push(
      [...group].sort((x, y) => {
        const mx = mini[x.team.id];
        const my = mini[y.team.id];
        return my.wins - mx.wins || my.pointDiff - mx.pointDiff || y.pointDiff - x.pointDiff;
      })
    );
  }

  return orderedGroups.flat();
}

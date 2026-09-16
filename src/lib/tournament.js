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

// Standings for round robin: wins/losses/ties, win %, and point
// differential — with tied win totals broken by point differential,
// exactly the tiebreak the standings table needs.
export function computeStandings(teams, matches) {
  const stats = Object.fromEntries(
    teams.map((t) => [t.id, { team: t, played: 0, wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 }])
  );

  for (const m of matches) {
    if (m.status !== "completed" || !m.team1_id || !m.team2_id) continue;
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
  }));

  rows.sort((a, b) => b.wins - a.wins || b.pointDiff - a.pointDiff || b.winPct - a.winPct);
  return rows;
}

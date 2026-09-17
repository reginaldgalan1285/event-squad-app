import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, Trophy, Play, X, Pencil } from "lucide-react";
import { supabase } from "../supabaseClient";
import { generateRoundRobin, buildBracketSkeleton, computeStandings, roundLabel } from "../lib/tournament";

function MatchTimer({ match }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (match.status !== "in_progress" || !match.started_at) return;
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [match.status, match.started_at]);

  if (match.status !== "in_progress" || !match.started_at) return null;

  const minutes = match.match_minutes || 15;
  const elapsedSec = (Date.now() - new Date(match.started_at).getTime()) / 1000;
  const remaining = Math.round(minutes * 60 - elapsedSec);
  const expired = remaining <= 0;
  const abs = Math.abs(remaining);
  const mm = String(Math.floor(abs / 60)).padStart(2, "0");
  const ss = String(abs % 60).padStart(2, "0");

  return (
    <span className={`timer-badge ${expired ? "expired" : ""}`}>
      {expired ? "-" : ""}{mm}:{ss}
    </span>
  );
}

export default function Tournament({ session }) {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTournamentId = searchParams.get("t");

  const [event, setEvent] = useState(null);
  const [tournamentsList, setTournamentsList] = useState([]);
  const [tournament, setTournament] = useState(null);
  const [teams, setTeams] = useState([]);
  const [courts, setCourts] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("teams");
  const [generating, setGenerating] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);

  const [name, setName] = useState("Tournament");
  const [format, setFormat] = useState("round_robin");
  const [matchType, setMatchType] = useState("doubles");
  const [scoringMode, setScoringMode] = useState("score");
  const [defaultMinutes, setDefaultMinutes] = useState(15);
  const [numPools, setNumPools] = useState(1);
  const [timerEnabled, setTimerEnabled] = useState(true);
  const [advanceCount, setAdvanceCount] = useState(0);
  const [generatingPlayoffs, setGeneratingPlayoffs] = useState(false);

  const [teamName, setTeamName] = useState("");
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [teamGender, setTeamGender] = useState("");
  const [teamLevel, setTeamLevel] = useState("");
  const [teamPool, setTeamPool] = useState(1);

  const [courtLabel, setCourtLabel] = useState("");
  const [courtGender, setCourtGender] = useState("any");
  const [courtLevel, setCourtLevel] = useState("");
  const [courtMatchType, setCourtMatchType] = useState("any");

  const [scoreDrafts, setScoreDrafts] = useState({});

  const isHost = !!session && event?.host_id === session.user.id;

  const loadAll = useCallback(async () => {
    const { data: eventData } = await supabase.from("events").select("*").eq("id", eventId).single();
    setEvent(eventData);

    const { data: listData } = await supabase
      .from("tournaments")
      .select("*")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    setTournamentsList(listData || []);

    const tData = activeTournamentId ? (listData || []).find((t) => t.id === activeTournamentId) : null;
    setTournament(tData || null);

    if (tData) {
      const [{ data: teamData }, { data: courtData }, { data: matchData }] = await Promise.all([
        supabase.from("tournament_teams").select("*").eq("tournament_id", tData.id).order("created_at"),
        supabase.from("tournament_courts").select("*").eq("tournament_id", tData.id).order("created_at"),
        supabase.from("tournament_matches").select("*").eq("tournament_id", tData.id).order("round_number").order("match_index"),
      ]);
      setTeams(teamData || []);
      setCourts(courtData || []);
      setMatches(matchData || []);
      if (matchData && matchData.length > 0) setTab((t) => (t === "teams" || t === "courts" ? "matches" : t));
    } else {
      setTeams([]);
      setCourts([]);
      setMatches([]);
      setTab("teams");
    }
    setLoading(false);
  }, [eventId, activeTournamentId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function openTournament(id) {
    setSearchParams({ t: id });
  }

  function backToList() {
    setSearchParams({});
    setEditingSettings(false);
  }

  async function createTournament(e) {
    e.preventDefault();
    const { data, error } = await supabase
      .from("tournaments")
      .insert({
        event_id: eventId,
        name: name.trim() || "Tournament",
        format,
        match_type: matchType,
        scoring_mode: scoringMode,
        default_match_minutes: Number(defaultMinutes) || 15,
        num_pools: format === "round_robin" ? Math.max(1, Number(numPools) || 1) : 1,
        timer_enabled: timerEnabled,
        advance_count: format === "round_robin" ? Number(advanceCount) || 0 : 0,
      })
      .select()
      .single();
    if (!error && data) {
      setShowNewForm(false);
      setName("Tournament"); setFormat("round_robin"); setMatchType("doubles");
      setScoringMode("score"); setDefaultMinutes(15); setNumPools(1); setTimerEnabled(true); setAdvanceCount(0);
      await loadAll();
      openTournament(data.id);
    }
  }

  async function saveTournamentSettings(e) {
    e.preventDefault();
    const updates = {
      name: name.trim() || "Tournament",
      default_match_minutes: Number(defaultMinutes) || 15,
      timer_enabled: timerEnabled,
    };
    if (tournament.status === "setup") {
      updates.format = format;
      updates.match_type = matchType;
      updates.scoring_mode = scoringMode;
      updates.num_pools = format === "round_robin" ? Math.max(1, Number(numPools) || 1) : 1;
    }
    // Playoff advance count stays editable even after group matches exist —
    // it only takes effect once "Generate playoffs" is actually pressed,
    // and only round robin tournaments use it at all.
    if (tournament.format === "round_robin") {
      updates.advance_count = Number(advanceCount) || 0;
    }
    await supabase.from("tournaments").update(updates).eq("id", tournament.id);
    setEditingSettings(false);
    await loadAll();
  }

  function openEditSettings() {
    setName(tournament.name);
    setFormat(tournament.format);
    setMatchType(tournament.match_type);
    setScoringMode(tournament.scoring_mode);
    setDefaultMinutes(tournament.default_match_minutes);
    setNumPools(tournament.num_pools);
    setTimerEnabled(tournament.timer_enabled);
    setAdvanceCount(tournament.advance_count || 0);
    setEditingSettings(true);
  }

  async function addTeam(e) {
    e.preventDefault();
    if (!player1.trim()) return;
    if (matchType === "doubles" && !player2.trim()) return;
    const displayName = teamName.trim() || (matchType === "doubles" ? `${player1.trim()} / ${player2.trim()}` : player1.trim());
    await supabase.from("tournament_teams").insert({
      tournament_id: tournament.id,
      name: displayName,
      player1_name: player1.trim(),
      player2_name: matchType === "doubles" ? player2.trim() : null,
      gender: teamGender || null,
      level: teamLevel.trim() || null,
      pool_number: tournament.num_pools > 1 ? Number(teamPool) : 1,
    });
    setTeamName(""); setPlayer1(""); setPlayer2(""); setTeamGender(""); setTeamLevel(""); setTeamPool(1);
    await loadAll();
  }

  async function removeTeam(id) {
    await supabase.from("tournament_teams").delete().eq("id", id);
    await loadAll();
  }

  async function addCourt(e) {
    e.preventDefault();
    if (!courtLabel.trim()) return;
    await supabase.from("tournament_courts").insert({
      tournament_id: tournament.id,
      label: courtLabel.trim(),
      gender_restriction: courtGender,
      level_restriction: courtLevel.trim() || null,
      match_type: courtMatchType,
    });
    setCourtLabel(""); setCourtGender("any"); setCourtLevel(""); setCourtMatchType("any");
    await loadAll();
  }

  async function removeCourt(id) {
    await supabase.from("tournament_courts").delete().eq("id", id);
    await loadAll();
  }

  function courtCompatible(court, match, teamsById) {
    if (!match.team1_id || !match.team2_id) return false;
    const t1 = teamsById[match.team1_id];
    const t2 = teamsById[match.team2_id];
    if (court.match_type !== "any" && court.match_type !== tournament.match_type) return false;
    if (court.gender_restriction !== "any") {
      if (!t1 || !t2 || t1.gender !== court.gender_restriction || t2.gender !== court.gender_restriction) return false;
    }
    if (court.level_restriction) {
      if (!t1 || !t2 || t1.level !== court.level_restriction || t2.level !== court.level_restriction) return false;
    }
    return true;
  }

  async function assignCourts(freshMatches, freshCourts, freshTeams) {
    if (freshCourts.length === 0) return;
    const teamsById = Object.fromEntries(freshTeams.map((t) => [t.id, t]));
    const slots = [...new Set(freshMatches.map((m) => `${m.stage}-${m.round_number}`))];
    for (const slot of slots) {
      const roundMatches = freshMatches.filter((m) => `${m.stage}-${m.round_number}` === slot && m.status !== "bye" && m.team1_id && m.team2_id);
      const used = new Set();
      for (const m of roundMatches) {
        const compatible = freshCourts.filter((c) => !used.has(c.id) && courtCompatible(c, m, teamsById));
        if (compatible.length > 0) {
          used.add(compatible[0].id);
          await supabase.from("tournament_matches").update({ court_id: compatible[0].id }).eq("id", m.id);
        }
      }
    }
  }

  // Shared by generateMatches (single_elim tournaments) and
  // generatePlayoffs (round robin's knockout stage): links each bracket
  // match to the one it feeds into, and immediately advances any
  // round-1 byes since there's no actual match for them to play.
  async function linkBracketMatches(skeleton, byKey) {
    const maxRound = Math.max(...skeleton.map((m) => m.round));
    for (const m of skeleton) {
      if (m.round === maxRound) continue;
      const self = byKey[`${m.round}-${m.matchIndex}`];
      const parent = byKey[`${m.round + 1}-${Math.floor(m.matchIndex / 2)}`];
      if (self && parent) {
        await supabase
          .from("tournament_matches")
          .update({ next_match_id: parent.id, next_match_slot: (m.matchIndex % 2) + 1 })
          .eq("id", self.id);
      }
    }
    for (const m of skeleton) {
      if (m.round === 1 && m.isBye && m.team1) {
        const parent = byKey[`2-${Math.floor(m.matchIndex / 2)}`];
        if (parent) {
          const field = (m.matchIndex % 2) === 0 ? "team1_id" : "team2_id";
          await supabase.from("tournament_matches").update({ [field]: m.team1 }).eq("id", parent.id);
        }
      }
    }
  }

  async function generateMatches() {
    if (teams.length < 2) return;
    setGenerating(true);

    let skeleton;
    if (tournament.format === "round_robin") {
      const poolCount = Math.max(1, tournament.num_pools || 1);
      skeleton = [];
      for (let p = 1; p <= poolCount; p++) {
        const poolTeamIds = teams.filter((t) => (poolCount > 1 ? t.pool_number : 1) === p).map((t) => t.id);
        if (poolTeamIds.length < 2) continue;
        const poolMatches = generateRoundRobin(poolTeamIds).map((m) => ({ ...m, pool: p }));
        skeleton.push(...poolMatches);
      }
    } else {
      skeleton = buildBracketSkeleton(teams.map((t) => t.id)).map((m) => ({ ...m, pool: 1 }));
    }

    const rows = skeleton.map((m) => ({
      tournament_id: tournament.id,
      round_number: m.round,
      match_index: m.matchIndex,
      pool_number: m.pool,
      stage: "group",
      team1_id: m.team1,
      team2_id: m.team2,
      status: m.isBye ? "bye" : "scheduled",
      winner_team_id: m.isBye ? m.team1 : null,
      match_minutes: tournament.default_match_minutes,
    }));

    const { data: insertedRows } = await supabase.from("tournament_matches").insert(rows).select();
    // Bracket linking only ever runs for single_elim (pool is always 1 there),
    // so round+matchIndex alone is a safe key. Round robin pools never use
    // this map at all.
    const byKey = Object.fromEntries((insertedRows || []).map((r) => [`${r.round_number}-${r.match_index}`, r]));

    if (tournament.format === "single_elim") {
      await linkBracketMatches(skeleton, byKey);
    }

    await supabase.from("tournaments").update({ status: "in_progress" }).eq("id", tournament.id);

    const { data: freshMatches } = await supabase.from("tournament_matches").select("*").eq("tournament_id", tournament.id);
    await assignCourts(freshMatches || [], courts, teams);

    setGenerating(false);
    await loadAll();
  }

  async function generatePlayoffs() {
    const advanceCountVal = tournament.advance_count || 0;
    if (advanceCountVal < 1) return;
    setGeneratingPlayoffs(true);

    const groupMatches = matches.filter((m) => m.stage === "group");
    const standingsAll = computeStandings(teams, groupMatches);
    const poolCount = Math.max(1, tournament.num_pools || 1);

    // Interleave by rank across pools (all 1st-place finishers, then all
    // 2nd-place, etc.) so a bracket seed treats pool winners as top seeds
    // rather than clustering one pool's teams together.
    const advancing = [];
    for (let rank = 0; rank < advanceCountVal; rank++) {
      for (let p = 1; p <= poolCount; p++) {
        const poolStandings = poolCount > 1 ? standingsAll.filter((s) => s.team.pool_number === p) : standingsAll;
        if (poolStandings[rank]) advancing.push(poolStandings[rank].team.id);
      }
    }

    if (advancing.length < 2) {
      setGeneratingPlayoffs(false);
      return;
    }

    const skeleton = buildBracketSkeleton(advancing);
    const rows = skeleton.map((m) => ({
      tournament_id: tournament.id,
      round_number: m.round,
      match_index: m.matchIndex,
      pool_number: 1,
      stage: "playoff",
      team1_id: m.team1,
      team2_id: m.team2,
      status: m.isBye ? "bye" : "scheduled",
      winner_team_id: m.isBye ? m.team1 : null,
      match_minutes: tournament.default_match_minutes,
    }));

    const { data: insertedRows } = await supabase.from("tournament_matches").insert(rows).select();
    const byKey = Object.fromEntries((insertedRows || []).map((r) => [`${r.round_number}-${r.match_index}`, r]));
    await linkBracketMatches(skeleton, byKey);

    const { data: freshMatches } = await supabase.from("tournament_matches").select("*").eq("tournament_id", tournament.id);
    await assignCourts((freshMatches || []).filter((m) => m.stage === "playoff"), courts, teams);

    setGeneratingPlayoffs(false);
    await loadAll();
  }

  async function startMatch(match) {
    await supabase.from("tournament_matches").update({ status: "in_progress", started_at: new Date().toISOString() }).eq("id", match.id);
    await loadAll();
  }

  async function submitResult(match, winnerChoice) {
    let winner_team_id = null;
    let is_tie = false;
    let s1 = null, s2 = null;
    const isBracketMatch = tournament.format === "single_elim" || match.stage === "playoff";

    if (tournament.scoring_mode === "score") {
      const draft = scoreDrafts[match.id] || {};
      s1 = Number(draft.s1);
      s2 = Number(draft.s2);
      if (Number.isNaN(s1) || Number.isNaN(s2)) return;
      if (s1 === s2) {
        if (isBracketMatch) {
          alert("Bracket matches need a winner — scores can't tie.");
          return;
        }
        is_tie = true;
      } else {
        winner_team_id = s1 > s2 ? match.team1_id : match.team2_id;
      }
    } else {
      if (winnerChoice === "tie") {
        if (isBracketMatch) {
          alert("Bracket matches need a winner — no ties allowed.");
          return;
        }
        is_tie = true;
      } else {
        winner_team_id = winnerChoice === "team1" ? match.team1_id : match.team2_id;
      }
    }

    await supabase
      .from("tournament_matches")
      .update({ team1_score: s1, team2_score: s2, winner_team_id, is_tie, status: "completed" })
      .eq("id", match.id);

    if (match.next_match_id && winner_team_id) {
      const field = match.next_match_slot === 1 ? "team1_id" : "team2_id";
      await supabase.from("tournament_matches").update({ [field]: winner_team_id }).eq("id", match.next_match_id);
    }

    await loadAll();
  }

  async function assignCourtManually(matchId, courtId) {
    await supabase.from("tournament_matches").update({ court_id: courtId || null }).eq("id", matchId);
    await loadAll();
  }

  function renderMatchCard(m) {
    const t1 = m.team1_id ? teamsById[m.team1_id] : null;
    const t2 = m.team2_id ? teamsById[m.team2_id] : null;
    const court = m.court_id ? courtsById[m.court_id] : null;
    const draft = scoreDrafts[m.id] || {};
    const allowTie = tournament.format === "round_robin" && m.stage !== "playoff";

    if (m.status === "bye") {
      return (
        <div key={m.id} className="tmatch-card">
          <div className="tmatch-teams">
            <div className="tmatch-team winner">{t1?.name || "TBD"}</div>
            <div className="tmatch-vs">BYE</div>
          </div>
        </div>
      );
    }

    return (
      <div key={m.id} className="tmatch-card">
        <div className="tmatch-teams">
          <div className={`tmatch-team ${m.winner_team_id === m.team1_id ? "winner" : ""}`}>{t1?.name || "TBD"}</div>
          <div className="tmatch-vs">vs</div>
          <div className={`tmatch-team ${m.winner_team_id === m.team2_id ? "winner" : ""}`} style={{ textAlign: "right" }}>{t2?.name || "TBD"}</div>
        </div>

        {m.status === "completed" && (
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--fade)", marginTop: 6 }}>
            {m.is_tie ? "Tied" : tournament.scoring_mode === "score" ? `${m.team1_score} \u2013 ${m.team2_score}` : "Final"}
          </div>
        )}

        {isHost && t1 && t2 && m.status !== "completed" && (
          <div style={{ marginTop: 10 }}>
            {m.status === "scheduled" && (
              <button className="btn btn-primary btn-small" style={{ width: "100%" }} onClick={() => startMatch(m)}>
                <Play size={12} style={{ verticalAlign: -2 }} /> Start match
              </button>
            )}
            {m.status === "in_progress" && tournament.scoring_mode === "score" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="dashed-input" type="number" placeholder="0"
                  value={draft.s1 ?? ""}
                  onChange={(e) => setScoreDrafts((d) => ({ ...d, [m.id]: { ...d[m.id], s1: e.target.value } }))}
                />
                <span style={{ fontSize: 11, color: "var(--fade)" }}>vs</span>
                <input
                  className="dashed-input" type="number" placeholder="0"
                  value={draft.s2 ?? ""}
                  onChange={(e) => setScoreDrafts((d) => ({ ...d, [m.id]: { ...d[m.id], s2: e.target.value } }))}
                />
                <button className="btn btn-primary btn-icon-square" onClick={() => submitResult(m)}>&#10003;</button>
              </div>
            )}
            {m.status === "in_progress" && tournament.scoring_mode === "winloss" && (
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary btn-small" onClick={() => submitResult(m, "team1")}>{t1.name} won</button>
                <button className="btn btn-primary btn-small" onClick={() => submitResult(m, "team2")}>{t2.name} won</button>
                {allowTie && (
                  <button className="btn btn-outline-coral btn-small" onClick={() => submitResult(m, "tie")}>Tie</button>
                )}
              </div>
            )}
          </div>
        )}

        <div className="tmatch-meta">
          {isHost ? (
            <select
              value={m.court_id || ""}
              onChange={(e) => assignCourtManually(m.id, e.target.value)}
              style={{ fontSize: 11, border: "1px solid var(--line)", borderRadius: 6, padding: "2px 4px", background: "var(--white)" }}
            >
              <option value="">No court</option>
              {courts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          ) : (
            <span>{court ? court.label : "No court assigned"}</span>
          )}
          {tournament.timer_enabled && <MatchTimer match={m} />}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="app-shell">
        <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
        <div className="phone" style={{ alignItems: "center", justifyContent: "center" }}>Loading...</div>
      </div>
    );
  }

  const teamsById = Object.fromEntries(teams.map((t) => [t.id, t]));
  const courtsById = Object.fromEntries(courts.map((c) => [c.id, c]));
  const groupStageMatches = matches.filter((m) => m.stage === "group");
  const playoffStageMatches = matches.filter((m) => m.stage === "playoff");
  const rounds = [...new Set(groupStageMatches.map((m) => m.round_number))].sort((a, b) => a - b);
  // Playoff results never factor into pool standings — a team's playoff win
  // against someone from another pool isn't part of that pool's own record.
  const standings = tournament ? computeStandings(teams, groupStageMatches) : [];
  const champion = (() => {
    if (playoffStageMatches.length > 0) {
      const finalRound = Math.max(...playoffStageMatches.map((m) => m.round_number));
      return playoffStageMatches.find((m) => m.round_number === finalRound && m.status === "completed") || null;
    }
    if (tournament?.format === "single_elim" && rounds.length > 0) {
      return matches.find((m) => m.round_number === Math.max(...rounds) && m.status === "completed") || null;
    }
    return null;
  })();

  return (
    <div className="app-shell">
      <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
      <div className="phone">
        <div className="header">
          <div className="header-row" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="icon-btn" onClick={() => (tournament ? backToList() : navigate(`/event/${eventId}`))}><ArrowLeft size={18} /></button>
              <div className="title-display" style={{ fontSize: 17 }}>
                <Trophy size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
                {tournament?.name || "Tournaments"}
              </div>
            </div>
            {isHost && tournament && !editingSettings && (
              <button className="icon-btn" onClick={openEditSettings} title="Edit tournament"><Pencil size={16} /></button>
            )}
          </div>
          {event && <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 6 }}>{event.title}</div>}
        </div>

        {!tournament ? (
          <div className="body-scroll">
            {tournamentsList.length > 0 && (
              <div style={{ padding: "16px 20px 0" }}>
                {tournamentsList.map((t) => (
                  <div key={t.id} className="mine-card" onClick={() => openTournament(t.id)}>
                    <div>
                      <div className="name">{t.name}</div>
                      <div className="sub">
                        {t.format === "round_robin" ? "Round robin" : "Bracket"} &middot; {t.match_type} &middot; {t.status.replace("_", " ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!isHost && tournamentsList.length === 0 && (
              <div className="empty-state">
                <div className="title">No tournament has been set up for this event yet.</div>
              </div>
            )}

            {isHost && !showNewForm && (
              <div style={{ padding: "16px 20px" }}>
                <button className="dashed-join-btn" onClick={() => setShowNewForm(true)}>
                  <Plus size={14} /> New tournament
                </button>
              </div>
            )}

            {isHost && showNewForm && (
              <form onSubmit={createTournament} style={{ padding: "0 20px 20px" }}>
                <div className="field-label">Tournament name</div>
                <input className="solid-input" value={name} onChange={(e) => setName(e.target.value)} />

                <div className="field-label" style={{ marginTop: 14 }}>Format</div>
                <select className="solid-input" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="round_robin">Round robin</option>
                  <option value="single_elim">Single-elimination bracket</option>
                </select>

                {format === "round_robin" && (
                  <>
                    <div className="field-label" style={{ marginTop: 14 }}>Pools</div>
                    <input
                      className="solid-input" type="number" min="1" value={numPools}
                      onChange={(e) => setNumPools(e.target.value)}
                    />
                    <div className="helper-text">
                      Split teams into separate groups, each running their own round robin. Leave at 1 for a single group.
                    </div>

                    <div className="field-label" style={{ marginTop: 14 }}>Playoffs</div>
                    <select className="solid-input" value={advanceCount} onChange={(e) => setAdvanceCount(e.target.value)}>
                      <option value={0}>No knockout stage — pool play only</option>
                      <option value={1}>Top 1 per pool advances</option>
                      <option value={2}>Top 2 per pool advance</option>
                      <option value={3}>Top 3 per pool advance</option>
                      <option value={4}>Top 4 per pool advance</option>
                      <option value={5}>Top 5 per pool advance</option>
                    </select>
                    <div className="helper-text">
                      After pool play finishes, the top finisher(s) from each pool play a single-elimination bracket for the title.
                    </div>
                  </>
                )}

                <div className="field-label" style={{ marginTop: 14 }}>Match type</div>
                <select className="solid-input" value={matchType} onChange={(e) => setMatchType(e.target.value)}>
                  <option value="doubles">Doubles</option>
                  <option value="singles">Singles</option>
                </select>

                <div className="field-label" style={{ marginTop: 14 }}>Scoring</div>
                <select className="solid-input" value={scoringMode} onChange={(e) => setScoringMode(e.target.value)}>
                  <option value="score">Track scores</option>
                  <option value="winloss">Winner only (no scores)</option>
                </select>

                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={timerEnabled} onChange={(e) => setTimerEnabled(e.target.checked)} />
                  Enable match countdown timer
                </label>

                {timerEnabled && (
                  <>
                    <div className="field-label" style={{ marginTop: 14 }}>Default match length (minutes)</div>
                    <input className="solid-input" type="number" min="1" value={defaultMinutes} onChange={(e) => setDefaultMinutes(e.target.value)} />
                  </>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                  <button className="btn btn-outline-coral btn-small" type="button" onClick={() => setShowNewForm(false)}>Cancel</button>
                  <button className="btn btn-primary" style={{ flex: 2, borderRadius: 14 }} type="submit">Create tournament</button>
                </div>
              </form>
            )}
          </div>
        ) : editingSettings ? (
          <div className="body-scroll">
            <form onSubmit={saveTournamentSettings} style={{ padding: "16px 20px" }}>
              <div className="field-label">Tournament name</div>
              <input className="solid-input" value={name} onChange={(e) => setName(e.target.value)} />

              {tournament.status !== "setup" && (
                <div className="helper-text" style={{ marginTop: 10 }}>
                  Format, match type, scoring, and pools are locked once matches have been generated.
                </div>
              )}

              <div className="field-label" style={{ marginTop: 14 }}>Format</div>
              <select className="solid-input" value={format} onChange={(e) => setFormat(e.target.value)} disabled={tournament.status !== "setup"}>
                <option value="round_robin">Round robin</option>
                <option value="single_elim">Single-elimination bracket</option>
              </select>

              {format === "round_robin" && (
                <>
                  <div className="field-label" style={{ marginTop: 14 }}>Pools</div>
                  <input
                    className="solid-input" type="number" min="1" value={numPools} disabled={tournament.status !== "setup"}
                    onChange={(e) => setNumPools(e.target.value)}
                  />

                  <div className="field-label" style={{ marginTop: 14 }}>Playoffs</div>
                  <select className="solid-input" value={advanceCount} onChange={(e) => setAdvanceCount(e.target.value)}>
                    <option value={0}>No knockout stage — pool play only</option>
                    <option value={1}>Top 1 per pool advances</option>
                    <option value={2}>Top 2 per pool advance</option>
                    <option value={3}>Top 3 per pool advance</option>
                    <option value={4}>Top 4 per pool advance</option>
                    <option value={5}>Top 5 per pool advance</option>
                  </select>
                </>
              )}

              <div className="field-label" style={{ marginTop: 14 }}>Match type</div>
              <select className="solid-input" value={matchType} onChange={(e) => setMatchType(e.target.value)} disabled={tournament.status !== "setup"}>
                <option value="doubles">Doubles</option>
                <option value="singles">Singles</option>
              </select>

              <div className="field-label" style={{ marginTop: 14 }}>Scoring</div>
              <select className="solid-input" value={scoringMode} onChange={(e) => setScoringMode(e.target.value)} disabled={tournament.status !== "setup"}>
                <option value="score">Track scores</option>
                <option value="winloss">Winner only (no scores)</option>
              </select>

              <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                <input type="checkbox" checked={timerEnabled} onChange={(e) => setTimerEnabled(e.target.checked)} />
                Enable match countdown timer
              </label>

              {timerEnabled && (
                <>
                  <div className="field-label" style={{ marginTop: 14 }}>Default match length (minutes)</div>
                  <input className="solid-input" type="number" min="1" value={defaultMinutes} onChange={(e) => setDefaultMinutes(e.target.value)} />
                </>
              )}

              <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
                <button className="btn btn-outline-coral btn-small" type="button" onClick={() => setEditingSettings(false)}>Cancel</button>
                <button className="btn btn-primary" style={{ flex: 2, borderRadius: 14 }} type="submit">Save changes</button>
              </div>
            </form>
          </div>
        ) : (
          <>
            <div className="event-tabs">
              {tournament.status === "setup" && (
                <>
                  <button className={`event-tab ${tab === "teams" ? "selected" : ""}`} onClick={() => setTab("teams")}>Teams &middot; {teams.length}</button>
                  <button className={`event-tab ${tab === "courts" ? "selected" : ""}`} onClick={() => setTab("courts")}>Courts &middot; {courts.length}</button>
                </>
              )}
              {tournament.status !== "setup" && (
                <button className={`event-tab ${tab === "matches" ? "selected" : ""}`} onClick={() => setTab("matches")}>Matches</button>
              )}
              <button className={`event-tab ${tab === "standings" ? "selected" : ""}`} onClick={() => setTab("standings")}>Standings</button>
            </div>

            {tab === "teams" && tournament.status === "setup" && (
              <div className="body-scroll">
                {isHost && (
                  <form onSubmit={addTeam} style={{ marginBottom: 16 }}>
                    <div className="field-label">Player 1</div>
                    <input className="solid-input" value={player1} onChange={(e) => setPlayer1(e.target.value)} placeholder="Name" />
                    {matchType === "doubles" && (
                      <>
                        <div className="field-label" style={{ marginTop: 10 }}>Player 2</div>
                        <input className="solid-input" value={player2} onChange={(e) => setPlayer2(e.target.value)} placeholder="Name" />
                      </>
                    )}
                    <div className="field-label" style={{ marginTop: 10 }}>Team name (optional)</div>
                    <input className="solid-input" value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Defaults to player name(s)" />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <select className="solid-input" value={teamGender} onChange={(e) => setTeamGender(e.target.value)}>
                        <option value="">Gender (optional)</option>
                        <option value="men">Men</option>
                        <option value="women">Women</option>
                        <option value="mixed">Mixed</option>
                      </select>
                      <input className="solid-input" value={teamLevel} onChange={(e) => setTeamLevel(e.target.value)} placeholder="Level (optional)" />
                    </div>
                    {tournament.num_pools > 1 && (
                      <>
                        <div className="field-label" style={{ marginTop: 10 }}>Pool</div>
                        <select className="solid-input" value={teamPool} onChange={(e) => setTeamPool(e.target.value)}>
                          {Array.from({ length: tournament.num_pools }, (_, i) => i + 1).map((p) => (
                            <option key={p} value={p}>Pool {p}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} type="submit">
                      <Plus size={14} style={{ verticalAlign: -2 }} /> Add team
                    </button>
                  </form>
                )}

                {teams.map((t) => (
                  <div key={t.id} className="mine-card">
                    <div>
                      <div className="name">{t.name}</div>
                      <div className="sub">
                        {[tournament.num_pools > 1 ? `Pool ${t.pool_number}` : null, t.gender, t.level].filter(Boolean).join(" \u00B7 ") || "No gender/level set"}
                      </div>
                    </div>
                    {isHost && (
                      <button className="icon-btn" style={{ color: "var(--coral)" }} onClick={() => removeTeam(t.id)}><X size={15} /></button>
                    )}
                  </div>
                ))}

                {isHost && teams.length >= 2 && (
                  <button className="btn btn-accent btn-block" style={{ marginTop: 16 }} onClick={generateMatches} disabled={generating}>
                    {generating ? "Generating..." : `Generate ${tournament.format === "round_robin" ? "round robin" : "bracket"}`}
                  </button>
                )}
                {isHost && teams.length < 2 && (
                  <div className="helper-text">Add at least 2 teams to generate matches.</div>
                )}
              </div>
            )}

            {tab === "courts" && tournament.status === "setup" && (
              <div className="body-scroll">
                {isHost && (
                  <form onSubmit={addCourt} style={{ marginBottom: 16 }}>
                    <div className="field-label">Court label</div>
                    <input className="solid-input" value={courtLabel} onChange={(e) => setCourtLabel(e.target.value)} placeholder="Court 1" />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <select className="solid-input" value={courtGender} onChange={(e) => setCourtGender(e.target.value)}>
                        <option value="any">Any gender</option>
                        <option value="men">Men only</option>
                        <option value="women">Women only</option>
                        <option value="mixed">Mixed only</option>
                      </select>
                      <select className="solid-input" value={courtMatchType} onChange={(e) => setCourtMatchType(e.target.value)}>
                        <option value="any">Singles or doubles</option>
                        <option value="singles">Singles only</option>
                        <option value="doubles">Doubles only</option>
                      </select>
                    </div>
                    <input className="solid-input" style={{ marginTop: 10 }} value={courtLevel} onChange={(e) => setCourtLevel(e.target.value)} placeholder="Level restriction (optional)" />
                    <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} type="submit">
                      <Plus size={14} style={{ verticalAlign: -2 }} /> Add court
                    </button>
                  </form>
                )}

                {courts.map((c) => (
                  <div key={c.id} className="mine-card">
                    <div>
                      <div className="name">{c.label}</div>
                      <div className="sub">
                        {c.gender_restriction !== "any" ? c.gender_restriction : "any gender"} &middot; {c.match_type !== "any" ? c.match_type : "singles/doubles"}
                        {c.level_restriction ? ` \u00B7 ${c.level_restriction}` : ""}
                      </div>
                    </div>
                    {isHost && (
                      <button className="icon-btn" style={{ color: "var(--coral)" }} onClick={() => removeCourt(c.id)}><X size={15} /></button>
                    )}
                  </div>
                ))}
                {courts.length === 0 && <div className="helper-text">No courts added — matches will need manual court assignment.</div>}
              </div>
            )}

            {tab === "matches" && tournament.status !== "setup" && (
              <div className="body-scroll">
                {(tournament.num_pools > 1 ? [...new Set(matches.filter((m) => m.stage === "group").map((m) => m.pool_number))].sort((a, b) => a - b) : [1]).map((poolNum) => {
                  const poolMatches = tournament.num_pools > 1
                    ? matches.filter((m) => m.stage === "group" && m.pool_number === poolNum)
                    : matches.filter((m) => m.stage === "group");
                  const poolRounds = [...new Set(poolMatches.map((m) => m.round_number))].sort((a, b) => a - b);
                  return (
                    <div key={poolNum}>
                      {tournament.num_pools > 1 && (
                        <div className="round-header" style={{ fontSize: 14, color: "var(--ink)", paddingTop: 18 }}>POOL {poolNum}</div>
                      )}
                      {poolRounds.map((r) => (
                        <div key={r}>
                          <div className="round-header">
                            {tournament.format === "round_robin" ? `ROUND ${r}` : r === Math.max(...poolRounds) ? "FINAL" : `ROUND ${r}`}
                          </div>
                          {poolMatches.filter((m) => m.round_number === r).map(renderMatchCard)}
                        </div>
                      ))}
                    </div>
                  );
                })}

                {tournament.format === "round_robin" && tournament.advance_count > 0 && (
                  (() => {
                    const groupMatches = matches.filter((m) => m.stage === "group");
                    const playoffMatches = matches.filter((m) => m.stage === "playoff");
                    const allGroupDone = groupMatches.length > 0 && groupMatches.every((m) => m.status === "completed" || m.status === "bye");

                    if (playoffMatches.length === 0 && isHost) {
                      return (
                        <div style={{ padding: "18px 20px" }}>
                          {allGroupDone ? (
                            <button className="btn btn-accent btn-block" onClick={generatePlayoffs} disabled={generatingPlayoffs}>
                              {generatingPlayoffs ? "Generating..." : "Generate playoffs"}
                            </button>
                          ) : (
                            <div className="helper-text">Playoffs will be available once every pool has finished round robin play.</div>
                          )}
                        </div>
                      );
                    }

                    if (playoffMatches.length === 0) return null;

                    const playoffRounds = [...new Set(playoffMatches.map((m) => m.round_number))].sort((a, b) => a - b);
                    const totalPlayoffRounds = Math.max(...playoffRounds);
                    return (
                      <div>
                        <div className="round-header" style={{ fontSize: 14, color: "var(--ink)", paddingTop: 18 }}>PLAYOFFS</div>
                        {playoffRounds.map((r) => (
                          <div key={r}>
                            <div className="round-header">{roundLabel(r, totalPlayoffRounds)}</div>
                            {playoffMatches.filter((m) => m.round_number === r).map(renderMatchCard)}
                          </div>
                        ))}
                      </div>
                    );
                  })()
                )}
              </div>
            )}

            {tab === "standings" && (
              <div className="body-scroll" style={{ padding: "12px 0" }}>
                {champion?.winner_team_id && (
                  <div className="card" style={{ margin: "0 20px 16px", background: "var(--ink)", border: "none", textAlign: "center" }}>
                    <Trophy size={20} color="var(--citrus)" />
                    <div style={{ color: "#fff", fontFamily: "var(--font-display)", fontSize: 12, marginTop: 6 }}>CHAMPION</div>
                    <div style={{ color: "var(--citrus)", fontFamily: "var(--font-display)", fontSize: 16, marginTop: 2 }}>
                      {teamsById[champion.winner_team_id]?.name}
                    </div>
                  </div>
                )}
                {(tournament.num_pools > 1
                  ? [...new Set(teams.map((t) => t.pool_number))].sort((a, b) => a - b)
                  : [null]
                ).map((poolNum) => (
                  <div key={poolNum ?? "all"}>
                    {poolNum !== null && (
                      <div className="round-header" style={{ fontSize: 13, color: "var(--ink)" }}>POOL {poolNum}</div>
                    )}
                    <table className="standings-table">
                      <thead>
                        <tr>
                          <th>Team</th>
                          <th>GP</th>
                          <th>W</th>
                          <th>L</th>
                          <th>T</th>
                          <th>Win%</th>
                          <th>+/-</th>
                          <th>Tiebreak</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings
                          .filter((s) => poolNum === null || s.team.pool_number === poolNum)
                          .map((s) => (
                            <tr key={s.team.id}>
                              <td>{s.team.name}</td>
                              <td>{s.played}</td>
                              <td>{s.wins}</td>
                              <td>{s.losses}</td>
                              <td>{s.ties}</td>
                              <td>{(s.winPct * 100).toFixed(0)}%</td>
                              <td>{s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}</td>
                              <td style={{ fontSize: 10, color: "var(--fade)" }}>{s.tiebreakNote || "\u2014"}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {tournament.scoring_mode === "winloss" && (
                  <div className="helper-text" style={{ padding: "0 20px" }}>
                    Point differential isn't tracked in winner-only mode.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

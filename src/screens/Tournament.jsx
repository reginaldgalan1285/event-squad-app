import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Plus, Trophy, Play, X, Pencil, Check, Download } from "lucide-react";
import { supabase } from "../supabaseClient";
import { generateRoundRobin, buildBracketSkeleton, computeStandings, roundLabel, generateOpenPlayRound, computePlayerStandings, buildOpenPlayHistory, selectRoundPool } from "../lib/tournament";
import jsPDF from "jspdf";

function LevelsEditor({ levelNames, setLevelNames, newLevelInput, setNewLevelInput }) {
  function addLevel() {
    const trimmed = newLevelInput.trim();
    if (!trimmed || levelNames.includes(trimmed)) return;
    setLevelNames((arr) => [...arr, trimmed]);
    setNewLevelInput("");
  }
  return (
    <>
      <div className="field-label" style={{ marginTop: 14 }}>Skill levels (optional)</div>
      <div className="helper-text" style={{ marginBottom: 8 }}>
        Define named levels (e.g. Beginner, Intermediate, Advanced) to pick from everywhere a level is set, instead of typing one freehand each time.
      </div>
      {levelNames.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {levelNames.map((lvl) => (
            <span key={lvl} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--chalk)", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 600 }}>
              {lvl}
              <button type="button" onClick={() => setLevelNames((arr) => arr.filter((l) => l !== lvl))} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--coral)", display: "flex" }}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          className="solid-input" value={newLevelInput} onChange={(e) => setNewLevelInput(e.target.value)}
          placeholder="e.g. Intermediate"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLevel(); } }}
        />
        <button type="button" className="btn btn-primary btn-icon-square" onClick={addLevel}>
          <Plus size={15} />
        </button>
      </div>
    </>
  );
}

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
  const [thirdPlaceMatchOpt, setThirdPlaceMatchOpt] = useState(false);
  const [generatingPlayoffs, setGeneratingPlayoffs] = useState(false);
  const [fixedPartners, setFixedPartners] = useState(true);
  const [requireMixedDoubles, setRequireMixedDoubles] = useState(false);
  const [groupWomensDoubles, setGroupWomensDoubles] = useState(false);
  const [levelNames, setLevelNames] = useState([]);
  const [newLevelInput, setNewLevelInput] = useState("");
  const [players, setPlayers] = useState([]);
  const [playerName, setPlayerName] = useState("");
  const [playerGender, setPlayerGender] = useState("");
  const [playerLevel, setPlayerLevel] = useState("");
  const [playerPool, setPlayerPool] = useState(1);
  const [roundsToGenerate, setRoundsToGenerate] = useState(1);

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
  const [editingCourtId, setEditingCourtId] = useState(null);

  const [scoreDrafts, setScoreDrafts] = useState({});
  const [editingMatchId, setEditingMatchId] = useState(null);
  const [createError, setCreateError] = useState("");
  const [swappingSide, setSwappingSide] = useState(null); // { matchId, side: 'team1'|'team2' }
  const [swapDraft, setSwapDraft] = useState({ p1: "", p2: "" });
  const [lastGeneratedFromRound, setLastGeneratedFromRound] = useState(null);

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
      const [{ data: teamData }, { data: courtData }, { data: matchData }, { data: playerData }] = await Promise.all([
        supabase.from("tournament_teams").select("*").eq("tournament_id", tData.id).order("created_at"),
        supabase.from("tournament_courts").select("*").eq("tournament_id", tData.id).order("created_at"),
        supabase.from("tournament_matches").select("*").eq("tournament_id", tData.id).order("round_number").order("match_index"),
        supabase.from("tournament_players").select("*").eq("tournament_id", tData.id).order("joined_at"),
      ]);
      setTeams(teamData || []);
      setCourts(courtData || []);
      setMatches(matchData || []);
      setPlayers(playerData || []);
      if (matchData && matchData.length > 0) setTab((t) => (t === "teams" || t === "courts" ? "matches" : t));
    } else {
      setTeams([]);
      setCourts([]);
      setMatches([]);
      setPlayers([]);
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
    setCreateError("");
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
        advance_count: format === "round_robin" && fixedPartners ? Number(advanceCount) || 0 : 0,
        fixed_partners: format === "round_robin" ? fixedPartners : true,
        require_mixed_doubles: format === "round_robin" && !fixedPartners && matchType === "doubles" ? requireMixedDoubles && !groupWomensDoubles : false,
        group_womens_doubles: format === "round_robin" && !fixedPartners && matchType === "doubles" ? groupWomensDoubles : false,
        level_names: levelNames,
        third_place_match: format === "single_elim" || (format === "round_robin" && fixedPartners && Number(advanceCount) >= 1) ? thirdPlaceMatchOpt : false,
      })
      .select()
      .single();
    if (error) {
      setCreateError(error.message);
      return;
    }
    if (data) {
      setShowNewForm(false);
      setName("Tournament"); setFormat("round_robin"); setMatchType("doubles");
      setScoringMode("score"); setDefaultMinutes(15); setNumPools(1); setTimerEnabled(true); setAdvanceCount(0);
      setFixedPartners(true);
      setRequireMixedDoubles(false);
      setGroupWomensDoubles(false);
      setLevelNames([]);
      setThirdPlaceMatchOpt(false);
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
      updates.fixed_partners = format === "round_robin" ? fixedPartners : true;
      if (format === "single_elim") updates.third_place_match = thirdPlaceMatchOpt;
    }
    if (tournament.format === "round_robin" && (tournament.fixed_partners !== false)) {
      updates.advance_count = Number(advanceCount) || 0;
      updates.third_place_match = thirdPlaceMatchOpt;
    }
    if (tournament.fixed_partners === false && tournament.match_type === "doubles") {
      updates.require_mixed_doubles = requireMixedDoubles && !groupWomensDoubles;
      updates.group_womens_doubles = groupWomensDoubles;
    }
    updates.level_names = levelNames;
    await supabase.from("tournaments").update(updates).eq("id", tournament.id);
    setEditingSettings(false);
    await loadAll();
  }

  async function deleteTournament() {
    if (!window.confirm(`Delete "${tournament.name}"? This permanently removes all its teams/players, courts, and match history — this can't be undone.`)) return;
    await supabase.from("tournaments").delete().eq("id", tournament.id);
    setEditingSettings(false);
    backToList();
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
    setFixedPartners(tournament.fixed_partners !== false);
    setRequireMixedDoubles(!!tournament.require_mixed_doubles);
    setGroupWomensDoubles(!!tournament.group_womens_doubles);
    setLevelNames(tournament.level_names || []);
    setThirdPlaceMatchOpt(!!tournament.third_place_match);
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

  // Distributes all current teams evenly across the tournament's pools,
  // instead of the host picking a pool for every team one at a time.
  // Shuffles first so pool assignment isn't just "whoever signed up
  // first/together" clustered into the same pool.
  async function autoAssignPools() {
    if (teams.length === 0) return;
    const poolCount = Math.max(1, tournament.num_pools || 1);
    if (poolCount < 2) return;
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      await supabase.from("tournament_teams").update({ pool_number: (i % poolCount) + 1 }).eq("id", shuffled[i].id);
    }
    await loadAll();
  }

  // Randomizes bracket seed order. Doesn't touch anything if matches
  // have already been generated with the old order.
  async function randomizeSeeding() {
    if (teams.length === 0) return;
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      await supabase.from("tournament_teams").update({ seed: i + 1 }).eq("id", shuffled[i].id);
    }
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

  function beginEditCourt(c) {
    setCourtLabel(c.label);
    setCourtGender(c.gender_restriction);
    setCourtMatchType(c.match_type);
    setCourtLevel(c.level_restriction || "");
    setEditingCourtId(c.id);
  }

  async function saveCourtEdit(e) {
    e.preventDefault();
    if (!courtLabel.trim()) return;
    await supabase
      .from("tournament_courts")
      .update({
        label: courtLabel.trim(),
        gender_restriction: courtGender,
        level_restriction: courtLevel.trim() || null,
        match_type: courtMatchType,
      })
      .eq("id", editingCourtId);
    setEditingCourtId(null);
    setCourtLabel(""); setCourtGender("any"); setCourtLevel(""); setCourtMatchType("any");
    await loadAll();
  }

  // Open-play roster management. Unlike fixed teams, this is never
  // gated to "setup" status — adding a player mid-session (a latecomer)
  // is exactly the point, and generateOpenPlayRounds below will
  // automatically prioritize anyone with fewer games played so far.
  async function addPlayer(e) {
    e.preventDefault();
    if (!playerName.trim()) return;
    await supabase.from("tournament_players").insert({
      tournament_id: tournament.id,
      name: playerName.trim(),
      gender: playerGender || null,
      level: playerLevel.trim() || null,
      pool_number: tournament.num_pools > 1 ? Number(playerPool) : 1,
    });
    setPlayerName(""); setPlayerGender(""); setPlayerLevel(""); setPlayerPool(1);
    await loadAll();
  }

  // Mirrors autoAssignPools for teams, but for open-play's individual
  // player roster instead.
  async function autoAssignPlayerPools() {
    const activePlayers = players.filter((p) => p.active);
    if (activePlayers.length === 0) return;
    const poolCount = Math.max(1, tournament.num_pools || 1);
    if (poolCount < 2) return;
    const shuffled = [...activePlayers].sort(() => Math.random() - 0.5);
    for (let i = 0; i < shuffled.length; i++) {
      await supabase.from("tournament_players").update({ pool_number: (i % poolCount) + 1 }).eq("id", shuffled[i].id);
    }
    await loadAll();
  }

  // Soft-remove only — a hard delete would cascade and destroy the
  // match history of every round this person already played.
  async function removePlayer(id) {
    await supabase.from("tournament_players").update({ active: false }).eq("id", id);
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

  // Creates the 3rd place match (the two semifinal losers play each
  // other) and routes each semifinal's loser into it. Separate from
  // linkBracketMatches because losers need their own routing —
  // next_match_id/next_match_slot only ever carries the winner.
  // Skipped when the bracket has no semifinal round (2 or fewer teams).
  async function addThirdPlaceMatch(skeleton, byKey, stage) {
    const maxRound = Math.max(...skeleton.map((m) => m.round));
    if (maxRound < 2) return; // final round alone — no semifinal to draw losers from
    const semiRound = maxRound - 1;
    const semiSkeletonMatches = skeleton.filter((m) => m.round === semiRound);
    if (semiSkeletonMatches.length !== 2) return; // standard single-elim always has exactly 2 here
    const semiRows = semiSkeletonMatches.map((m) => byKey[`${m.round}-${m.matchIndex}`]).filter(Boolean);
    if (semiRows.length !== 2) return;

    const { data: thirdPlaceRow } = await supabase
      .from("tournament_matches")
      .insert({
        tournament_id: tournament.id,
        round_number: maxRound,
        match_index: 1, // the final is always match_index 0 in its round
        pool_number: 1,
        stage,
        is_third_place: true,
        team1_id: null,
        team2_id: null,
        status: "scheduled",
        match_minutes: tournament.default_match_minutes,
      })
      .select()
      .single();
    if (!thirdPlaceRow) return;

    await supabase.from("tournament_matches").update({ loser_next_match_id: thirdPlaceRow.id, loser_next_slot: 1 }).eq("id", semiRows[0].id);
    await supabase.from("tournament_matches").update({ loser_next_match_id: thirdPlaceRow.id, loser_next_slot: 2 }).eq("id", semiRows[1].id);
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
      const seededTeams = [...teams].sort((a, b) => (a.seed ?? Infinity) - (b.seed ?? Infinity));
      skeleton = buildBracketSkeleton(seededTeams.map((t) => t.id)).map((m) => ({ ...m, pool: 1 }));
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
      if (tournament.third_place_match) await addThirdPlaceMatch(skeleton, byKey, "group");
    }

    await supabase.from("tournaments").update({ status: "in_progress" }).eq("id", tournament.id);

    const { data: freshMatches } = await supabase.from("tournament_matches").select("*").eq("tournament_id", tournament.id);
    await assignCourts(freshMatches || [], courts, teams);

    setGenerating(false);
    await loadAll();
  }

  // Handles all three of: the very first round generation, adding a
  // latecomer mid-session, and "generate more rounds" after earlier
  // ones finish — all the same operation, since history is rebuilt
  // fresh from the actual matches every time rather than carried in
  // any separate state.
  async function generateOpenPlayRounds(numRounds) {
    const poolCount = Math.max(1, tournament.num_pools || 1);
    const activePlayers = players.filter((p) => p.active);
    const perMatch = tournament.match_type === "doubles" ? 4 : 2;
    if (activePlayers.length < perMatch) return;

    setGenerating(true);

    const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
    let workingMatches = [...matches];
    let workingTeamsById = { ...Object.fromEntries(teams.map((t) => [t.id, t])) };
    const maxExistingRound = workingMatches.length > 0 ? Math.max(...workingMatches.map((m) => m.round_number)) : 0;

    // A round is one time-slot — it should only hold as many matches as
    // your actual courts can run at once, not one match for every group
    // of 4 (or 2) players regardless of court count. With no courts
    // defined yet, there's nothing to cap against, so every active
    // player plays each round (the original behavior).
    const capacity = courts.length > 0 ? courts.length * perMatch : activePlayers.length;

    for (let i = 0; i < numRounds; i++) {
      const roundNumber = maxExistingRound + i + 1;
      const history = buildOpenPlayHistory(workingMatches, workingTeamsById);
      let anyMatchThisRound = false;

      // With multiple pools, each pool runs its own independent rotation
      // but shares the same round number — they're happening at the same
      // real-world time slot, so they also correctly compete for the same
      // pool of courts via assignCourts below.
      for (let poolNum = 1; poolNum <= poolCount; poolNum++) {
        const poolPlayers = poolCount > 1 ? activePlayers.filter((p) => p.pool_number === poolNum) : activePlayers;
        if (poolPlayers.length < perMatch) continue;

        const ranked = [...poolPlayers].sort(
          (a, b) => (history.gamesPlayed[a.id] || 0) - (history.gamesPlayed[b.id] || 0)
        );
        const activeCount = Math.floor(Math.min(ranked.length, capacity) / perMatch) * perMatch;
        const genderMode = tournament.require_mixed_doubles ? "mixed" : tournament.group_womens_doubles ? "grouped" : "none";
        const roundPool = selectRoundPool(ranked, activeCount, genderMode, tournament.match_type);
        if (roundPool.length < perMatch) continue;

        const { matches: roundMatches } = generateOpenPlayRound({
          players: roundPool,
          matchType: tournament.match_type,
          gamesPlayed: history.gamesPlayed,
          pastPartners: history.pastPartners,
          pastOpponents: history.pastOpponents,
          genderById: Object.fromEntries(players.map((p) => [p.id, p.gender])),
          requireMixedForWomen: !!tournament.require_mixed_doubles,
          groupWomensDoubles: !!tournament.group_womens_doubles,
        });
        if (roundMatches.length === 0) continue;
        anyMatchThisRound = true;

        const teamRows = [];
        roundMatches.forEach((rm) => {
          for (const side of [rm.team1, rm.team2]) {
            const p1 = playersById[side[0]];
            const p2 = side[1] ? playersById[side[1]] : null;
            const derivedGender = !p2
              ? p1?.gender || null
              : p1?.gender && p2?.gender
              ? (p1.gender === p2.gender ? p1.gender : "mixed")
              : null;
            const derivedLevel = !p2 ? p1?.level || null : p1?.level && p1.level === p2?.level ? p1.level : null;
            teamRows.push({
              tournament_id: tournament.id,
              name: side.map((pid) => playersById[pid]?.name || "?").join(" / "),
              player1_name: p1?.name || "?",
              player2_name: p2 ? p2.name : null,
              player1_id: side[0],
              player2_id: side[1] || null,
              gender: derivedGender,
              level: derivedLevel,
              pool_number: poolNum,
            });
          }
        });

        const { data: insertedTeams } = await supabase.from("tournament_teams").insert(teamRows).select();
        if (!insertedTeams) continue;

        const matchRows = roundMatches.map((rm, idx) => ({
          tournament_id: tournament.id,
          round_number: roundNumber,
          match_index: idx,
          pool_number: poolNum,
          stage: "group",
          team1_id: insertedTeams[idx * 2].id,
          team2_id: insertedTeams[idx * 2 + 1].id,
          status: "scheduled",
          match_minutes: tournament.default_match_minutes,
        }));
        const { data: insertedMatches } = await supabase.from("tournament_matches").insert(matchRows).select();

        // Fold this pool's round into the working copies so later pools
        // this same round, and later rounds in this batch, keep rotating
        // fairly instead of repeating anything.
        insertedTeams.forEach((t) => { workingTeamsById[t.id] = t; });
        workingMatches = [...workingMatches, ...(insertedMatches || [])];
      }

      if (!anyMatchThisRound) break; // no pool could field a match this round
    }

    if (tournament.status === "setup") {
      await supabase.from("tournaments").update({ status: "in_progress" }).eq("id", tournament.id);
    }

    const { data: freshMatches } = await supabase.from("tournament_matches").select("*").eq("tournament_id", tournament.id);
    await assignCourts((freshMatches || []).filter((m) => m.round_number > maxExistingRound), courts, Object.values(workingTeamsById));

    setLastGeneratedFromRound(maxExistingRound);
    setGenerating(false);
    await loadAll();
  }

  // Removes exactly the rounds the last "Generate" call created — e.g.
  // after realizing a player was added by mistake. Only offered while
  // none of those rounds have actually been started, so it can never
  // erase a real result.
  async function undoLastGeneration() {
    if (lastGeneratedFromRound === null) return;
    const roundsToRemove = matches.filter((m) => m.round_number > lastGeneratedFromRound);
    if (roundsToRemove.length === 0) {
      setLastGeneratedFromRound(null);
      return;
    }
    if (roundsToRemove.some((m) => m.status !== "scheduled")) {
      alert("Some of those matches have already started or been completed — undo is only available before any of the newly generated matches have been played.");
      return;
    }
    if (!window.confirm(`Remove the ${roundsToRemove.length} match${roundsToRemove.length !== 1 ? "es" : ""} just generated? This can't be undone.`)) return;

    const teamIdsToRemove = new Set();
    roundsToRemove.forEach((m) => {
      if (m.team1_id) teamIdsToRemove.add(m.team1_id);
      if (m.team2_id) teamIdsToRemove.add(m.team2_id);
    });

    await supabase.from("tournament_matches").delete().in("id", roundsToRemove.map((m) => m.id));
    if (teamIdsToRemove.size > 0) {
      await supabase.from("tournament_teams").delete().in("id", [...teamIdsToRemove]);
    }

    setLastGeneratedFromRound(null);
    await loadAll();
  }

  function beginSwap(match, side) {
    const teamId = side === "team1" ? match.team1_id : match.team2_id;
    const team = teamsById[teamId];
    setSwapDraft({ p1: team?.player1_id || "", p2: team?.player2_id || "" });
    setSwappingSide({ matchId: match.id, side });
  }

  async function saveSwap() {
    const { matchId, side } = swappingSide;
    const match = matches.find((m) => m.id === matchId);
    if (!match) return;
    const teamId = side === "team1" ? match.team1_id : match.team2_id;
    const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
    const p1 = swapDraft.p1 ? playersById[swapDraft.p1] : null;
    const p2 = swapDraft.p2 ? playersById[swapDraft.p2] : null;

    const derivedGender = !p2
      ? p1?.gender || null
      : p1?.gender && p2?.gender
      ? (p1.gender === p2.gender ? p1.gender : "mixed")
      : null;
    const derivedLevel = !p2 ? p1?.level || null : p1?.level && p1.level === p2?.level ? p1.level : null;

    await supabase
      .from("tournament_teams")
      .update({
        player1_id: swapDraft.p1 || null,
        player2_id: swapDraft.p2 || null,
        player1_name: p1?.name || "?",
        player2_name: p2 ? p2.name : null,
        name: [p1?.name, p2?.name].filter(Boolean).join(" / "),
        gender: derivedGender,
        level: derivedLevel,
      })
      .eq("id", teamId);

    setSwappingSide(null);
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
    if (tournament.third_place_match) await addThirdPlaceMatch(skeleton, byKey, "playoff");

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

    if (match.loser_next_match_id && winner_team_id) {
      const loserId = winner_team_id === match.team1_id ? match.team2_id : match.team1_id;
      if (loserId) {
        const field = match.loser_next_slot === 1 ? "team1_id" : "team2_id";
        await supabase.from("tournament_matches").update({ [field]: loserId }).eq("id", match.loser_next_match_id);
      }
    }

    setEditingMatchId(null);

    await loadAll();
  }

  async function assignCourtManually(matchId, courtId) {
    await supabase.from("tournament_matches").update({ court_id: courtId || null }).eq("id", matchId);
    await loadAll();
  }

  function beginEditMatch(m) {
    if (tournament.scoring_mode === "score") {
      setScoreDrafts((d) => ({ ...d, [m.id]: { s1: m.team1_score ?? "", s2: m.team2_score ?? "" } }));
    }
    setEditingMatchId(m.id);
  }

  function downloadSchedulePDF() {
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.getHeight();
    let y = 18;

    function ensureRoom(lines = 1) {
      if (y + lines * 6 > pageHeight - 12) {
        doc.addPage();
        y = 18;
      }
    }

    doc.setFontSize(16);
    doc.setFont(undefined, "bold");
    doc.text(tournament.name, 14, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont(undefined, "normal");
    if (event?.title) { doc.text(event.title, 14, y); y += 5; }
    doc.text(`${tournament.format === "round_robin" ? "Round robin" : "Bracket"} \u00B7 ${tournament.match_type}`, 14, y);
    y += 8;

    function printMatchLine(m, matchNumber) {
      ensureRoom();
      const t1 = m.team1_id ? teamsById[m.team1_id]?.name : "TBD";
      const t2 = m.status === "bye" ? "BYE" : m.team2_id ? teamsById[m.team2_id]?.name : "TBD";
      const court = m.court_id ? courtsById[m.court_id]?.label : "No court";
      const prefix = matchNumber != null ? `Match ${matchNumber}:  ` : "";
      let line = `${prefix}${t1}  vs  ${t2}   (${court})`;
      if (m.status === "completed") {
        line += m.is_tie ? "  \u2013 Tied" : tournament.scoring_mode === "score" ? `  \u2013 ${m.team1_score}-${m.team2_score}` : "  \u2013 Final";
      }
      doc.setFontSize(10);
      doc.text(line, 18, y);
      y += 6;
    }

    function printRounds(roundMatches, label) {
      if (roundMatches.length === 0) return;
      if (label) {
        ensureRoom(2);
        doc.setFontSize(13);
        doc.setFont(undefined, "bold");
        doc.text(label, 14, y);
        y += 7;
      }

      if (tournament.fixed_partners === false) {
        // Open play: no "Round" headers — just every match, in order,
        // numbered sequentially, matching the on-screen Matches tab.
        const sorted = [...roundMatches].sort((a, b) => a.round_number - b.round_number || a.match_index - b.match_index);
        doc.setFont(undefined, "normal");
        sorted.forEach((m, idx) => printMatchLine(m, idx + 1));
        y += 2;
        return;
      }

      const rounds = [...new Set(roundMatches.map((m) => m.round_number))].sort((a, b) => a - b);
      const total = Math.max(...rounds);
      for (const r of rounds) {
        ensureRoom(2);
        doc.setFontSize(11);
        doc.setFont(undefined, "bold");
        const heading = tournament.format === "round_robin" ? `Round ${r}` : roundLabel(r, total);
        doc.text(heading, 14, y);
        y += 6;
        doc.setFont(undefined, "normal");
        roundMatches.filter((m) => m.round_number === r).forEach((m) => printMatchLine(m));
        y += 2;
      }
    }

    const groupMatches = matches.filter((m) => m.stage === "group");
    const playoffMatches = matches.filter((m) => m.stage === "playoff");

    if (tournament.num_pools > 1) {
      const pools = [...new Set(groupMatches.map((m) => m.pool_number))].sort((a, b) => a - b);
      pools.forEach((p) => printRounds(groupMatches.filter((m) => m.pool_number === p), `Pool ${p}`));
    } else {
      printRounds(groupMatches, null);
    }
    if (playoffMatches.length > 0) printRounds(playoffMatches, "Playoffs");

    doc.save(`${tournament.name.replace(/[^a-z0-9]+/gi, "_")}_schedule.pdf`);
  }

  function renderMatchCard(m, matchNumber) {
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

    const canSwap = isHost && tournament.fixed_partners === false && m.status === "scheduled";
    const activePlayers = players.filter((p) => p.active);

    function renderTeamSide(team, teamId, side, align) {
      const isSwapping = swappingSide?.matchId === m.id && swappingSide?.side === side;
      if (isSwapping) {
        const otherSideIds = side === "team1"
          ? [t2 ? t2.player1_id : null, t2 ? t2.player2_id : null]
          : [t1 ? t1.player1_id : null, t1 ? t1.player2_id : null];
        const slots = tournament.match_type === "doubles" ? ["p1", "p2"] : ["p1"];
        return (
          <div style={{ flex: 1, textAlign: align }}>
            {slots.map((slot) => {
              const otherSlot = slot === "p1" ? "p2" : "p1";
              const excluded = new Set([...otherSideIds, swapDraft[otherSlot]].filter(Boolean));
              return (
                <select
                  key={slot}
                  value={swapDraft[slot] || ""}
                  onChange={(e) => setSwapDraft((d) => ({ ...d, [slot]: e.target.value }))}
                  style={{ fontSize: 11, marginBottom: 3, width: "100%", border: "1px solid var(--line)", borderRadius: 6, padding: "2px 4px" }}
                >
                  <option value="">— none —</option>
                  {activePlayers.filter((p) => !excluded.has(p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              );
            })}
            <div style={{ display: "flex", gap: 4, marginTop: 2, justifyContent: align === "right" ? "flex-end" : "flex-start" }}>
              <button className="icon-btn" style={{ color: "var(--green)" }} onClick={saveSwap}><Check size={13} /></button>
              <button className="icon-btn" style={{ color: "var(--fade)" }} onClick={() => setSwappingSide(null)}><X size={13} /></button>
            </div>
          </div>
        );
      }
      return (
        <div className={`tmatch-team ${m.winner_team_id === teamId ? "winner" : ""}`} style={{ textAlign: align, flex: 1 }}>
          {team?.name || "TBD"}
          {canSwap && (
            <button
              onClick={() => beginSwap(m, side)}
              style={{ background: "none", border: "none", color: "var(--fade)", padding: 0, marginLeft: 4, cursor: "pointer", verticalAlign: -1 }}
              title="Swap player"
            >
              <Pencil size={10} />
            </button>
          )}
        </div>
      );
    }

    return (
      <div key={m.id} className="tmatch-card">
        {m.is_third_place ? (
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--citrus)", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>
            3rd Place Match
          </div>
        ) : matchNumber != null && (
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--fade)", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 6 }}>
            Match {matchNumber}
          </div>
        )}
        <div className="tmatch-teams">
          {renderTeamSide(t1, m.team1_id, "team1", "left")}
          <div className="tmatch-vs">vs</div>
          {renderTeamSide(t2, m.team2_id, "team2", "right")}
        </div>

        {m.status === "completed" && (
          <div style={{ textAlign: "center", fontSize: 12, color: "var(--fade)", marginTop: 6 }}>
            {m.is_tie ? "Tied" : tournament.scoring_mode === "score" ? `${m.team1_score} \u2013 ${m.team2_score}` : "Final"}
            {isHost && editingMatchId !== m.id && (
              <button
                onClick={() => beginEditMatch(m)}
                style={{ background: "none", border: "none", color: "var(--green)", fontSize: 10.5, fontWeight: 700, marginLeft: 8, cursor: "pointer", padding: 0 }}
              >
                Edit
              </button>
            )}
          </div>
        )}

        {isHost && t1 && t2 && (m.status !== "completed" || editingMatchId === m.id) && (
          <div style={{ marginTop: 10 }}>
            {m.status === "scheduled" && (
              <button className="btn btn-primary btn-small" style={{ width: "100%" }} onClick={() => startMatch(m)}>
                <Play size={12} style={{ verticalAlign: -2 }} /> Start match
              </button>
            )}
            {(m.status === "in_progress" || editingMatchId === m.id) && tournament.scoring_mode === "score" && (
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="dashed-input score-input" type="number" placeholder="0"
                  style={{ flex: "0 0 40px", width: 40, minWidth: 0, textAlign: "center" }}
                  value={draft.s1 ?? ""}
                  onChange={(e) => setScoreDrafts((d) => ({ ...d, [m.id]: { ...d[m.id], s1: e.target.value } }))}
                />
                <span style={{ fontSize: 11, color: "var(--fade)", flexShrink: 0 }}>vs</span>
                <input
                  className="dashed-input score-input" type="number" placeholder="0"
                  style={{ flex: "0 0 40px", width: 40, minWidth: 0, textAlign: "center" }}
                  value={draft.s2 ?? ""}
                  onChange={(e) => setScoreDrafts((d) => ({ ...d, [m.id]: { ...d[m.id], s2: e.target.value } }))}
                />
                <button className="btn btn-primary btn-icon-square" style={{ flexShrink: 0, marginLeft: "auto" }} onClick={() => submitResult(m)}>&#10003;</button>
                {editingMatchId === m.id && (
                  <button className="icon-btn" style={{ flexShrink: 0, color: "var(--fade)" }} onClick={() => setEditingMatchId(null)}><X size={14} /></button>
                )}
              </div>
            )}
            {(m.status === "in_progress" || editingMatchId === m.id) && tournament.scoring_mode === "winloss" && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn btn-primary btn-small" onClick={() => submitResult(m, "team1")}>{t1.name} won</button>
                <button className="btn btn-primary btn-small" onClick={() => submitResult(m, "team2")}>{t2.name} won</button>
                {allowTie && (
                  <button className="btn btn-outline-coral btn-small" onClick={() => submitResult(m, "tie")}>Tie</button>
                )}
                {editingMatchId === m.id && (
                  <button className="icon-btn" style={{ color: "var(--fade)" }} onClick={() => setEditingMatchId(null)}><X size={14} /></button>
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
  const playersById = Object.fromEntries(players.map((p) => [p.id, p]));
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
      return playoffStageMatches.find((m) => m.round_number === finalRound && !m.is_third_place && m.status === "completed") || null;
    }
    if (tournament?.format === "single_elim" && rounds.length > 0) {
      return matches.find((m) => m.round_number === Math.max(...rounds) && !m.is_third_place && m.status === "completed") || null;
    }
    return null;
  })();
  const thirdPlaceMatch = matches.find((m) => m.is_third_place) || null;

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

                <LevelsEditor levelNames={levelNames} setLevelNames={setLevelNames} newLevelInput={newLevelInput} setNewLevelInput={setNewLevelInput} />

                <div className="field-label" style={{ marginTop: 14 }}>Format</div>
                <select className="solid-input" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="round_robin">Round robin</option>
                  <option value="single_elim">Single-elimination bracket</option>
                </select>

                {format === "round_robin" && (
                  <>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      <input type="checkbox" checked={!fixedPartners} onChange={(e) => setFixedPartners(!e.target.checked)} />
                      Open play — rotate partners/opponents each match
                    </label>
                    <div className="helper-text">
                      No fixed teams. Add individual players; every match pairs people up fresh so everyone gets a chance to partner with — and play against — everyone else.
                    </div>

                    {!fixedPartners && matchType === "doubles" && (
                      <>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          <input
                            type="checkbox" checked={requireMixedDoubles}
                            onChange={(e) => { setRequireMixedDoubles(e.target.checked); if (e.target.checked) setGroupWomensDoubles(false); }}
                          />
                          Ensure mixed doubles whenever a woman is included
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          <input
                            type="checkbox" checked={groupWomensDoubles}
                            onChange={(e) => { setGroupWomensDoubles(e.target.checked); if (e.target.checked) setRequireMixedDoubles(false); }}
                          />
                          Group women's doubles — match women's pairs against each other
                        </label>
                      </>
                    )}

                    <div className="field-label" style={{ marginTop: 14 }}>Pools</div>
                    <input
                      className="solid-input" type="number" min="1" value={numPools}
                      onChange={(e) => setNumPools(e.target.value)}
                    />
                    <div className="helper-text">
                      Split {fixedPartners ? "teams" : "players"} into separate groups, each running their own {fixedPartners ? "round robin" : "rotation"}. Leave at 1 for a single group.
                    </div>

                    {fixedPartners && (
                      <>
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
                        {advanceCount >= 1 && (
                          <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                            <input type="checkbox" checked={thirdPlaceMatchOpt} onChange={(e) => setThirdPlaceMatchOpt(e.target.checked)} />
                            Include a 3rd place match
                          </label>
                        )}
                      </>
                    )}
                  </>
                )}

                {format === "single_elim" && (
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    <input type="checkbox" checked={thirdPlaceMatchOpt} onChange={(e) => setThirdPlaceMatchOpt(e.target.checked)} />
                    Include a 3rd place match
                  </label>
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
                {createError && <div className="error-text">{createError}</div>}
              </form>
            )}
          </div>
        ) : editingSettings ? (
          <div className="body-scroll">
            <form onSubmit={saveTournamentSettings} style={{ padding: "16px 20px" }}>
              <div className="field-label">Tournament name</div>
              <input className="solid-input" value={name} onChange={(e) => setName(e.target.value)} />

              <LevelsEditor levelNames={levelNames} setLevelNames={setLevelNames} newLevelInput={newLevelInput} setNewLevelInput={setNewLevelInput} />

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
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, fontWeight: 600, cursor: tournament.status === "setup" ? "pointer" : "default" }}>
                    <input
                      type="checkbox" checked={!fixedPartners} disabled={tournament.status !== "setup"}
                      onChange={(e) => setFixedPartners(!e.target.checked)}
                    />
                    Open play — rotate partners/opponents each match
                  </label>

                  {!fixedPartners && matchType === "doubles" && (
                    <>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        <input
                          type="checkbox" checked={requireMixedDoubles}
                          onChange={(e) => { setRequireMixedDoubles(e.target.checked); if (e.target.checked) setGroupWomensDoubles(false); }}
                        />
                        Ensure mixed doubles whenever a woman is included
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                        <input
                          type="checkbox" checked={groupWomensDoubles}
                          onChange={(e) => { setGroupWomensDoubles(e.target.checked); if (e.target.checked) setRequireMixedDoubles(false); }}
                        />
                        Group women's doubles — match women's pairs against each other
                      </label>
                    </>
                  )}

                  <div className="field-label" style={{ marginTop: 14 }}>Pools</div>
                  <input
                    className="solid-input" type="number" min="1" value={numPools} disabled={tournament.status !== "setup"}
                    onChange={(e) => setNumPools(e.target.value)}
                  />

                  {fixedPartners && (
                    <>
                      <div className="field-label" style={{ marginTop: 14 }}>Playoffs</div>
                      <select className="solid-input" value={advanceCount} onChange={(e) => setAdvanceCount(e.target.value)}>
                        <option value={0}>No knockout stage — pool play only</option>
                        <option value={1}>Top 1 per pool advances</option>
                        <option value={2}>Top 2 per pool advance</option>
                        <option value={3}>Top 3 per pool advance</option>
                        <option value={4}>Top 4 per pool advance</option>
                        <option value={5}>Top 5 per pool advance</option>
                      </select>
                      {advanceCount >= 1 && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                          <input type="checkbox" checked={thirdPlaceMatchOpt} onChange={(e) => setThirdPlaceMatchOpt(e.target.checked)} />
                          Include a 3rd place match
                        </label>
                      )}
                    </>
                  )}
                </>
              )}

              {format === "single_elim" && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, fontWeight: 600, cursor: tournament.status === "setup" ? "pointer" : "default" }}>
                  <input type="checkbox" checked={thirdPlaceMatchOpt} disabled={tournament.status !== "setup"} onChange={(e) => setThirdPlaceMatchOpt(e.target.checked)} />
                  Include a 3rd place match
                </label>
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

              <button
                type="button"
                onClick={deleteTournament}
                style={{ width: "100%", marginTop: 14, background: "none", border: "none", color: "var(--coral)", fontSize: 12.5, fontWeight: 700, padding: 8, cursor: "pointer" }}
              >
                Delete this tournament
              </button>
            </form>
          </div>
        ) : (
          <>
            <div className="event-tabs">
              <button className={`event-tab ${tab === "teams" ? "selected" : ""}`} onClick={() => setTab("teams")}>
                {tournament.fixed_partners === false ? "Players" : "Teams"} &middot; {tournament.fixed_partners === false ? players.filter((p) => p.active).length : teams.length}
              </button>
              <button className={`event-tab ${tab === "courts" ? "selected" : ""}`} onClick={() => setTab("courts")}>Courts &middot; {courts.length}</button>
              <button className={`event-tab ${tab === "matches" ? "selected" : ""}`} onClick={() => setTab("matches")}>Matches</button>
              <button className={`event-tab ${tab === "standings" ? "selected" : ""}`} onClick={() => setTab("standings")}>Standings</button>
            </div>

            {tab === "teams" && tournament.fixed_partners === false && (
              <div className="body-scroll">
                {isHost && (
                  <form onSubmit={addPlayer} style={{ marginBottom: 16 }}>
                    <div className="field-label">Player name</div>
                    <input className="solid-input" value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Name" />
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <select className="solid-input" value={playerGender} onChange={(e) => setPlayerGender(e.target.value)}>
                        <option value="">Gender (optional)</option>
                        <option value="men">Men</option>
                        <option value="women">Women</option>
                      </select>
                      {tournament.level_names?.length > 0 ? (
                        <select className="solid-input" value={playerLevel} onChange={(e) => setPlayerLevel(e.target.value)}>
                          <option value="">Level (optional)</option>
                          {tournament.level_names.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                        </select>
                      ) : (
                        <input className="solid-input" value={playerLevel} onChange={(e) => setPlayerLevel(e.target.value)} placeholder="Level (optional)" />
                      )}
                    </div>
                    {tournament.num_pools > 1 && (
                      <>
                        <div className="field-label" style={{ marginTop: 10 }}>Pool</div>
                        <select className="solid-input" value={playerPool} onChange={(e) => setPlayerPool(e.target.value)}>
                          {Array.from({ length: tournament.num_pools }, (_, i) => i + 1).map((p) => (
                            <option key={p} value={p}>Pool {p}</option>
                          ))}
                        </select>
                      </>
                    )}
                    <button className="btn btn-primary btn-block" style={{ marginTop: 10 }} type="submit">
                      <Plus size={14} style={{ verticalAlign: -2 }} /> Add player
                    </button>
                    <div className="helper-text">
                      Add players anytime, even mid-session — a latecomer gets automatically prioritized in future matches until their game count catches up.
                    </div>
                  </form>
                )}

                {(() => {
                  const renderPlayerCard = (p) => (
                    <div key={p.id} className="mine-card" style={{ opacity: p.active ? 1 : 0.5 }}>
                      <div>
                        <div className="name">{p.name}{!p.active && " (removed)"}</div>
                        <div className="sub">{[p.gender, p.level].filter(Boolean).join(" \u00B7 ") || "No gender/level set"}</div>
                      </div>
                      {isHost && p.active && (
                        <button className="icon-btn" style={{ color: "var(--coral)" }} onClick={() => removePlayer(p.id)}><X size={15} /></button>
                      )}
                    </div>
                  );

                  if (tournament.num_pools > 1) {
                    return [...new Set(players.map((p) => p.pool_number))].sort((a, b) => a - b).map((poolNum) => (
                      <div key={poolNum}>
                        <div className="round-header" style={{ fontSize: 13, color: "var(--ink)", paddingTop: 12 }}>
                          POOL {poolNum} &middot; {players.filter((p) => p.pool_number === poolNum && p.active).length}
                        </div>
                        {players.filter((p) => p.pool_number === poolNum).map(renderPlayerCard)}
                      </div>
                    ));
                  }
                  return players.map(renderPlayerCard);
                })()}

                {isHost && tournament.num_pools > 1 && players.filter((p) => p.active).length >= 2 && (
                  <button className="btn btn-primary btn-block" style={{ marginTop: 4, marginBottom: 12 }} onClick={autoAssignPlayerPools}>
                    Auto-assign pools
                  </button>
                )}

                {isHost && (
                  <div className="card" style={{ marginTop: 16 }}>
                    <div className="field-label" style={{ marginBottom: 8 }}>
                      {matches.length > 0 ? "Generate more matches" : "Generate matches"}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        className="solid-input" type="number" min="1" value={roundsToGenerate}
                        onChange={(e) => setRoundsToGenerate(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="btn btn-accent" style={{ padding: "0 18px", borderRadius: 12 }}
                        onClick={() => generateOpenPlayRounds(Math.max(1, Number(roundsToGenerate) || 1))}
                        disabled={generating || players.filter((p) => p.active).length < (tournament.match_type === "doubles" ? 4 : 2)}
                      >
                        {generating ? "Generating..." : "Generate"}
                      </button>
                    </div>
                    {players.filter((p) => p.active).length < (tournament.match_type === "doubles" ? 4 : 2) && (
                      <div className="helper-text">
                        Need at least {tournament.match_type === "doubles" ? 4 : 2} active players to generate a match.
                      </div>
                    )}
                    <div className="helper-text">
                      {courts.length > 0
                        ? `Matches run up to ${courts.length} at once, matching your ${courts.length} court${courts.length !== 1 ? "s" : ""} — set this on the Courts tab.`
                        : "No courts added yet — every active player will be scheduled every time you generate, with no cap. Add courts on the Courts tab to limit how many matches run at once."}
                    </div>

                    {lastGeneratedFromRound !== null && matches.some((m) => m.round_number > lastGeneratedFromRound) && (
                      <button
                        onClick={undoLastGeneration}
                        style={{ width: "100%", marginTop: 10, background: "none", border: "none", color: "var(--coral)", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 4 }}
                      >
                        Undo last generation
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === "teams" && tournament.fixed_partners !== false && (
              <div className="body-scroll">
                {isHost && tournament.status === "setup" && (
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
                      {tournament.level_names?.length > 0 ? (
                        <select className="solid-input" value={teamLevel} onChange={(e) => setTeamLevel(e.target.value)}>
                          <option value="">Level (optional)</option>
                          {tournament.level_names.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                        </select>
                      ) : (
                        <input className="solid-input" value={teamLevel} onChange={(e) => setTeamLevel(e.target.value)} placeholder="Level (optional)" />
                      )}
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

                {(() => {
                  const renderTeamCard = (t) => (
                    <div key={t.id} className="mine-card">
                      <div>
                        <div className="name">{t.name}</div>
                        <div className="sub">
                          {[
                            tournament.format === "single_elim" && t.seed ? `Seed ${t.seed}` : null,
                            t.gender,
                            t.level,
                          ].filter(Boolean).join(" \u00B7 ") || "No gender/level set"}
                        </div>
                      </div>
                      {isHost && tournament.status === "setup" && (
                        <button className="icon-btn" style={{ color: "var(--coral)" }} onClick={() => removeTeam(t.id)}><X size={15} /></button>
                      )}
                    </div>
                  );

                  if (tournament.format === "round_robin" && tournament.num_pools > 1) {
                    return [...new Set(teams.map((t) => t.pool_number))].sort((a, b) => a - b).map((poolNum) => (
                      <div key={poolNum}>
                        <div className="round-header" style={{ fontSize: 13, color: "var(--ink)", paddingTop: 12 }}>
                          POOL {poolNum} &middot; {teams.filter((t) => t.pool_number === poolNum).length}
                        </div>
                        {teams.filter((t) => t.pool_number === poolNum).map(renderTeamCard)}
                      </div>
                    ));
                  }
                  return teams.map(renderTeamCard);
                })()}

                {isHost && tournament.status === "setup" && teams.length >= 2 && tournament.format === "round_robin" && tournament.num_pools > 1 && (
                  <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={autoAssignPools}>
                    Auto-assign pools
                  </button>
                )}
                {isHost && tournament.status === "setup" && teams.length >= 2 && tournament.format === "single_elim" && (
                  <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} onClick={randomizeSeeding}>
                    Randomize seeding
                  </button>
                )}

                {isHost && tournament.status === "setup" && teams.length >= 2 && (
                  <button className="btn btn-accent btn-block" style={{ marginTop: 10 }} onClick={generateMatches} disabled={generating}>
                    {generating ? "Generating..." : `Generate ${tournament.format === "round_robin" ? "round robin" : "bracket"}`}
                  </button>
                )}
                {isHost && tournament.status === "setup" && teams.length < 2 && (
                  <div className="helper-text">Add at least 2 teams to generate matches.</div>
                )}
                {tournament.status !== "setup" && (
                  <div className="helper-text" style={{ marginTop: 12 }}>
                    Matches have already been generated — the roster is locked. See the Matches tab for results.
                  </div>
                )}
              </div>
            )}

            {tab === "courts" && (
              <div className="body-scroll">
                {isHost && (
                  <form onSubmit={editingCourtId ? saveCourtEdit : addCourt} style={{ marginBottom: 16 }}>
                    <div className="field-label">{editingCourtId ? "Edit court" : "Court label"}</div>
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
                    {tournament.level_names?.length > 0 ? (
                      <select className="solid-input" style={{ marginTop: 10 }} value={courtLevel} onChange={(e) => setCourtLevel(e.target.value)}>
                        <option value="">No level restriction</option>
                        {tournament.level_names.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                      </select>
                    ) : (
                      <input className="solid-input" style={{ marginTop: 10 }} value={courtLevel} onChange={(e) => setCourtLevel(e.target.value)} placeholder="Level restriction (optional)" />
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      {editingCourtId && (
                        <button
                          type="button" className="btn btn-outline-coral btn-small"
                          onClick={() => { setEditingCourtId(null); setCourtLabel(""); setCourtGender("any"); setCourtLevel(""); setCourtMatchType("any"); }}
                        >
                          Cancel
                        </button>
                      )}
                      <button className="btn btn-primary" style={{ flex: editingCourtId ? 2 : 1, borderRadius: 14 }} type="submit">
                        {editingCourtId ? "Save changes" : (<><Plus size={14} style={{ verticalAlign: -2 }} /> Add court</>)}
                      </button>
                    </div>
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
                      <div style={{ display: "flex", gap: 10 }}>
                        <button className="icon-btn" style={{ color: "var(--fade)" }} onClick={() => beginEditCourt(c)}><Pencil size={14} /></button>
                        <button className="icon-btn" style={{ color: "var(--coral)" }} onClick={() => removeCourt(c.id)}><X size={15} /></button>
                      </div>
                    )}
                  </div>
                ))}
                {courts.length === 0 && <div className="helper-text">No courts added — matches will need manual court assignment.</div>}
              </div>
            )}

            {tab === "matches" && (
              <div className="body-scroll">
                {matches.length > 0 && (
                  <div style={{ padding: "14px 20px 0" }}>
                    <button
                      onClick={downloadSchedulePDF}
                      style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: `1px solid var(--line)`, borderRadius: 10, padding: "8px 12px", fontSize: 12, fontWeight: 700, color: "var(--ink)", cursor: "pointer" }}
                    >
                      <Download size={13} /> Download schedule (PDF)
                    </button>
                  </div>
                )}
                {(tournament.num_pools > 1 ? [...new Set(matches.filter((m) => m.stage === "group").map((m) => m.pool_number))].sort((a, b) => a - b) : [1]).map((poolNum) => {
                  const poolMatches = tournament.num_pools > 1
                    ? matches.filter((m) => m.stage === "group" && m.pool_number === poolNum)
                    : matches.filter((m) => m.stage === "group");
                  const poolRounds = [...new Set(poolMatches.map((m) => m.round_number))].sort((a, b) => a - b);

                  if (tournament.fixed_partners === false) {
                    // Open play: no "Round" grouping headers — just every
                    // match, in order, numbered sequentially.
                    const sortedMatches = [...poolMatches].sort(
                      (a, b) => a.round_number - b.round_number || a.match_index - b.match_index
                    );
                    return (
                      <div key={poolNum}>
                        {tournament.num_pools > 1 && (
                          <div className="round-header" style={{ fontSize: 14, color: "var(--ink)", paddingTop: 18 }}>POOL {poolNum}</div>
                        )}
                        {sortedMatches.map((m, idx) => renderMatchCard(m, idx + 1))}
                      </div>
                    );
                  }

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
                          {poolMatches.filter((m) => m.round_number === r).sort((a, b) => a.match_index - b.match_index).map((m) => renderMatchCard(m))}
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
                            {playoffMatches.filter((m) => m.round_number === r).sort((a, b) => a.match_index - b.match_index).map((m) => renderMatchCard(m))}
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

                {(() => {
                  const bracketMatches = tournament.format === "single_elim" ? groupStageMatches : playoffStageMatches;
                  if (bracketMatches.length === 0) return null;
                  const bracketRounds = [...new Set(bracketMatches.map((m) => m.round_number))].sort((a, b) => a - b);
                  const totalBracketRounds = Math.max(...bracketRounds);
                  return (
                    <div style={{ marginBottom: 18 }}>
                      <div className="round-header" style={{ fontSize: 14, color: "var(--ink)", paddingTop: 0 }}>
                        {tournament.format === "single_elim" ? "BRACKET RESULTS" : "PLAYOFF RESULTS"}
                      </div>
                      {bracketRounds.map((r) => (
                        <div key={r} style={{ padding: "0 20px", marginBottom: 10 }}>
                          <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fade)", textTransform: "uppercase", marginBottom: 6 }}>
                            {roundLabel(r, totalBracketRounds)}
                          </div>
                          {bracketMatches.filter((m) => m.round_number === r).map((m) => {
                            const t1 = m.team1_id ? teamsById[m.team1_id] : null;
                            const t2 = m.team2_id ? teamsById[m.team2_id] : null;
                            if (m.status === "bye") {
                              return (
                                <div key={m.id} style={{ fontSize: 12.5, padding: "5px 0", color: "var(--ink)" }}>
                                  <strong>{t1?.name || "TBD"}</strong> — bye
                                </div>
                              );
                            }
                            return (
                              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
                                <div>
                                  <span style={{ fontWeight: m.winner_team_id === m.team1_id ? 700 : 400, color: m.winner_team_id === m.team1_id ? "var(--green)" : "var(--ink)" }}>
                                    {t1?.name || "TBD"}
                                  </span>
                                  {" vs "}
                                  <span style={{ fontWeight: m.winner_team_id === m.team2_id ? 700 : 400, color: m.winner_team_id === m.team2_id ? "var(--green)" : "var(--ink)" }}>
                                    {t2?.name || "TBD"}
                                  </span>
                                </div>
                                <div style={{ color: "var(--fade)", flexShrink: 0, marginLeft: 8 }}>
                                  {m.status === "completed"
                                    ? tournament.scoring_mode === "score" ? `${m.team1_score}\u2013${m.team2_score}` : "Final"
                                    : "Pending"}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {tournament.fixed_partners === false ? (
                  (tournament.num_pools > 1
                    ? [...new Set(players.map((p) => p.pool_number))].sort((a, b) => a - b)
                    : [null]
                  ).map((poolNum) => (
                    <div key={poolNum ?? "all"}>
                      {poolNum !== null && (
                        <div className="round-header" style={{ fontSize: 13, color: "var(--ink)" }}>POOL {poolNum}</div>
                      )}
                      <table className="standings-table">
                        <thead>
                          <tr>
                            <th>Player</th>
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
                          {computePlayerStandings(players, teams, matches)
                            .filter((s) => poolNum === null || s.player.pool_number === poolNum)
                            .map((s) => (
                              <tr key={s.player.id} style={{ opacity: s.player.active ? 1 : 0.5 }}>
                                <td>{s.player.name}{!s.player.active && " (removed)"}</td>
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
                  ))
                ) : (
                  (tournament.num_pools > 1
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
                  ))
                )}
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

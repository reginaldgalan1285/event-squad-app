import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Trophy, Play, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { generateRoundRobin, buildBracketSkeleton, computeStandings } from "../lib/tournament";

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

  const [event, setEvent] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [teams, setTeams] = useState([]);
  const [courts, setCourts] = useState([]);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("teams");
  const [generating, setGenerating] = useState(false);

  const [name, setName] = useState("Tournament");
  const [format, setFormat] = useState("round_robin");
  const [matchType, setMatchType] = useState("doubles");
  const [scoringMode, setScoringMode] = useState("score");
  const [defaultMinutes, setDefaultMinutes] = useState(15);

  const [teamName, setTeamName] = useState("");
  const [player1, setPlayer1] = useState("");
  const [player2, setPlayer2] = useState("");
  const [teamGender, setTeamGender] = useState("");
  const [teamLevel, setTeamLevel] = useState("");

  const [courtLabel, setCourtLabel] = useState("");
  const [courtGender, setCourtGender] = useState("any");
  const [courtLevel, setCourtLevel] = useState("");
  const [courtMatchType, setCourtMatchType] = useState("any");

  const [scoreDrafts, setScoreDrafts] = useState({});

  const isHost = !!session && event?.host_id === session.user.id;

  const loadAll = useCallback(async () => {
    const { data: eventData } = await supabase.from("events").select("*").eq("id", eventId).single();
    setEvent(eventData);

    const { data: tData } = await supabase.from("tournaments").select("*").eq("event_id", eventId).maybeSingle();
    setTournament(tData);

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
    }
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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
      })
      .select()
      .single();
    if (!error) setTournament(data);
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
    });
    setTeamName(""); setPlayer1(""); setPlayer2(""); setTeamGender(""); setTeamLevel("");
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
    const rounds = [...new Set(freshMatches.map((m) => m.round_number))];
    for (const r of rounds) {
      const roundMatches = freshMatches.filter((m) => m.round_number === r && m.status !== "bye" && m.team1_id && m.team2_id);
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

  async function generateMatches() {
    if (teams.length < 2) return;
    setGenerating(true);

    const teamIds = teams.map((t) => t.id);
    const skeleton = tournament.format === "round_robin" ? generateRoundRobin(teamIds) : buildBracketSkeleton(teamIds);

    const rows = skeleton.map((m) => ({
      tournament_id: tournament.id,
      round_number: m.round,
      match_index: m.matchIndex,
      team1_id: m.team1,
      team2_id: m.team2,
      status: m.isBye ? "bye" : "scheduled",
      winner_team_id: m.isBye ? m.team1 : null,
      match_minutes: tournament.default_match_minutes,
    }));

    const { data: insertedRows } = await supabase.from("tournament_matches").insert(rows).select();
    const byKey = Object.fromEntries((insertedRows || []).map((r) => [`${r.round_number}-${r.match_index}`, r]));

    if (tournament.format === "single_elim") {
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

    await supabase.from("tournaments").update({ status: "in_progress" }).eq("id", tournament.id);

    const { data: freshMatches } = await supabase.from("tournament_matches").select("*").eq("tournament_id", tournament.id);
    await assignCourts(freshMatches || [], courts, teams);

    setGenerating(false);
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

    if (tournament.scoring_mode === "score") {
      const draft = scoreDrafts[match.id] || {};
      s1 = Number(draft.s1);
      s2 = Number(draft.s2);
      if (Number.isNaN(s1) || Number.isNaN(s2)) return;
      if (s1 === s2) {
        if (tournament.format === "single_elim") {
          alert("Bracket matches need a winner — scores can't tie.");
          return;
        }
        is_tie = true;
      } else {
        winner_team_id = s1 > s2 ? match.team1_id : match.team2_id;
      }
    } else {
      if (winnerChoice === "tie") {
        if (tournament.format === "single_elim") {
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

    if (tournament.format === "single_elim" && match.next_match_id && winner_team_id) {
      const field = match.next_match_slot === 1 ? "team1_id" : "team2_id";
      await supabase.from("tournament_matches").update({ [field]: winner_team_id }).eq("id", match.next_match_id);
    }

    await loadAll();
  }

  async function assignCourtManually(matchId, courtId) {
    await supabase.from("tournament_matches").update({ court_id: courtId || null }).eq("id", matchId);
    await loadAll();
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
  const rounds = [...new Set(matches.map((m) => m.round_number))].sort((a, b) => a - b);
  const standings = tournament ? computeStandings(teams, matches) : [];
  const champion =
    tournament?.format === "single_elim" && rounds.length > 0
      ? matches.find((m) => m.round_number === Math.max(...rounds) && m.status === "completed")
      : null;

  return (
    <div className="app-shell">
      <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
      <div className="phone">
        <div className="header">
          <div className="header-row">
            <button className="icon-btn" onClick={() => navigate(`/event/${eventId}`)}><ArrowLeft size={18} /></button>
            <div className="title-display" style={{ fontSize: 17 }}>
              <Trophy size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
              {tournament?.name || "Tournament"}
            </div>
          </div>
          {event && <div style={{ fontSize: 11.5, opacity: 0.85, marginTop: 6 }}>{event.title}</div>}
        </div>

        {!tournament ? (
          <div className="body-scroll">
            {!isHost ? (
              <div className="empty-state">
                <div className="title">No tournament has been set up for this event yet.</div>
              </div>
            ) : (
              <form onSubmit={createTournament}>
                <div className="field-label">Tournament name</div>
                <input className="solid-input" value={name} onChange={(e) => setName(e.target.value)} />

                <div className="field-label" style={{ marginTop: 14 }}>Format</div>
                <select className="solid-input" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="round_robin">Round robin</option>
                  <option value="single_elim">Single-elimination bracket</option>
                </select>

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

                <div className="field-label" style={{ marginTop: 14 }}>Default match length (minutes)</div>
                <input className="solid-input" type="number" min="1" value={defaultMinutes} onChange={(e) => setDefaultMinutes(e.target.value)} />

                <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} type="submit">
                  Create tournament
                </button>
              </form>
            )}
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
                        {[t.gender, t.level].filter(Boolean).join(" \u00B7 ") || "No gender/level set"}
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
                {rounds.map((r) => (
                  <div key={r}>
                    <div className="round-header">
                      {tournament.format === "round_robin" ? `ROUND ${r}` : r === Math.max(...rounds) ? "FINAL" : `ROUND ${r}`}
                    </div>
                    {matches.filter((m) => m.round_number === r).map((m) => {
                      const t1 = m.team1_id ? teamsById[m.team1_id] : null;
                      const t2 = m.team2_id ? teamsById[m.team2_id] : null;
                      const court = m.court_id ? courtsById[m.court_id] : null;
                      const draft = scoreDrafts[m.id] || {};

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
                                  {tournament.format === "round_robin" && (
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
                            <MatchTimer match={m} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
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
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((s) => (
                      <tr key={s.team.id}>
                        <td>{s.team.name}</td>
                        <td>{s.played}</td>
                        <td>{s.wins}</td>
                        <td>{s.losses}</td>
                        <td>{s.ties}</td>
                        <td>{(s.winPct * 100).toFixed(0)}%</td>
                        <td>{s.pointDiff > 0 ? `+${s.pointDiff}` : s.pointDiff}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

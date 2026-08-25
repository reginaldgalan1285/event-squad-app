import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, Plus, Users, MapPin, Calendar, UserPlus, ChevronDown, Check, Clock, LogOut, ArrowLeft, Pencil } from "lucide-react";
import { supabase } from "../supabaseClient";
import { SPORTS, initials } from "../lib/constants";

function countFor(entity) {
  return 1 + (entity.guests?.length || 0);
}

export default function EventScreen({ session }) {
  const { eventId } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [guestInputs, setGuestInputs] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingPrice, setSavingPrice] = useState(false);
  const [editingPrice, setEditingPrice] = useState(false);
  const [priceDraft, setPriceDraft] = useState(0);
  const [editingMax, setEditingMax] = useState(false);
  const [maxDraft, setMaxDraft] = useState("");
  const [editingGuestId, setEditingGuestId] = useState(null);
  const [guestEditDraft, setGuestEditDraft] = useState("");

  const isHost = event?.host_id === session.user.id;
  const isMember = members.some((m) => m.user_id === session.user.id);
  const hasPendingRequest = requests.some((r) => r.user_id === session.user.id);

  const loadAll = useCallback(async () => {
    const { data: eventData } = await supabase.from("events").select("*").eq("id", eventId).single();
    setEvent(eventData);
    if (eventData) {
      setPriceDraft(eventData.price_per_player);
      setMaxDraft(eventData.max_players ?? "");
    }

    const { data: memberData } = await supabase
      .from("event_members")
      .select("*, guests(*)")
      .eq("event_id", eventId)
      .order("joined_at", { ascending: true });
    setMembers(memberData || []);

    const { data: requestData } = await supabase
      .from("payment_requests")
      .select("*")
      .eq("event_id", eventId)
      .in("status", ["pending_approval", "awaiting_payment"])
      .order("created_at", { ascending: true });
    setRequests(requestData || []);

    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    loadAll();

    const channel = supabase
      .channel(`event-${eventId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_members", filter: `event_id=eq.${eventId}` }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "guests" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_requests", filter: `event_id=eq.${eventId}` }, loadAll)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, loadAll]);

  const totalPlayers = members.reduce((sum, m) => sum + countFor(m), 0);
  const totalPrice = totalPlayers * Number(event?.price_per_player || 0);

  async function handleSportChange(newSport) {
    await supabase.from("events").update({ sport: newSport }).eq("id", eventId);
    await loadAll();
  }

  async function savePrice() {
    setSavingPrice(true);
    await supabase.from("events").update({ price_per_player: Number(priceDraft) || 0 }).eq("id", eventId);
    setSavingPrice(false);
    setEditingPrice(false);
    await loadAll();
  }

  async function saveMaxPlayers() {
    await supabase
      .from("events")
      .update({ max_players: maxDraft === "" ? null : Number(maxDraft) })
      .eq("id", eventId);
    setEditingMax(false);
    await loadAll();
  }

  async function toggleAllowLeave() {
    await supabase.from("events").update({ allow_leave: !(event.allow_leave !== false) }).eq("id", eventId);
    await loadAll();
  }

  async function addGuestTo(memberId, e) {
    e.preventDefault();
    const trimmed = (guestInputs[memberId] || "").trim();
    if (!trimmed) return;
    if (event?.max_players != null && totalPlayers >= event.max_players) {
      alert("This event is at its player limit.");
      return;
    }
    await supabase.from("guests").insert({ member_id: memberId, name: trimmed });
    setGuestInputs((g) => ({ ...g, [memberId]: "" }));
    await loadAll();
  }

  async function removeGuest(guestId) {
    await supabase.from("guests").delete().eq("id", guestId);
    await loadAll();
  }

  async function editGuestName(guestId) {
    const trimmed = guestEditDraft.trim();
    if (!trimmed) {
      setEditingGuestId(null);
      return;
    }
    await supabase.from("guests").update({ name: trimmed }).eq("id", guestId);
    setEditingGuestId(null);
    await loadAll();
  }

  async function leaveEvent(memberId) {
    if (!window.confirm("Leave this event? This removes you and any guests you added.")) return;
    await supabase.from("event_members").delete().eq("id", memberId);
    await loadAll();
  }

  async function withdrawRequest(requestId) {
    if (!window.confirm("Withdraw your request to join? This cancels your spot and any guests you added.")) return;
    await supabase.from("payment_requests").delete().eq("id", requestId);
    await loadAll();
  }

  async function approveRequest(requestId) {
    await supabase.rpc("approve_payment_request", { request_id: requestId });
    await loadAll();
  }

  async function declineRequest(requestId) {
    await supabase.from("payment_requests").update({ status: "declined" }).eq("id", requestId);
    await loadAll();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  if (loading || !event) {
    return (
      <div className="app-shell">
        <div className="phone" style={{ alignItems: "center", justifyContent: "center" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="phone">
        <div className="header">
          <div className="header-row" style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button className="icon-btn" onClick={() => navigate("/")}><ArrowLeft size={18} /></button>
            <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
              <select
                className="pill-select"
                value={event.sport}
                onChange={(e) => handleSportChange(e.target.value)}
                disabled={!isHost}
              >
                {SPORTS.map((s) => (
                  <option key={s} value={s} style={{ color: "#16233a" }}>Open Play &middot; {s}</option>
                ))}
              </select>
              <ChevronDown size={12} style={{ position: "absolute", right: 8, pointerEvents: "none", opacity: 0.8 }} />
            </div>
            </div>
            <button className="icon-btn" onClick={handleSignOut} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>

          <div className="title-display" style={{ marginTop: 8 }}>{event.title}</div>
          <div className="meta-row">
            <span><Calendar size={13} /> {new Date(event.event_date).toLocaleString()}</span>
            {event.location && <span><MapPin size={13} /> {event.location}</span>}
          </div>

          <div className="price-chip">
            <span className="label">Price per player</span>
            {isHost && editingPrice ? (
              <input
                type="number"
                autoFocus
                value={priceDraft}
                onChange={(e) => setPriceDraft(e.target.value)}
                onBlur={savePrice}
                onKeyDown={(e) => e.key === "Enter" && savePrice()}
              />
            ) : (
              <button onClick={() => isHost && setEditingPrice(true)}>
                ₱{Number(event.price_per_player).toLocaleString()}
                {isHost && <span style={{ fontSize: 10, opacity: 0.6, color: "#fff" }}> edit</span>}
              </button>
            )}
          </div>

          <div className="price-chip" style={{ marginTop: 8 }}>
            <span className="label">Max players</span>
            {isHost && editingMax ? (
              <input
                type="number"
                autoFocus
                min="1"
                value={maxDraft}
                placeholder="No limit"
                onChange={(e) => setMaxDraft(e.target.value)}
                onBlur={saveMaxPlayers}
                onKeyDown={(e) => e.key === "Enter" && saveMaxPlayers()}
              />
            ) : (
              <button onClick={() => isHost && setEditingMax(true)}>
                {event.max_players ? `${totalPlayers} / ${event.max_players}` : `${totalPlayers} · no limit`}
                {isHost && <span style={{ fontSize: 10, opacity: 0.6, color: "#fff" }}> edit</span>}
              </button>
            )}
          </div>

          <div className="price-chip" style={{ marginTop: 8 }}>
            <span className="label">Players can leave</span>
            {isHost ? (
              <button onClick={toggleAllowLeave}>
                {event.allow_leave !== false ? "On" : "Off"}
              </button>
            ) : (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: "var(--citrus)" }}>
                {event.allow_leave !== false ? "Allowed" : "Locked"}
              </span>
            )}
          </div>
        </div>

        <div className="body-scroll">
          <div className="section-title"><Users size={15} /> CONFIRMED &middot; {totalPlayers}</div>

          {members.map((member) => {
            const memberIsHost = member.is_host;
            const memberIsMe = member.user_id === session.user.id;
            return (
              <div key={member.id} className="card">
                <div className="member-row">
                  <div className={`avatar ${memberIsHost ? "host" : "member"}`}>{initials(member.name)}</div>
                  <div>
                    <div className="member-name">{member.name}</div>
                    <div className="member-sub">{memberIsHost ? "Host · logged in" : "Confirmed · paid"}</div>
                  </div>
                </div>

                {member.guests?.length > 0 && (
                  <div className="guest-list">
                    {member.guests.map((g) => {
                      const canManage = (memberIsHost && isHost) || (memberIsMe && !memberIsHost);
                      const canDelete = memberIsHost && isHost;
                      const isEditing = editingGuestId === g.id;
                      return (
                        <div key={g.id} className="guest-row">
                          {isEditing ? (
                            <>
                              <div className="left" style={{ flex: 1 }}>
                                <div className="avatar guest">{initials(guestEditDraft)}</div>
                                <input
                                  className="dashed-input"
                                  style={{ padding: "4px 8px", fontSize: 13 }}
                                  autoFocus
                                  value={guestEditDraft}
                                  onChange={(e) => setGuestEditDraft(e.target.value)}
                                  onKeyDown={(e) => e.key === "Enter" && editGuestName(g.id)}
                                />
                              </div>
                              <button className="icon-btn" style={{ color: "var(--green)" }} onClick={() => editGuestName(g.id)}>
                                <Check size={14} />
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="left">
                                <div className="avatar guest">{initials(g.name)}</div>
                                <span className="name">{g.name}</span>
                                <span className="tag">no account</span>
                              </div>
                              <div style={{ display: "flex", gap: 6 }}>
                                {canManage && (
                                  <button
                                    className="icon-btn"
                                    style={{ color: "var(--fade)" }}
                                    onClick={() => { setEditingGuestId(g.id); setGuestEditDraft(g.name); }}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                )}
                                {canDelete && (
                                  <button className="icon-btn" style={{ color: "#ff6152" }} onClick={() => removeGuest(g.id)}>
                                    <X size={13} />
                                  </button>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {memberIsHost && isHost && (
                  <form className="dashed-row" onSubmit={(e) => addGuestTo(member.id, e)}>
                    <input
                      className="dashed-input"
                      value={guestInputs[member.id] || ""}
                      onChange={(e) => setGuestInputs((g) => ({ ...g, [member.id]: e.target.value }))}
                      placeholder="Add a player you're bringing"
                    />
                    <button className="btn btn-primary btn-icon-square" type="submit"><Plus size={15} /></button>
                  </form>
                )}

                {memberIsMe && !memberIsHost && (
                  <>
                    <button
                      className="dashed-join-btn"
                      style={{ marginTop: 10 }}
                      onClick={() => navigate(`/event/${eventId}/topup/${member.id}`)}
                    >
                      <Plus size={14} /> Add a guest &middot; ₱{Number(event.price_per_player).toLocaleString()} each
                    </button>
                    {event.allow_leave !== false ? (
                      <button
                        className="btn btn-outline-coral btn-small"
                        style={{ width: "100%", marginTop: 8 }}
                        onClick={() => leaveEvent(member.id)}
                      >
                        Leave event
                      </button>
                    ) : (
                      <div style={{ fontSize: 10.5, color: "var(--fade)", textAlign: "center", marginTop: 8 }}>
                        The host has locked the roster — message them to be removed.
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {requests.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 16 }}>PENDING REQUESTS &middot; {requests.length}</div>
              {requests.map((r) => {
                const isTopUp = !!r.member_id;
                const count = isTopUp ? (r.guest_names?.length || 0) : 1 + (r.guest_names?.length || 0);
                return (
                  <div key={r.id} className="request-card">
                    <div className="member-name">{r.name}</div>
                    <div style={{ fontSize: 11.5, color: "#8a9a93", marginTop: 2 }}>
                      {isTopUp
                        ? `+${count} more guest${count !== 1 ? "s" : ""} · ₱${Number(r.amount).toLocaleString()}`
                        : `${count} players · ₱${Number(r.amount).toLocaleString()}`}
                    </div>
                    {r.status === "pending_approval" ? (
                      <div className="status-line paid"><Check size={12} /> Payment sent &middot; awaiting host approval</div>
                    ) : (
                      <div className="status-line waiting"><Clock size={12} /> Awaiting payment</div>
                    )}
                    {isHost && r.status === "pending_approval" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button className="btn btn-primary btn-small" onClick={() => approveRequest(r.id)}>Approve</button>
                        <button className="btn btn-outline-coral btn-small" onClick={() => declineRequest(r.id)}>Decline</button>
                      </div>
                    )}
                    {r.user_id === session.user.id && (
                      <button
                        className="btn btn-outline-coral btn-small"
                        style={{ width: "100%", marginTop: 10 }}
                        onClick={() => withdrawRequest(r.id)}
                      >
                        Withdraw request
                      </button>
                    )}
                  </div>
                );
              })}
            </>
          )}

          {!isMember && !hasPendingRequest && (
            <button className="dashed-join-btn" onClick={() => navigate(`/event/${eventId}/join`)}>
              <UserPlus size={14} /> Join this event
            </button>
          )}
        </div>

        <div className="total-bar">
          <div className="row-mono"><span>{totalPlayers} confirmed × ₱{Number(event.price_per_player).toLocaleString()}</span></div>
          <div className="row-total">
            <div className="label">TOTAL COLLECTED</div>
            <div className="amount">₱{totalPrice.toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

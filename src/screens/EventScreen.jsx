import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { X, Plus, Users, MapPin, Calendar, UserPlus, ChevronDown, Check, Clock, LogOut, ArrowLeft } from "lucide-react";
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

  const isHost = event?.host_id === session.user.id;

  const loadAll = useCallback(async () => {
    const { data: eventData } = await supabase.from("events").select("*").eq("id", eventId).single();
    setEvent(eventData);
    if (eventData) setPriceDraft(eventData.price_per_player);

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

  async function addGuestTo(memberId, e) {
    e.preventDefault();
    const trimmed = (guestInputs[memberId] || "").trim();
    if (!trimmed) return;
    await supabase.from("guests").insert({ member_id: memberId, name: trimmed });
    setGuestInputs((g) => ({ ...g, [memberId]: "" }));
    await loadAll();
  }

  async function removeGuest(guestId) {
    await supabase.from("guests").delete().eq("id", guestId);
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
                    {member.guests.map((g) => (
                      <div key={g.id} className="guest-row">
                        <div className="left">
                          <div className="avatar guest">{initials(g.name)}</div>
                          <span className="name">{g.name}</span>
                          <span className="tag">no account</span>
                        </div>
                        {(memberIsHost && isHost) || (memberIsMe && !memberIsHost) ? (
                          <button className="icon-btn" style={{ color: "#ff6152" }} onClick={() => removeGuest(g.id)}>
                            <X size={13} />
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}

                {(memberIsHost && isHost) && (
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
              </div>
            );
          })}

          {requests.length > 0 && (
            <>
              <div className="section-title" style={{ marginTop: 16 }}>REQUESTS TO JOIN &middot; {requests.length}</div>
              {requests.map((r) => {
                const count = 1 + (r.guest_names?.length || 0);
                return (
                  <div key={r.id} className="request-card">
                    <div className="member-name">{r.name}</div>
                    <div style={{ fontSize: 11.5, color: "#8a9a93", marginTop: 2 }}>
                      {count} players &middot; ₱{Number(r.amount).toLocaleString()}
                    </div>
                    {r.status === "pending_approval" ? (
                      <div className="status-line paid"><Check size={12} /> Payment sent &middot; awaiting your approval</div>
                    ) : (
                      <div className="status-line waiting"><Clock size={12} /> Awaiting payment</div>
                    )}
                    {isHost && r.status === "pending_approval" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button className="btn btn-primary btn-small" onClick={() => approveRequest(r.id)}>Approve</button>
                        <button className="btn btn-outline-coral btn-small" onClick={() => declineRequest(r.id)}>Decline</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}

          <button className="dashed-join-btn" onClick={() => navigate(`/event/${eventId}/join`)}>
            <UserPlus size={14} /> Another logged-in player joins
          </button>
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

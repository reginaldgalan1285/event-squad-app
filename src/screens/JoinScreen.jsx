import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { initials } from "../lib/constants";

export default function JoinScreen({ session }) {
  const { eventId } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [name, setName] = useState("");
  const [guests, setGuests] = useState([]);
  const [guestInput, setGuestInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("events").select("*").eq("id", eventId).single().then(({ data }) => setEvent(data));
    supabase.from("profiles").select("display_name").eq("id", session.user.id).maybeSingle().then(({ data }) => {
      if (data?.display_name) setName(data.display_name);
    });
    loadConfirmedCount();
  }, [eventId]);

  async function loadConfirmedCount() {
    const { data } = await supabase.from("event_members").select("id, guests(id)").eq("event_id", eventId);
    const count = (data || []).reduce((sum, m) => sum + 1 + (m.guests?.length || 0), 0);
    setConfirmedCount(count);
  }

  function addGuest(e) {
    e.preventDefault();
    const trimmed = guestInput.trim();
    if (!trimmed) return;
    setGuests((g) => [...g, { id: `${Date.now()}-${Math.random()}`, name: trimmed }]);
    setGuestInput("");
  }

  function removeGuest(id) {
    setGuests((g) => g.filter((x) => x.id !== id));
  }

  const price = Number(event?.price_per_player || 0);
  const playerCount = 1 + guests.length;
  const amount = playerCount * price;
  const hasLimit = event?.max_players != null;
  const spotsLeft = hasLimit ? event.max_players - confirmedCount - playerCount : null;
  const atCapacity = hasLimit && spotsLeft <= 0;

  async function requestToJoin() {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");

    const { data, error } = await supabase
      .from("payment_requests")
      .insert({
        event_id: eventId,
        user_id: session.user.id,
        name: name.trim(),
        guest_names: guests.map((g) => g.name),
        amount,
      })
      .select()
      .single();

    setSubmitting(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate(`/event/${eventId}/pay/${data.id}`);
  }

  if (!event) return null;

  return (
    <div className="app-shell">
      <div className="phone">
        <div className="header">
          <div className="header-row">
            <button className="icon-btn" onClick={() => navigate(`/event/${eventId}`)}><ArrowLeft size={18} /></button>
            <div className="title-display" style={{ fontSize: 15 }}>JOIN {event.title.toUpperCase()}</div>
          </div>
        </div>

        <div className="body-scroll">
          <div className="field-label">Your name</div>
          <input className="solid-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Paolo" />

          <div className="field-label" style={{ marginTop: 20 }}>Guests you're bringing &middot; {guests.length}</div>
          <div className="helper-text" style={{ marginBottom: 10 }}>They don't need an account — just their name.</div>

          {guests.map((g) => (
            <div key={g.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="avatar guest">{initials(g.name)}</div>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{g.name}</span>
              </div>
              <button className="icon-btn" style={{ color: "#ff6152" }} onClick={() => removeGuest(g.id)}><X size={14} /></button>
            </div>
          ))}

          <form className="dashed-row" onSubmit={addGuest} style={{ marginTop: 0 }}>
            <input
              className="dashed-input"
              value={guestInput}
              onChange={(e) => setGuestInput(e.target.value)}
              placeholder={atCapacity ? "No spots left" : "Type a guest's name"}
              disabled={atCapacity}
            />
            <button className="btn btn-primary btn-icon-square" type="submit" disabled={atCapacity}><Plus size={18} /></button>
          </form>
          <div className="helper-text" style={atCapacity ? { color: "var(--coral)" } : undefined}>
            {hasLimit
              ? atCapacity
                ? spotsLeft < 0
                  ? `Over the limit by ${Math.abs(spotsLeft)} — remove a guest to continue`
                  : "No spots left for this event"
                : `${spotsLeft} spot${spotsLeft !== 1 ? "s" : ""} left`
              : "No limit · add as many as you like"}
          </div>
        </div>

        <div className="total-bar">
          <div className="row-mono"><span>{playerCount} players × ₱{price.toLocaleString()}</span></div>
          <div className="row-total">
            <div className="label">YOU'LL PAY</div>
            <div className="amount" style={{ fontSize: 26 }}>₱{amount.toLocaleString()}</div>
          </div>
          <button
            className={`btn btn-block ${name.trim() && !(hasLimit && spotsLeft < 0) ? "btn-accent" : "btn-disabled"}`}
            style={{ marginTop: 12 }}
            onClick={requestToJoin}
            disabled={!name.trim() || submitting || (hasLimit && spotsLeft < 0)}
          >
            {submitting ? "Sending request..." : "Request to join"}
          </button>
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}

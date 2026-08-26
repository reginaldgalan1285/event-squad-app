import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { initials } from "../lib/constants";

export default function TopUpScreen({ session }) {
  const { eventId, memberId } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [member, setMember] = useState(null);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [guests, setGuests] = useState([]);
  const [guestInput, setGuestInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("events").select("*").eq("id", eventId).single().then(({ data }) => setEvent(data));
    supabase.from("event_members").select("*").eq("id", memberId).single().then(({ data }) => setMember(data));
    loadConfirmedCount();
  }, [eventId, memberId]);

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
  const amount = guests.length * price;
  const hasLimit = event?.max_players != null;
  const spotsLeft = hasLimit ? event.max_players - confirmedCount - guests.length : null;
  const atCapacity = hasLimit && spotsLeft <= 0;

  async function requestTopUp() {
    if (guests.length === 0) return;
    setSubmitting(true);
    setError("");

    const { data, error } = await supabase
      .from("payment_requests")
      .insert({
        event_id: eventId,
        member_id: memberId,
        user_id: session.user.id,
        name: member?.name || "",
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

  if (!event || !member) return null;

  return (
    <div className="app-shell">
      <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
      <div className="phone">
        <div className="header">
          <div className="header-row">
            <button className="icon-btn" onClick={() => navigate(`/event/${eventId}`)}><ArrowLeft size={18} /></button>
            <div className="title-display" style={{ fontSize: 15 }}>ADD GUESTS</div>
          </div>
        </div>

        <div className="body-scroll">
          <div className="helper-text" style={{ marginBottom: 14, fontSize: 12.5 }}>
            Adding more guests under <strong style={{ color: "var(--ink)" }}>{member.name}</strong> — this needs a top-up payment, same as your original join.
          </div>

          <div className="field-label">Guests to add &middot; {guests.length}</div>
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
          <div className="row-mono"><span>{guests.length} guest{guests.length !== 1 ? "s" : ""} × ₱{price.toLocaleString()}</span></div>
          <div className="row-total">
            <div className="label">YOU'LL PAY</div>
            <div className="amount" style={{ fontSize: 26 }}>₱{amount.toLocaleString()}</div>
          </div>
          <button
            className={`btn btn-block ${guests.length > 0 && !(hasLimit && spotsLeft < 0) ? "btn-accent" : "btn-disabled"}`}
            style={{ marginTop: 12 }}
            onClick={requestTopUp}
            disabled={guests.length === 0 || submitting || (hasLimit && spotsLeft < 0)}
          >
            {submitting ? "Sending request..." : "Request to add"}
          </button>
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}

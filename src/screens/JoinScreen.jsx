import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, X } from "lucide-react";
import { supabase } from "../supabaseClient";
import { initials } from "../lib/constants";

export default function JoinScreen({ session }) {
  const { eventId } = useParams();
  const navigate = useNavigate();

  const [event, setEvent] = useState(null);
  const [name, setName] = useState("");
  const [guests, setGuests] = useState([]);
  const [guestInput, setGuestInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase.from("events").select("*").eq("id", eventId).single().then(({ data }) => setEvent(data));
  }, [eventId]);

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
            <input className="dashed-input" value={guestInput} onChange={(e) => setGuestInput(e.target.value)} placeholder="Type a guest's name" />
            <button className="btn btn-primary btn-icon-square" type="submit"><Plus size={18} /></button>
          </form>
          <div className="helper-text">No limit &middot; add as many as you like</div>
        </div>

        <div className="total-bar">
          <div className="row-mono"><span>{playerCount} players × ₱{price.toLocaleString()}</span></div>
          <div className="row-total">
            <div className="label">YOU'LL PAY</div>
            <div className="amount" style={{ fontSize: 26 }}>₱{amount.toLocaleString()}</div>
          </div>
          <button
            className={`btn btn-block ${name.trim() ? "btn-accent" : "btn-disabled"}`}
            style={{ marginTop: 12 }}
            onClick={requestToJoin}
            disabled={!name.trim() || submitting}
          >
            {submitting ? "Sending request..." : "Request to join"}
          </button>
          {error && <div className="error-text">{error}</div>}
        </div>
      </div>
    </div>
  );
}

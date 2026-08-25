import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import { SPORTS } from "../lib/constants";

export default function Home({ session }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [latestEventId, setLatestEventId] = useState(null);

  const [sport, setSport] = useState("Pickleball");
  const [title, setTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocation] = useState("");
  const [price, setPrice] = useState(150);
  const [hostName, setHostName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadLatestEvent();
  }, []);

  async function loadLatestEvent() {
    setLoading(true);
    const { data, error } = await supabase
      .from("events")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      setLatestEventId(data.id);
      navigate(`/event/${data.id}`, { replace: true });
    }
    setLoading(false);
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!title.trim() || !eventDate || !hostName.trim()) return;
    setCreating(true);
    setError("");

    const { data: event, error: eventError } = await supabase
      .from("events")
      .insert({
        host_id: session.user.id,
        sport,
        title: title.trim(),
        event_date: new Date(eventDate).toISOString(),
        location: location.trim(),
        price_per_player: Number(price) || 0,
      })
      .select()
      .single();

    if (eventError) {
      setError(eventError.message);
      setCreating(false);
      return;
    }

    const { error: memberError } = await supabase.from("event_members").insert({
      event_id: event.id,
      user_id: session.user.id,
      name: hostName.trim(),
      is_host: true,
    });

    setCreating(false);

    if (memberError) {
      setError(memberError.message);
      return;
    }

    navigate(`/event/${event.id}`);
  }

  if (loading) {
    return (
      <div className="app-shell">
        <div className="phone" style={{ alignItems: "center", justifyContent: "center" }}>
          Loading...
        </div>
      </div>
    );
  }

  // No event exists anywhere yet (or none this user can reach) — offer to create one.
  return (
    <div className="app-shell">
      <div className="phone">
        <div className="header">
          <div className="title-display">Create your event</div>
          <div style={{ fontSize: 12.5, opacity: 0.85, marginTop: 6 }}>
            You'll be the host — you can add guests directly and approve join requests.
          </div>
        </div>
        <div className="body-scroll">
          <form onSubmit={handleCreate}>
            <div className="field-label">Your name (shown to other players)</div>
            <input className="solid-input" value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="e.g. RG" required />

            <div className="field-label" style={{ marginTop: 14 }}>Sport</div>
            <select className="solid-input" value={sport} onChange={(e) => setSport(e.target.value)}>
              {SPORTS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>

            <div className="field-label" style={{ marginTop: 14 }}>Event title</div>
            <input className="solid-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tuesday Night Run" required />

            <div className="field-label" style={{ marginTop: 14 }}>Date & time</div>
            <input className="solid-input" type="datetime-local" value={eventDate} onChange={(e) => setEventDate(e.target.value)} required />

            <div className="field-label" style={{ marginTop: 14 }}>Location</div>
            <input className="solid-input" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Tagbilaran Sports Hub" />

            <div className="field-label" style={{ marginTop: 14 }}>Price per player (₱)</div>
            <input className="solid-input" type="number" value={price} onChange={(e) => setPrice(e.target.value)} min="0" />

            <button className="btn btn-primary btn-block" style={{ marginTop: 20 }} type="submit" disabled={creating}>
              {creating ? "Creating..." : "Create event"}
            </button>
            {error && <div className="error-text">{error}</div>}
          </form>
        </div>
      </div>
    </div>
  );
}

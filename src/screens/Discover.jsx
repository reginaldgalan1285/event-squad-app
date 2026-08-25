import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, MapPin } from "lucide-react";
import { supabase } from "../supabaseClient";

function buildNextDays(count = 7) {
  const days = [];
  const today = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d);
  }
  return days;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function Discover() {
  const navigate = useNavigate();
  const days = useMemo(() => buildNextDays(7), []);
  const [selectedDay, setSelectedDay] = useState(days[0]);
  const [tab, setTab] = useState("meets");
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [soonMessage, setSoonMessage] = useState("");

  useEffect(() => {
    loadEvents();
  }, []);

  async function loadEvents() {
    setLoading(true);
    const { data } = await supabase
      .from("events")
      .select("*, event_members(count)")
      .order("event_date", { ascending: true });
    setEvents(data || []);
    setLoading(false);
  }

  function tapSoon(label) {
    setSoonMessage(label);
    setTimeout(() => setSoonMessage(""), 1600);
  }

  const dayEvents = events.filter((e) => sameDay(new Date(e.event_date), selectedDay));

  return (
    <div className="app-shell">
      <div className="phone">
        <div className="header" style={{ paddingBottom: 0 }}>
          <div className="header-row">
            <button className="icon-btn" onClick={() => navigate("/")}><ArrowLeft size={18} /></button>
            <div className="title-display" style={{ fontSize: 18 }}>Discover</div>
          </div>
        </div>

        <div className="discover-tabs">
          <button className={`discover-tab ${tab === "meets" ? "selected" : ""}`} onClick={() => setTab("meets")}>Meets</button>
          <button className="discover-tab" onClick={() => tapSoon("Clubs")}>Clubs</button>
          <button className="discover-tab" onClick={() => tapSoon("People")}>People</button>
        </div>

        {soonMessage && (
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--fade)", padding: "8px 20px 0" }}>
            {soonMessage} browsing is coming soon
          </div>
        )}

        <div className="date-strip">
          {days.map((d) => {
            const selected = sameDay(d, selectedDay);
            return (
              <div key={d.toISOString()} className={`date-pill ${selected ? "selected" : ""}`} onClick={() => setSelectedDay(d)}>
                <div className="dow">{d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</div>
                <div className="dom">{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        <div className="body-scroll" style={{ padding: "0 0 10px" }}>
          {loading ? (
            <div style={{ fontSize: 12.5, color: "var(--fade)", padding: "0 20px" }}>Loading...</div>
          ) : dayEvents.length === 0 ? (
            <div className="empty-state">
              <div className="title">No meets on this day yet.</div>
              <button className="btn btn-primary" style={{ padding: "10px 22px", borderRadius: 12 }} onClick={() => navigate("/create")}>
                Create one
              </button>
            </div>
          ) : (
            dayEvents.map((e) => {
              const confirmed = e.event_members?.[0]?.count ?? 0;
              return (
                <div key={e.id} className="meet-card" onClick={() => navigate(`/event/${e.id}`)}>
                  <div>
                    <div className="meet-host">{e.sport}</div>
                    <div className="meet-title">{e.title}</div>
                    <div className="meet-meta">
                      <span>{new Date(e.event_date).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      {e.location && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <MapPin size={11} /> {e.location}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="capacity-badge">
                    {confirmed}{e.max_players ? `/${e.max_players}` : ""}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

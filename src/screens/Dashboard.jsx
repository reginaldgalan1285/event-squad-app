import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Compass, PlusCircle, Users, Clock3, BarChart3, Settings as SettingsIcon, LogOut } from "lucide-react";
import { supabase } from "../supabaseClient";
import { initials } from "../lib/constants";

// Tiles with no real screen behind them yet — tapping just surfaces that,
// same idea as a disabled nav item, rather than pretending it works.
const SOON_TILES = ["History", "Statistics"];

export default function Dashboard({ session }) {
  const navigate = useNavigate();
  const [myEvents, setMyEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [soonMessage, setSoonMessage] = useState("");
  const [profileName, setProfileName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState(null);

  const displayName = profileName || session.user.email?.split("@")[0] || "there";

  useEffect(() => {
    loadMyEvents();
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data } = await supabase.from("profiles").select("display_name, avatar_url").eq("id", session.user.id).maybeSingle();
    if (data?.display_name) setProfileName(data.display_name);
    if (data?.avatar_url) setAvatarUrl(data.avatar_url);
  }

  async function loadMyEvents() {
    setLoading(true);
    const { data } = await supabase
      .from("event_members")
      .select("is_host, events(id, title, sport, event_date, location)")
      .eq("user_id", session.user.id)
      .order("joined_at", { ascending: false });

    setMyEvents((data || []).filter((row) => row.events));
    setLoading(false);
  }

  function tapSoon(label) {
    setSoonMessage(label);
    setTimeout(() => setSoonMessage(""), 1600);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  const tiles = [
    { label: "Discover", icon: Compass, onClick: () => navigate("/discover") },
    { label: "Create event", icon: PlusCircle, onClick: () => navigate("/create") },
    { label: "People", icon: Users, onClick: () => navigate("/discover?tab=people") },
    { label: "History", icon: Clock3, onClick: () => tapSoon("History") },
    { label: "Statistics", icon: BarChart3, onClick: () => tapSoon("Statistics") },
    { label: "Settings", icon: SettingsIcon, onClick: () => navigate("/settings") },
  ];

  return (
    <div className="app-shell">
      <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
      <div className="phone">
        <div className="dash-topbar">
          <div className="dash-greeting" style={{ cursor: "pointer" }} onClick={() => navigate("/profile")}>
            <div className="dash-avatar" style={{ overflow: "hidden" }}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                initials(displayName)
              )}
            </div>
            <div className="dash-name">Hi, {displayName}</div>
          </div>
          <button className="icon-btn" onClick={handleSignOut} title="Sign out">
            <LogOut size={18} />
          </button>
        </div>

        <div className="tile-grid">
          {tiles.map((t) => {
            const Icon = t.icon;
            const soon = SOON_TILES.includes(t.label);
            return (
              <div key={t.label} className={`tile ${soon ? "soon" : ""}`} onClick={t.onClick}>
                <div className="tile-icon-wrap"><Icon size={18} /></div>
                <div className="tile-label">{t.label}</div>
              </div>
            );
          })}
        </div>

        {soonMessage && (
          <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--fade)", marginTop: -2 }}>
            {soonMessage} is coming soon
          </div>
        )}

        <div className="section-title" style={{ padding: "18px 20px 0" }}>YOUR EVENTS</div>

        <div className="mine-section">
          {loading ? (
            <div style={{ fontSize: 12.5, color: "var(--fade)" }}>Loading...</div>
          ) : myEvents.length === 0 ? (
            <div className="empty-state">
              <div className="title">You haven't joined or hosted an event yet.</div>
              <button className="btn btn-primary" style={{ padding: "10px 22px", borderRadius: 12 }} onClick={() => navigate("/discover")}>
                Discover
              </button>
            </div>
          ) : (
            myEvents.map((row) => (
              <div key={row.events.id} className="mine-card" onClick={() => navigate(`/event/${row.events.id}`)}>
                <div>
                  <div className="name">{row.events.title}</div>
                  <div className="sub">{row.events.sport} &middot; {new Date(row.events.event_date).toLocaleDateString()}</div>
                </div>
                <div className="role">{row.is_host ? "Host" : "Player"}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

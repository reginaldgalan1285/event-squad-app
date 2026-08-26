import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Settings as SettingsIcon, ThumbsUp, ChevronRight } from "lucide-react";
import { supabase } from "../supabaseClient";
import { SPORTS, initials } from "../lib/constants";

export default function Profile({ session }) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [preferredSport, setPreferredSport] = useState("");
  const [pickingSport, setPickingSport] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data } = await supabase
      .from("profiles")
      .select("display_name, preferred_sport")
      .eq("id", session.user.id)
      .maybeSingle();
    if (data) {
      setDisplayName(data.display_name || "");
      setNameDraft(data.display_name || "");
      setPreferredSport(data.preferred_sport || "");
    }
    setLoading(false);
  }

  async function saveName() {
    const trimmed = nameDraft.trim();
    setEditingName(false);
    if (trimmed === displayName) return;
    setDisplayName(trimmed);
    await supabase.from("profiles").upsert({ id: session.user.id, display_name: trimmed || null });
  }

  async function pickSport(sport) {
    setPreferredSport(sport);
    setPickingSport(false);
    await supabase.from("profiles").upsert({ id: session.user.id, preferred_sport: sport });
  }

  const shownName = displayName || session.user.email?.split("@")[0] || "Player";

  if (loading) {
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
            <button className="icon-btn" onClick={() => navigate("/")}><ArrowLeft size={18} /></button>
            <button className="icon-btn" onClick={() => navigate("/settings")}><SettingsIcon size={18} /></button>
          </div>
        </div>

        <div className="body-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
          <div className="dash-avatar" style={{ width: 88, height: 88, fontSize: 30, marginTop: 8 }}>
            {initials(shownName)}
          </div>

          {editingName ? (
            <input
              className="solid-input"
              style={{ marginTop: 14, textAlign: "center", fontFamily: "var(--font-display)", fontSize: 18, maxWidth: 240 }}
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => e.key === "Enter" && saveName()}
              placeholder="Your name"
            />
          ) : (
            <div
              style={{ fontFamily: "var(--font-display)", fontSize: 19, marginTop: 14, cursor: "pointer" }}
              onClick={() => { setEditingName(true); setNameDraft(displayName); }}
            >
              {shownName}
              <span style={{ fontSize: 10, color: "var(--fade)", fontWeight: 600, marginLeft: 6 }}>edit</span>
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--fade)", marginTop: 4 }}>{session.user.email}</div>

          <div className="qr-upload-card" style={{ width: "100%", marginTop: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <ThumbsUp size={16} color="var(--fade)" />
              <div style={{ fontSize: 12.5, color: "var(--fade)" }}>Endorsements and reviews are coming soon.</div>
            </div>
          </div>

          <div style={{ width: "100%", marginTop: 6 }}>
            <div className="section-title" style={{ padding: "12px 20px 0" }}>SPORTS</div>

            {pickingSport ? (
              <div style={{ padding: "0 20px" }}>
                {SPORTS.map((s) => (
                  <div key={s} className="mine-card" onClick={() => pickSport(s)}>
                    <div className="name">{s}</div>
                    {preferredSport === s && <div className="role">Selected</div>}
                  </div>
                ))}
              </div>
            ) : preferredSport ? (
              <div className="settings-row" onClick={() => setPickingSport(true)}>
                <div className="left">{preferredSport}</div>
                <ChevronRight size={16} color="var(--fade)" />
              </div>
            ) : (
              <div style={{ padding: "0 20px" }}>
                <button
                  className="btn btn-outline-coral"
                  style={{ borderColor: "var(--green)", color: "var(--green)", padding: "8px 16px", borderRadius: 10, fontSize: 12.5 }}
                  onClick={() => setPickingSport(true)}
                >
                  + Add sport
                </button>
              </div>
            )}
          </div>

          <button
            className="btn btn-primary"
            style={{ marginTop: 24, marginBottom: 20, padding: "10px 22px", borderRadius: 12, fontSize: 12.5 }}
            onClick={() => navigate("/settings")}
          >
            Manage payment QR code
          </button>
        </div>
      </div>
    </div>
  );
}

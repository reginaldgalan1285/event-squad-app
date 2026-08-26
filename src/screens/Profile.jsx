import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Settings as SettingsIcon, ThumbsUp, ChevronRight, Camera } from "lucide-react";
import { supabase } from "../supabaseClient";
import { SPORTS, initials } from "../lib/constants";

export default function Profile({ session }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const [displayName, setDisplayName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [preferredSport, setPreferredSport] = useState("");
  const [pickingSport, setPickingSport] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data } = await supabase
      .from("profiles")
      .select("display_name, preferred_sport, avatar_url")
      .eq("id", session.user.id)
      .maybeSingle();
    if (data) {
      setDisplayName(data.display_name || "");
      setNameDraft(data.display_name || "");
      setPreferredSport(data.preferred_sport || "");
      setAvatarUrl(data.avatar_url || null);
    }
    setLoading(false);
  }

  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarError("");
    setUploadingAvatar(true);

    const path = `${session.user.id}/avatar-${Date.now()}.${file.name.split(".").pop()}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });

    if (uploadError) {
      setUploadingAvatar(false);
      setAvatarError(uploadError.message);
      return;
    }

    const { data: publicData } = supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = publicData.publicUrl;

    const { error: upsertError } = await supabase.from("profiles").upsert({ id: session.user.id, avatar_url: publicUrl });

    setUploadingAvatar(false);
    if (upsertError) {
      setAvatarError(upsertError.message);
      return;
    }
    setAvatarUrl(publicUrl);
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
        <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
        <div className="phone" style={{ alignItems: "center", justifyContent: "center" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
      <div className="phone">
        <div className="header">
          <div className="header-row" style={{ justifyContent: "space-between" }}>
            <button className="icon-btn" onClick={() => navigate("/")}><ArrowLeft size={18} /></button>
            <button className="icon-btn" onClick={() => navigate("/settings")}><SettingsIcon size={18} /></button>
          </div>
        </div>

        <div className="body-scroll" style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
          <div style={{ position: "relative", marginTop: 8 }}>
            <div
              className="dash-avatar"
              style={{ width: 88, height: 88, fontSize: 30, overflow: "hidden" }}
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Your profile photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                initials(shownName)
              )}
            </div>
            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleAvatarChange} style={{ display: "none" }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              aria-label={avatarUrl ? "Change profile photo" : "Add profile photo"}
              style={{
                position: "absolute",
                bottom: -2,
                right: -2,
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--citrus)",
                border: "2px solid var(--chalk)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
              }}
            >
              <Camera size={13} color="var(--ink)" />
            </button>
          </div>
          {uploadingAvatar && <div className="helper-text">Uploading...</div>}
          {avatarError && <div className="error-text">{avatarError}</div>}

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

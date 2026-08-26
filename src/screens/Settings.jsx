import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft, User, SlidersHorizontal, HelpCircle, MapPin, QrCode,
  CalendarCheck, Ban, ThumbsUp, LogOut, ChevronRight, Upload,
} from "lucide-react";
import { supabase } from "../supabaseClient";

export default function Settings({ session }) {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [qrUrl, setQrUrl] = useState(null);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [soonMessage, setSoonMessage] = useState("");

  useEffect(() => {
    loadProfile();
  }, []);

  async function loadProfile() {
    const { data } = await supabase
      .from("profiles")
      .select("payment_qr_url, payment_label")
      .eq("id", session.user.id)
      .maybeSingle();
    if (data) {
      setQrUrl(data.payment_qr_url);
      setLabel(data.payment_label || "");
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);

    const path = `${session.user.id}/qr-${Date.now()}.${file.name.split(".").pop()}`;
    const { error: uploadError } = await supabase.storage.from("payment-qr").upload(path, file, { upsert: true });

    if (uploadError) {
      setUploading(false);
      setError(uploadError.message);
      return;
    }

    const { data: publicData } = supabase.storage.from("payment-qr").getPublicUrl(path);
    const publicUrl = publicData.publicUrl;

    const { error: upsertError } = await supabase
      .from("profiles")
      .upsert({ id: session.user.id, payment_qr_url: publicUrl, payment_label: label });

    setUploading(false);
    if (upsertError) {
      setError(upsertError.message);
      return;
    }
    setQrUrl(publicUrl);
  }

  async function saveLabel() {
    setSaving(true);
    setError("");
    const { error } = await supabase
      .from("profiles")
      .upsert({ id: session.user.id, payment_qr_url: qrUrl, payment_label: label });
    setSaving(false);
    if (error) setError(error.message);
  }

  function tapSoon(name) {
    setSoonMessage(name);
    setTimeout(() => setSoonMessage(""), 1600);
  }

  async function handleLogout() {
    await supabase.auth.signOut();
  }

  return (
    <div className="app-shell">
      <img src="/event-squad-wordmark.svg" alt="Event Squad" className="brand-strip" />
      <div className="phone">
        <div className="header">
          <div className="header-row">
            <button className="icon-btn" onClick={() => navigate("/")}><ArrowLeft size={18} /></button>
            <div className="title-display" style={{ fontSize: 18 }}>Settings</div>
          </div>
        </div>

        <div className="body-scroll" style={{ padding: 0 }}>
          <div className="settings-top">
            <div className="settings-top-item" onClick={() => navigate("/profile")}>
              <User size={20} />
              <div>Account</div>
            </div>
            <div className="settings-top-item" onClick={() => tapSoon("Preferences")}>
              <SlidersHorizontal size={20} />
              <div>Preferences</div>
            </div>
            <div className="settings-top-item" onClick={() => tapSoon("Help")}>
              <HelpCircle size={20} />
              <div>Help</div>
            </div>
          </div>

          {soonMessage && (
            <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--fade)", padding: "0 20px 12px" }}>
              {soonMessage} is coming soon
            </div>
          )}

          <div className="qr-upload-card">
            <div className="field-label" style={{ marginBottom: 10 }}>Your payment QR code</div>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div
                style={{
                  width: 96, height: 96, borderRadius: 12, border: "1px solid var(--line)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  overflow: "hidden", flexShrink: 0, background: "var(--chalk)",
                }}
              >
                {qrUrl ? (
                  <img src={qrUrl} alt="Your payment QR" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                ) : (
                  <QrCode size={28} color="var(--fade)" />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: "var(--fade)", marginBottom: 8 }}>
                  This is shown to players on the payment screen when they join your events.
                </div>
                <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} style={{ display: "none" }} />
                <button
                  className="btn btn-outline-coral"
                  style={{ borderColor: "var(--green)", color: "var(--green)", padding: "8px 14px", borderRadius: 10, fontSize: 12.5, display: "flex", alignItems: "center", gap: 6 }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                >
                  <Upload size={13} /> {uploading ? "Uploading..." : qrUrl ? "Change QR code" : "Upload QR code"}
                </button>
              </div>
            </div>

            <div className="field-label" style={{ marginTop: 16, marginBottom: 6 }}>Payment label</div>
            <input
              className="solid-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={saveLabel}
              placeholder="e.g. GCash · 0917 123 4567"
            />
            {saving && <div className="helper-text">Saving...</div>}
            {error && <div className="error-text">{error}</div>}
          </div>

          <div className="settings-row" onClick={() => tapSoon("Locations")}>
            <div className="left"><MapPin size={18} /> Locations</div>
            <ChevronRight size={16} color="var(--fade)" />
          </div>
          <div className="settings-row" onClick={() => tapSoon("Calendars")}>
            <div className="left"><CalendarCheck size={18} /> Calendars</div>
            <ChevronRight size={16} color="var(--fade)" />
          </div>
          <div className="settings-row" onClick={() => tapSoon("Blocked players")}>
            <div className="left"><Ban size={18} /> Blocked players</div>
            <ChevronRight size={16} color="var(--fade)" />
          </div>
          <div className="settings-row" onClick={() => tapSoon("Community reviews")}>
            <div className="left"><ThumbsUp size={18} /> Community reviews</div>
            <ChevronRight size={16} color="var(--fade)" />
          </div>
          <div className="settings-row danger" onClick={handleLogout}>
            <div className="left"><LogOut size={18} /> Logout</div>
          </div>

          <div className="version-text">Event Squad · v0.1.0</div>
        </div>
      </div>
    </div>
  );
}

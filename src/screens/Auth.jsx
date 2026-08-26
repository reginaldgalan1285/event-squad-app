import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "../supabaseClient";

export default function Auth() {
  const [mode, setMode] = useState("signin"); // 'signin' | 'signup'
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!email.trim()) return;
    setBusy(true);

    if (!password) {
      setBusy(false);
      setError("Enter a password.");
      return;
    }

    if (mode === "signup") {
      if (!name.trim()) {
        setBusy(false);
        setError("Enter your name.");
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { display_name: name.trim() } },
      });
      setBusy(false);
      if (error) {
        setError(error.message);
      } else if (!data.session) {
        setMessage(`Account created. Check ${email} to confirm it, then sign in.`);
        setMode("signin");
      }
      // if data.session exists, onAuthStateChange in App.jsx picks it up automatically
      return;
    }

    // signin
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (error) setError(error.message);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <img src="/event-squad-wordmark.svg" alt="Event Squad" style={{ height: 44, marginBottom: 4 }} />
        <div className="auth-sub">
          {mode === "signup" ? "Create an account to host or join an open play." : "Sign in to host or join an open play."}
        </div>

        {message ? (
          <div style={{ fontSize: 13.5 }}>{message}</div>
        ) : (
          <form onSubmit={handleSubmit}>
            {mode === "signup" && (
              <>
                <div className="field-label">Your name</div>
                <input
                  className="solid-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. RG Galan"
                  required
                />
              </>
            )}

            <div className="field-label" style={{ marginTop: mode === "signup" ? 14 : 0 }}>Email</div>
            <input
              className="solid-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            <div className="field-label" style={{ marginTop: 14 }}>Password</div>
            <div style={{ position: "relative" }}>
              <input
                className="solid-input"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                minLength={6}
                required
                style={{ paddingRight: 40 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={{
                  position: "absolute",
                  right: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--fade)",
                  cursor: "pointer",
                  display: "flex",
                  padding: 4,
                }}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            <button className="btn btn-primary btn-block" style={{ marginTop: 16 }} type="submit" disabled={busy}>
              {busy ? "Please wait..." : mode === "signup" ? "Create account" : "Sign in"}
            </button>
            {error && <div className="error-text">{error}</div>}
          </form>
        )}

        <div style={{ marginTop: 18, fontSize: 12.5, display: "flex", flexDirection: "column", gap: 6 }}>
          {mode === "signin" && (
            <button className="icon-btn" style={{ color: "var(--green)", fontWeight: 700 }} onClick={() => { setMode("signup"); setMessage(""); setError(""); }}>
              Don't have an account? Create one
            </button>
          )}
          {mode === "signup" && (
            <button className="icon-btn" style={{ color: "var(--green)", fontWeight: 700 }} onClick={() => { setMode("signin"); setMessage(""); setError(""); }}>
              Already have an account? Sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

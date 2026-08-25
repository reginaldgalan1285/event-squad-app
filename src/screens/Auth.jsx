import { useState } from "react";
import { supabase } from "../supabaseClient";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) {
      setError(error.message);
    } else {
      setSent(true);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-title">Event Squad</div>
        <div className="auth-sub">Sign in with your email to join or host an open play.</div>

        {sent ? (
          <div style={{ fontSize: 13.5 }}>
            Check <strong>{email}</strong> for a sign-in link, then come back to this tab.
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="field-label">Email</div>
            <input
              className="solid-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
            <button className="btn btn-primary btn-block" style={{ marginTop: 14 }} type="submit" disabled={sending}>
              {sending ? "Sending link..." : "Send magic link"}
            </button>
            {error && <div className="error-text">{error}</div>}
          </form>
        )}
      </div>
    </div>
  );
}

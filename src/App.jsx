import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import Auth from "./screens/Auth";
import Dashboard from "./screens/Dashboard";
import Discover from "./screens/Discover";
import CreateEvent from "./screens/CreateEvent";
import EventScreen from "./screens/EventScreen";
import JoinScreen from "./screens/JoinScreen";
import TopUpScreen from "./screens/TopUpScreen";
import PaymentScreen from "./screens/PaymentScreen";
import Settings from "./screens/Settings";
import Profile from "./screens/Profile";
import Tournament from "./screens/Tournament";

const REDIRECT_KEY = "eventsquad_redirect_after_login";
const AUTO_LOGOUT_FLAG = "eventsquad_auto_logout";
const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes

// Wraps any screen that requires an account. An anonymous visitor gets
// bounced to /login, with the URL they wanted remembered so they land
// right back here after signing in — same mechanism as a forwarded
// event link for a logged-out visitor.
function RequireAuth({ session, children }) {
  const location = useLocation();
  if (!session) {
    sessionStorage.setItem(REDIRECT_KEY, location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // Sign out automatically after 30 minutes with no mouse/keyboard/touch
  // activity, so an unattended device doesn't stay logged in indefinitely.
  useEffect(() => {
    if (!session) return;

    let timeoutId;
    function resetTimer() {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        sessionStorage.setItem(AUTO_LOGOUT_FLAG, "1");
        supabase.auth.signOut();
      }, INACTIVITY_LIMIT_MS);
    }

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    activityEvents.forEach((evt) => window.addEventListener(evt, resetTimer));
    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      activityEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [session]);

  // Once a session appears, send the person back to whatever URL they
  // originally landed on (a forwarded event link, or wherever
  // RequireAuth bounced them from) instead of always the dashboard.
  useEffect(() => {
    if (session) {
      const redirect = sessionStorage.getItem(REDIRECT_KEY);
      if (redirect && redirect !== "/" && redirect !== "/login") {
        sessionStorage.removeItem(REDIRECT_KEY);
        navigate(redirect, { replace: true });
      }
    }
  }, [session]);

  if (session === undefined) return null; // brief initial check, avoids a flash

  return (
    <Routes>
      {/* Public — no account needed to browse */}
      <Route path="/login" element={session ? <Navigate to="/" replace /> : <Auth />} />
      <Route path="/" element={<Dashboard session={session} />} />
      <Route path="/discover" element={<Discover session={session} />} />
      <Route path="/event/:eventId" element={<EventScreen session={session} />} />
      <Route path="/event/:eventId/tournament" element={<Tournament session={session} />} />

      {/* Everything else needs an account */}
      <Route path="/create" element={<RequireAuth session={session}><CreateEvent session={session} /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth session={session}><Settings session={session} /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth session={session}><Profile session={session} /></RequireAuth>} />
      <Route path="/event/:eventId/join" element={<RequireAuth session={session}><JoinScreen session={session} /></RequireAuth>} />
      <Route path="/event/:eventId/topup/:memberId" element={<RequireAuth session={session}><TopUpScreen session={session} /></RequireAuth>} />
      <Route path="/event/:eventId/pay/:requestId" element={<RequireAuth session={session}><PaymentScreen /></RequireAuth>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

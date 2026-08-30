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

const REDIRECT_KEY = "eventsquad_redirect_after_login";
const AUTO_LOGOUT_FLAG = "eventsquad_auto_logout";
const INACTIVITY_LIMIT_MS = 1 * 60 * 1000; // 30 minutes

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

  // While signed out, remember the exact URL being visited (e.g. a
  // forwarded event link) so it can be restored right after sign-in.
  useEffect(() => {
    if (session === null) {
      sessionStorage.setItem(REDIRECT_KEY, location.pathname + location.search);
    }
  }, [session, location]);

  // Once a session appears, send the person back to whatever URL they
  // originally landed on instead of always dropping them on the dashboard.
  useEffect(() => {
    if (session) {
      const redirect = sessionStorage.getItem(REDIRECT_KEY);
      if (redirect && redirect !== "/") {
        sessionStorage.removeItem(REDIRECT_KEY);
        navigate(redirect, { replace: true });
      }
    }
  }, [session]);

  if (session === undefined) return null; // brief initial check, avoids an Auth flash

  if (!session) return <Auth />;

  return (
    <Routes>
      <Route path="/" element={<Dashboard session={session} />} />
      <Route path="/discover" element={<Discover session={session} />} />
      <Route path="/create" element={<CreateEvent session={session} />} />
      <Route path="/settings" element={<Settings session={session} />} />
      <Route path="/profile" element={<Profile session={session} />} />
      <Route path="/event/:eventId" element={<EventScreen session={session} />} />
      <Route path="/event/:eventId/join" element={<JoinScreen session={session} />} />
      <Route path="/event/:eventId/topup/:memberId" element={<TopUpScreen session={session} />} />
      <Route path="/event/:eventId/pay/:requestId" element={<PaymentScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

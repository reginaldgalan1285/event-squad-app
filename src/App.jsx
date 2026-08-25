import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { supabase } from "./supabaseClient";
import Auth from "./screens/Auth";
import Dashboard from "./screens/Dashboard";
import Discover from "./screens/Discover";
import CreateEvent from "./screens/CreateEvent";
import EventScreen from "./screens/EventScreen";
import JoinScreen from "./screens/JoinScreen";
import PaymentScreen from "./screens/PaymentScreen";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = still checking

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null; // brief initial check, avoids an Auth flash

  if (!session) return <Auth />;

  return (
    <Routes>
      <Route path="/" element={<Dashboard session={session} />} />
      <Route path="/discover" element={<Discover session={session} />} />
      <Route path="/create" element={<CreateEvent session={session} />} />
      <Route path="/event/:eventId" element={<EventScreen session={session} />} />
      <Route path="/event/:eventId/join" element={<JoinScreen session={session} />} />
      <Route path="/event/:eventId/pay/:requestId" element={<PaymentScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

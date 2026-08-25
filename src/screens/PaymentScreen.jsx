import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { supabase } from "../supabaseClient";
import QRPlaceholder from "../components/QRPlaceholder";

export default function PaymentScreen() {
  const { eventId, requestId } = useParams();
  const navigate = useNavigate();
  const [request, setRequest] = useState(null);
  const [hostPayment, setHostPayment] = useState(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    supabase.from("payment_requests").select("*").eq("id", requestId).single().then(async ({ data }) => {
      setRequest(data);
      if (!data) return;
      const { data: eventData } = await supabase.from("events").select("host_id").eq("id", data.event_id).single();
      if (!eventData) return;
      const { data: profileData } = await supabase
        .from("profiles")
        .select("payment_qr_url, payment_label")
        .eq("id", eventData.host_id)
        .maybeSingle();
      setHostPayment(profileData);
    });
  }, [requestId]);

  async function cancelPayment() {
    await supabase.from("payment_requests").delete().eq("id", requestId).eq("status", "awaiting_payment");
    navigate(`/event/${eventId}`);
  }

  async function markPaid() {
    setMarking(true);
    await supabase.from("payment_requests").update({ status: "pending_approval" }).eq("id", requestId);
    setMarking(false);
    navigate(`/event/${eventId}`);
  }

  if (!request) return null;

  const guestCount = request.guest_names?.length || 0;

  return (
    <div className="app-shell">
      <div className="phone">
        <div className="header">
          <div className="header-row">
            <button className="icon-btn" onClick={cancelPayment}><ArrowLeft size={18} /></button>
            <div className="title-display" style={{ fontSize: 15 }}>PAYMENT</div>
          </div>
        </div>

        <div className="body-scroll centered-col" style={{ paddingTop: 22 }}>
          <div className="card" style={{ width: "100%" }}>
            <div className="field-label">Request summary</div>
            <div className="member-name" style={{ marginTop: 6 }}>
              {request.name} + {guestCount} guest{guestCount !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 12, color: "#8a9a93", marginTop: 2 }}>
              {1 + guestCount} players total
            </div>
          </div>

          <div style={{ fontFamily: "var(--font-display)", color: "var(--citrus)", background: "var(--ink)", borderRadius: 16, padding: "14px 26px", fontSize: 30, margin: "8px 0 20px" }}>
            ₱{Number(request.amount).toLocaleString()}
          </div>

          <div className="qr-card">
            {hostPayment?.payment_qr_url ? (
              <img
                src={hostPayment.payment_qr_url}
                alt="Host's payment QR"
                style={{ width: 160, height: 160, objectFit: "contain", display: "block" }}
              />
            ) : (
              <QRPlaceholder seed={requestId.length + Number(request.amount)} />
            )}
            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700 }}>Scan with GCash or your bank app</div>
            <div style={{ fontSize: 11.5, color: "#8a9a93", marginTop: 2 }}>
              {hostPayment?.payment_label ? `Send to: ${hostPayment.payment_label}` : "Send to: Host · GCash / bank on file"}
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#8a9a93", marginTop: 16, textAlign: "center", lineHeight: 1.5 }}>
            The host is notified by GCash / your bank once the payment lands, then approves your spot.
          </div>
        </div>

        <div style={{ padding: "12px 20px 22px" }}>
          <button className="btn btn-primary btn-block" onClick={markPaid} disabled={marking}>
            {marking ? "Confirming..." : `I've sent ₱${Number(request.amount).toLocaleString()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

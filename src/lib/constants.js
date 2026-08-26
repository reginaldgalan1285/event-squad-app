export const SPORTS = ["Pickleball", "Futsal", "Basketball", "Badminton", "Volleyball", "Padel"];

export function initials(name) {
  return (name || "").trim().charAt(0).toUpperCase() || "?";
}

// e.g. "Wed, Aug 26 · 7:00 PM" — used anywhere a full event date/time shows,
// so the day of the week is always visible, not just the calendar date.
export function formatEventDateTime(dateStr) {
  const d = new Date(dateStr);
  const datePart = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} \u00B7 ${timePart}`;
}

export function formatEventDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// e.g. "Wed, Aug 26 @2:00 PM" — used as the compact header title.
export function formatEventHeaderDate(dateStr) {
  const d = new Date(dateStr);
  const datePart = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} @${timePart}`;
}

// e.g. "Wed, August 26 at 2:00 PM" or, with an end time,
// "Wed, August 26 · 2:00 PM – 4:00 PM" (crossing midnight shows both dates).
export function formatEventDateTimeFull(startStr, endStr) {
  const start = new Date(startStr);
  const datePart = start.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
  const startTime = start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (!endStr) return `${datePart} at ${startTime}`;
  const end = new Date(endStr);
  const endTime = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (start.toDateString() === end.toDateString()) {
    return `${datePart} \u00B7 ${startTime} \u2013 ${endTime}`;
  }
  const endDatePart = end.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
  return `${datePart}, ${startTime} \u2013 ${endDatePart}, ${endTime}`;
}

// Converts an ISO timestamp to the "YYYY-MM-DDTHH:mm" value a
// <input type="datetime-local"> needs, in local time.
export function toDatetimeLocalValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// e.g. "2 hours" or "90 min" — only meaningful when an end time exists.
export function formatDuration(startStr, endStr) {
  if (!endStr) return null;
  const minutes = Math.round((new Date(endStr) - new Date(startStr)) / 60000);
  if (minutes <= 0) return null;
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours !== 1 ? "s" : ""}`;
  }
  return `${minutes} min`;
}

function toGCalStamp(dateStr) {
  return new Date(dateStr).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export function googleCalendarUrl(event) {
  const start = toGCalStamp(event.event_date);
  const end = event.end_time ? toGCalStamp(event.end_time) : toGCalStamp(new Date(new Date(event.event_date).getTime() + 60 * 60000));
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title || "Event",
    dates: `${start}/${end}`,
    details: event.description || "",
    location: event.location || "",
  });
  return `https://www.google.com/calendar/render?${params.toString()}`;
}

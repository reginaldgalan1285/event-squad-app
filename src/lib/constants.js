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

// e.g. "Wed August 26 at 2:00 PM" — used for the calendar row's headline.
export function formatEventDateLong(dateStr) {
  const d = new Date(dateStr);
  const datePart = d.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric" });
  const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${datePart} at ${timePart}`;
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

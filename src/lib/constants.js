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

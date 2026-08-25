export const SPORTS = ["Pickleball", "Futsal", "Basketball", "Badminton", "Volleyball", "Padel"];

export function initials(name) {
  return (name || "").trim().charAt(0).toUpperCase() || "?";
}

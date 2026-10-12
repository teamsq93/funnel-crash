export type WeaponId = "wedge" | "axe" | "spinner" | "saw" | "plow" | "spike";

export type RosterPlayer = {
  id: string;
  name: string;
  color: string;
  you: boolean;
  weapon: WeaponId;
};

export const weapons: Record<WeaponId, { name: string; line: string }> = {
  wedge: { name: "Skopa", line: "Håll in X så lyfter skopan den du kör in i." },
  axe: { name: "Yxa", line: "Håll in X så hugger yxan. Den fastnar om den träffar rakt fram." },
  spinner: { name: "Spinnare", line: "Håll in X så snurrar spinnaren och knuffar i sidan." },
  saw: { name: "Såg", line: "Håll in X så snurrar sågen och tuggar den du kör in i." },
  plow: { name: "Plog", line: "Håll in X så tippar plogen, skjuter undan och lyfter lite." },
  spike: { name: "Spjut", line: "Håll in X så sticker spjutet ut och stöter rakt." },
};

export type MatchMode = "ffa" | "teams";

export const maxPlayers = 6;

export const roster: RosterPlayer[] = [
  { id: "you", name: "Du", color: "#f04444", you: true, weapon: "wedge" },
  { id: "axel", name: "Axel", color: "#3488ff", you: false, weapon: "axe" },
  { id: "mira", name: "Mira", color: "#ffc52e", you: false, weapon: "spinner" },
  { id: "leo", name: "Leo", color: "#44cc88", you: false, weapon: "saw" },
  { id: "noor", name: "Noor", color: "#ff4d9a", you: false, weapon: "plow" },
  { id: "sam", name: "Sam", color: "#2ec8e6", you: false, weapon: "spike" },
];

export const teams = [
  { name: "Orange", color: "#ff7a18" },
  { name: "Lila", color: "#7c4dff" },
];

export function teamOf(id: string) {
  const index = roster.findIndex((player) => player.id === id);
  return Math.max(0, index) % 2;
}

import type { WeaponId } from "./players";

export type Pad = { f: boolean; b: boolean; l: boolean; r: boolean; x: boolean };

export type TruckSnap = {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  visible: boolean;
  score: number;
  out: boolean;
  hp: number;
  armed: boolean;
};

export type MatchSnap = {
  timeLeft: number;
  banner: string;
  round: number;
  rounds: number;
  summary: {
    standings: { name: string; color: string; points: number }[];
    fellOut: { name: string; color: string; how: "hålet" | "kanten" | "livet" }[];
    more: boolean;
  } | null;
  trucks: TruckSnap[];
};

export type LobbySeat = {
  id: string;
  name: string;
  seat: number;
  ready: boolean;
  weapon: WeaponId;
};

export type OnlineLink = {
  seat: number;
  host: boolean;
  humans: boolean[];
  inputs: { current: (Pad | null)[] };
  snap: { current: MatchSnap | null };
  publish: (snap: MatchSnap) => void;
  sendInput: (pad: Pad) => void;
};

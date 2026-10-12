import { useEffect, useRef, useState } from "react";
import ThreeArena from "./ThreeArena";
import type { LobbySeat, MatchSnap, OnlineLink, Pad } from "./online";
import { weapons, type RosterPlayer } from "./players";

type Phase = "pick" | "lobby" | "play";

const buttonStyle = {
  width: "100%",
  padding: "14px 18px",
  fontSize: 18,
  fontWeight: 800,
  border: "none",
  borderRadius: 10,
  background: "#facc15",
  color: "#111820",
  cursor: "pointer",
} as const;

export default function OnlineMatch({ onExit }: { onExit: () => void }) {
  const socketRef = useRef<WebSocket | null>(null);
  const inputs = useRef<(Pad | null)[]>([]);
  const snap = useRef<MatchSnap | null>(null);
  const lastPad = useRef("");
  const lastSent = useRef(0);
  const [phase, setPhase] = useState<Phase>("pick");
  const [name, setName] = useState("Du");
  const [code, setCode] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [host, setHost] = useState(false);
  const [players, setPlayers] = useState<LobbySeat[]>([]);
  const [lineup, setLineup] = useState<RosterPlayer[]>([]);
  const [error, setError] = useState("");
  const [link, setLink] = useState<OnlineLink | null>(null);

  useEffect(() => {
    return () => socketRef.current?.close();
  }, []);

  function connect(kind: "create" | "join") {
    setError("");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      import.meta.env.DEV
        ? `${protocol}//${window.location.hostname}:2567`
        : `${protocol}//${window.location.host}`
    );
    socketRef.current = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: kind, name, code: code.toUpperCase() }));
    };
    socket.onerror = () => setError("Ingen server. Starta den med npm run server.");
    socket.onclose = () => {
      if (phase !== "pick") setError("Anslutningen bröts.");
    };
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.type === "error") {
        setError(message.message);
        return;
      }
      if (message.type === "lobby") {
        setPhase("lobby");
        setRoomCode(message.code);
        setHost(message.host);
        setPlayers(message.players);
        return;
      }
      if (message.type === "begin") {
        const next = message.players.map((player: RosterPlayer & { seat: number }) => ({
          id: player.id,
          name: player.name,
          color: player.color,
          weapon: player.weapon,
          you: player.seat === message.seat,
        }));
        inputs.current = next.map(() => ({ f: false, b: false, l: false, r: false, x: false }));
        setLineup(next);
        setHost(message.host);
        setLink({
          seat: message.seat,
          host: message.host,
          humans: next.map(() => true),
          inputs,
          snap,
          publish: (nextSnap) => {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "snap", snap: nextSnap }));
            }
          },
          sendInput: (pad) => {
            const packed = `${pad.f}${pad.b}${pad.l}${pad.r}${pad.x}`;
            const now = performance.now();
            if (packed === lastPad.current && now - lastSent.current < 100) return;
            lastPad.current = packed;
            lastSent.current = now;
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "input", pad }));
            }
          },
        });
        setPhase("play");
        return;
      }
      if (message.type === "input") {
        inputs.current[message.seat] = message.pad;
        return;
      }
      if (message.type === "snap") {
        snap.current = message.snap;
        return;
      }
      if (message.type === "gone") {
        const stopped = inputs.current[message.seat];
        if (stopped) inputs.current[message.seat] = { f: false, b: false, l: false, r: false, x: false };
      }
    };
  }

  function send(message: object) {
    socketRef.current?.send(JSON.stringify(message));
  }

  if (phase === "play" && link) {
    return (
      <ThreeArena
        key={lineup.map((player) => player.id).join("-")}
        mode="ffa"
        players={lineup}
        online={link}
        onExit={() => {
          socketRef.current?.close();
          onExit();
        }}
      />
    );
  }

  return (
    <div
      style={{
        minHeight: "100svh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "auto",
        background: "radial-gradient(circle at 50% 0%, #243140 0%, #111820 55%)",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        padding:
          "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ width: "min(480px, 100%)" }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "#cbd5e1" }}>FUNNEL CRASH</div>
        <div style={{ fontSize: "clamp(28px, 9vw, 40px)", fontWeight: 800, marginTop: 6 }}>Online</div>
        <div style={{ marginTop: 8, color: "#cbd5e1" }}>
          Värdens dator kör matchen. De andra skickar bara styrning. Öppna samma adress och skriv koden.
        </div>

        {phase === "pick" && (
          <>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={16}
              placeholder="Namn"
              style={fieldStyle}
            />
            <button style={{ ...buttonStyle, marginTop: 16 }} onClick={() => connect("create")}>
              Skapa rum
            </button>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              maxLength={4}
              placeholder="Kod"
              style={fieldStyle}
            />
            <button
              style={{ ...buttonStyle, marginTop: 12, background: "#18222b", color: "#e2e8f0", border: "1px solid #2a3846" }}
              onClick={() => connect("join")}
            >
              Gå med
            </button>
          </>
        )}

        {phase === "lobby" && (
          <>
            <div style={{ marginTop: 18, fontSize: 28, fontWeight: 800, letterSpacing: 4 }}>{roomCode}</div>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
              {players.map((player) => (
                <div
                  key={player.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "#18222b",
                  }}
                >
                  <span>
                    {player.name}
                    <span style={{ color: "#94a3b8" }}> · {weapons[rosterWeapon(player.seat)].name}</span>
                  </span>
                  <span style={{ color: player.ready ? "#86efac" : "#94a3b8" }}>
                    {player.ready ? "Klar" : "Väntar"}
                  </span>
                </div>
              ))}
            </div>
            <button style={{ ...buttonStyle, marginTop: 16 }} onClick={() => send({ type: "ready" })}>
              Klar
            </button>
            {host && (
              <button
                style={{ ...buttonStyle, marginTop: 10, background: "#18222b", color: "#e2e8f0", border: "1px solid #2a3846" }}
                onClick={() => send({ type: "start" })}
              >
                Starta matchen
              </button>
            )}
          </>
        )}

        {error && <div style={{ marginTop: 14, color: "#fca5a5" }}>{error}</div>}
        <button
          onClick={() => {
            socketRef.current?.close();
            onExit();
          }}
          style={{
            marginTop: 18,
            background: "transparent",
            border: "none",
            color: "#94a3b8",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Tillbaka
        </button>
      </div>
    </div>
  );
}

function rosterWeapon(seat: number) {
  return (["wedge", "axe", "spinner", "saw", "plow", "spike"] as const)[seat] ?? "wedge";
}

const fieldStyle = {
  marginTop: 16,
  width: "100%",
  boxSizing: "border-box" as const,
  padding: "12px 14px",
  fontSize: 16,
  borderRadius: 10,
  border: "1px solid #2a3846",
  background: "#18222b",
  color: "#ffffff",
};

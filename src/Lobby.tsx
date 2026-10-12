import { useEffect, useRef, useState } from "react";
import { maxPlayers, roster, teamOf, teams, weapons, type MatchMode, type RosterPlayer } from "./players";

type LobbyPlayer = RosterPlayer & { ready: boolean };

function asLobby(player: RosterPlayer): LobbyPlayer {
  return { ...player, ready: false };
}

export default function Lobby({
  lineup,
  onStart,
  onOnline,
}: {
  lineup: RosterPlayer[];
  onStart: (mode: MatchMode, players: RosterPlayer[]) => void;
  onOnline: () => void;
}) {
  const [players, setPlayers] = useState(() => lineup.map(asLobby));
  const [mode, setMode] = useState<MatchMode>("ffa");
  const [starting, setStarting] = useState(false);
  const onStartRef = useRef(onStart);
  const modeRef = useRef(mode);
  const playersRef = useRef(players);
  const extraTimers = useRef<number[]>([]);
  const addLock = useRef(false);
  onStartRef.current = onStart;
  modeRef.current = mode;
  playersRef.current = players;

  useEffect(() => {
    const timers = playersRef.current
      .filter((player) => !player.you)
      .map((player, index) =>
        window.setTimeout(() => {
          setPlayers((current) =>
            current.map((entry) =>
              entry.id === player.id ? { ...entry, ready: true } : entry
            )
          );
        }, 1100 + index * 800)
      );
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const timer of extraTimers.current) window.clearTimeout(timer);
    };
  }, []);

  const allReady = players.every((player) => player.ready);
  const youReady = players.some((player) => player.you && player.ready);
  addLock.current = false;

  function addPlayer() {
    if (youReady || starting || addLock.current) return;
    const current = playersRef.current;
    if (current.length >= maxPlayers) return;
    const next = roster.find((candidate) => !current.some((player) => player.id === candidate.id));
    if (!next) return;
    addLock.current = true;
    setPlayers((existing) => {
      if (existing.length >= maxPlayers || existing.some((player) => player.id === next.id)) {
        return existing;
      }
      return [...existing, asLobby(next)].sort(
        (a, b) =>
          roster.findIndex((player) => player.id === a.id) -
          roster.findIndex((player) => player.id === b.id)
      );
    });
    const timer = window.setTimeout(() => {
      setPlayers((existing) =>
        existing.map((player) => (player.id === next.id ? { ...player, ready: true } : player))
      );
    }, 900);
    extraTimers.current.push(timer);
  }

  function removePlayer(id: string) {
    if (youReady || starting || players.length <= 2) return;
    setPlayers((current) => current.filter((player) => player.you || player.id !== id));
  }

  useEffect(() => {
    if (!allReady) return;
    setStarting(true);
    const timer = window.setTimeout(
      () =>
        onStartRef.current(
          modeRef.current,
          playersRef.current.map(({ id, name, color, you, weapon }) => ({
            id,
            name,
            color,
            you,
            weapon,
          }))
        ),
      900
    );
    return () => window.clearTimeout(timer);
  }, [allReady]);

  function readyUp() {
    setPlayers((current) =>
      current.map((player) => (player.you ? { ...player, ready: true } : player))
    );
  }

  const waitingOn = players
    .filter((player) => !player.ready)
    .map((player) => player.name);

  return (
    <div
      style={{
        minHeight: "100svh",
        width: "100%",
        boxSizing: "border-box",
        background:
          "radial-gradient(circle at 50% 0%, #243140 0%, #111820 55%)",
        color: "#ffffff",
        fontFamily: "system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "auto",
        padding:
          "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div style={{ width: "min(480px, 100%)", textAlign: "left" }}>
        <div style={{ fontSize: 14, letterSpacing: 2, color: "#cbd5e1" }}>
          FUNNEL CRASH
        </div>
        <div style={{ fontSize: "clamp(28px, 9vw, 40px)", fontWeight: 800, marginTop: 6 }}>Lobby</div>
        <div style={{ marginTop: 8, color: "#cbd5e1", fontSize: 16 }}>
          Välj hur ni spelar. Högst {maxPlayers} spelare, och varje förare har ett vapen. Matchen startar när alla har tryckt klar.
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 22 }}>
          {(
            [
              ["ffa", "Alla för sig"],
              ["teams", "Lag"],
            ] as const
          ).map(([value, label]) => {
            const selected = mode === value;
            return (
              <button
                key={value}
                onClick={() => setMode(value)}
                disabled={youReady || starting}
                style={{
                  flex: 1,
                  padding: "12px 10px",
                  fontSize: 16,
                  fontWeight: 800,
                  borderRadius: 10,
                  border: selected ? "1px solid #facc15" : "1px solid #2a3846",
                  background: selected ? "#facc15" : "#18222b",
                  color: selected ? "#111820" : "#e2e8f0",
                  cursor: youReady || starting ? "default" : "pointer",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        {mode === "teams" && (
          <div style={{ marginTop: 10, color: "#cbd5e1", fontSize: 14 }}>
            Karossen har lagets färg. Hytten har din egen färg.
          </div>
        )}
        <div style={{ marginTop: 10, color: "#cbd5e1", fontSize: 14 }}>
          {weapons[players.find((player) => player.you)?.weapon ?? "wedge"].line}
        </div>

        <div
          style={{
            marginTop: 22,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {(mode === "teams" ? teams : [null]).map((team, teamIndex) => (
            <div key={team?.name ?? "all"} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {team && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: teamIndex === 0 ? 0 : 6 }}>
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: team.color,
                    }}
                  />
                  <div style={{ fontSize: 13, letterSpacing: 1, fontWeight: 800, color: "#94a3b8" }}>
                    LAG {team.name.toUpperCase()}
                  </div>
                </div>
              )}
              {players.map((player) => {
                if (team && teamOf(player.id) !== teamIndex) return null;
                return (
                  <div
                    key={player.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      padding: "14px 16px",
                      borderRadius: 12,
                      background: player.you ? "#1c2833" : "#18222b",
                      border: player.you ? "1px solid #facc15" : "1px solid #2a3846",
                    }}
                  >
                    <div
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 999,
                        background: team ? team.color : player.color,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "0 0 auto",
                      }}
                    >
                      {team && (
                        <div
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: 999,
                            background: player.color,
                          }}
                        />
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{player.name}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>
                        {weapons[player.weapon].name}
                      </div>
                    </div>
                    {!player.you && (
                      <button
                        onClick={() => removePlayer(player.id)}
                        disabled={youReady || starting || players.length <= 2}
                        style={{
                          border: "none",
                          background: "transparent",
                          color: "#94a3b8",
                          fontWeight: 700,
                          fontSize: 14,
                          cursor: youReady || starting || players.length <= 2 ? "default" : "pointer",
                        }}
                      >
                        Ta bort
                      </button>
                    )}
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: player.ready ? "#86efac" : "#94a3b8",
                      }}
                    >
                      {player.ready ? "Klar" : "Väntar"}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <button
          onClick={addPlayer}
          disabled={youReady || starting || players.length >= maxPlayers}
          style={{
            marginTop: 14,
            width: "100%",
            padding: "12px 18px",
            fontSize: 16,
            fontWeight: 800,
            borderRadius: 10,
            border: "1px solid #2a3846",
            background: "#18222b",
            color: youReady || starting || players.length >= maxPlayers ? "#64748b" : "#e2e8f0",
            cursor: youReady || starting || players.length >= maxPlayers ? "default" : "pointer",
          }}
        >
          Lägg till spelare ({players.length}/{maxPlayers})
        </button>

        <button
          onClick={readyUp}
          disabled={youReady || starting}
          style={{
            marginTop: 22,
            width: "100%",
            padding: "14px 18px",
            fontSize: 18,
            fontWeight: 800,
            border: "none",
            borderRadius: 10,
            background: youReady ? "#334155" : "#facc15",
            color: youReady ? "#cbd5e1" : "#111820",
            cursor: youReady || starting ? "default" : "pointer",
          }}
        >
          {youReady ? "Du är klar" : "Klar"}
        </button>

        <button
          onClick={onOnline}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "14px 18px",
            fontSize: 18,
            fontWeight: 800,
            borderRadius: 10,
            border: "1px solid #2a3846",
            background: "#18222b",
            color: "#e2e8f0",
            cursor: "pointer",
          }}
        >
          Spela online
        </button>

        <div style={{ marginTop: 14, minHeight: 24, color: "#e2e8f0", fontSize: 15 }}>
          {starting
            ? "Alla är klara. Matchen startar."
            : youReady
              ? `Väntar på ${waitingOn.join(", ")}`
              : "Tryck klar när du är redo."}
        </div>
      </div>
    </div>
  );
}

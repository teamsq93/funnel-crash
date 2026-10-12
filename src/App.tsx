import { useState } from "react";
import FullscreenButton from "./FullscreenButton";
import Lobby from "./Lobby";
import OnlineMatch from "./OnlineMatch";
import ThreeArena from "./ThreeArena";
import { roster, type MatchMode, type RosterPlayer } from "./players";

export default function App() {
  const [inMatch, setInMatch] = useState(false);
  const [online, setOnline] = useState(false);
  const [mode, setMode] = useState<MatchMode>("ffa");
  const [players, setPlayers] = useState<RosterPlayer[]>(() => roster.slice(0, 4));

  let screen = (
    <Lobby
      lineup={players}
      onStart={(nextMode, nextPlayers) => {
        setMode(nextMode);
        setPlayers(nextPlayers);
        setInMatch(true);
      }}
      onOnline={() => setOnline(true)}
    />
  );

  if (online) {
    screen = <OnlineMatch onExit={() => setOnline(false)} />;
  } else if (inMatch) {
    screen = (
      <ThreeArena
        key={players.map((player) => player.id).join("-") + mode}
        mode={mode}
        players={players}
        onExit={() => setInMatch(false)}
      />
    );
  }

  return (
    <>
      {screen}
      <FullscreenButton />
    </>
  );
}

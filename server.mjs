import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const roster = [
  { id: "you", color: "#f04444", weapon: "wedge" },
  { id: "axel", color: "#3488ff", weapon: "axe" },
  { id: "mira", color: "#ffc52e", weapon: "spinner" },
  { id: "leo", color: "#44cc88", weapon: "saw" },
  { id: "noor", color: "#ff4d9a", weapon: "plow" },
  { id: "sam", color: "#2ec8e6", weapon: "spike" },
];

const weaponIds = new Set(["wedge", "axe", "spinner", "saw", "plow", "spike"]);
const rooms = new Map();

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function send(socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function lobbyMessage(room, socket) {
  const mine = room.players.find((player) => player.socket === socket);
  return {
    type: "lobby",
    code: room.code,
    host: socket === room.host,
    seat: mine?.seat ?? 0,
    rounds: room.rounds,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      seat: player.seat,
      ready: player.ready,
      weapon: player.weapon,
    })),
  };
}

function broadcast(room, message, except) {
  for (const player of room.players) {
    if (player.socket === except) continue;
    send(player.socket, message);
  }
}

function pushLobby(room) {
  for (const player of room.players) send(player.socket, lobbyMessage(room, player.socket));
}

const port = Number(process.env.PORT) || 2567;
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "dist");
const fileTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function servePage(req, res) {
  if (!fs.existsSync(dist)) {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end("Rumservern är igång. Under utveckling öppnas spelet via npm run dev.");
    return;
  }

  const requestUrl = new URL(req.url ?? "/", "http://localhost");
  const requested = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, "");
  const root = path.resolve(dist);
  let filePath = path.resolve(root, requested);
  const inside = filePath === root || filePath.startsWith(root + path.sep);
  if (!inside || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(root, "index.html");
  }

  res.writeHead(200, {
    "content-type": fileTypes[path.extname(filePath)] ?? "application/octet-stream",
  });
  fs.createReadStream(filePath).pipe(res);
}

const httpServer = http.createServer(servePage);
const server = new WebSocketServer({ server: httpServer });

server.on("connection", (socket) => {
  socket._socket?.setNoDelay(true);
  let room = null;
  let self = null;

  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {

    if (message.type === "create" || message.type === "join") {
      const name = String(message.name ?? "Spelare").slice(0, 16).trim() || "Spelare";
      if (message.type === "create") {
        let code = makeCode();
        while (rooms.has(code)) code = makeCode();
        room = { code, host: socket, players: [], phase: "lobby", rounds: 1 };
        rooms.set(code, room);
      } else {
        room = rooms.get(String(message.code ?? "").toUpperCase());
        if (!room || room.phase !== "lobby") {
          send(socket, { type: "error", message: "Inget rum med den koden." });
          return;
        }
        if (room.players.length >= roster.length) {
          send(socket, { type: "error", message: "Rummet är fullt." });
          return;
        }
      }

      const seat = room.players.length;
      self = {
        id: roster[seat].id,
        name,
        seat,
        ready: false,
        socket,
        color: roster[seat].color,
        weapon: roster[seat].weapon,
      };
      room.players.push(self);
      pushLobby(room);
      return;
    }

    if (!room || !self) return;

    if (message.type === "weapon" && room.phase === "lobby" && !self.ready) {
      if (weaponIds.has(message.weapon)) {
        self.weapon = message.weapon;
        pushLobby(room);
      }
      return;
    }

    if (message.type === "rounds" && room.phase === "lobby" && socket === room.host) {
      const count = Math.round(Number(message.rounds));
      if (count >= 1 && count <= 5) {
        room.rounds = count;
        pushLobby(room);
      }
      return;
    }

    if (message.type === "ready" && room.phase === "lobby") {
      self.ready = !self.ready;
      pushLobby(room);
      return;
    }

    if (message.type === "start" && room.phase === "lobby" && socket === room.host) {
      if (room.players.length < 2 || room.players.some((player) => !player.ready)) {
        send(socket, { type: "error", message: "Minst två spelare, och alla måste vara klara." });
        return;
      }
      room.phase = "match";
      const players = room.players.map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        weapon: player.weapon,
        seat: player.seat,
      }));
      for (const player of room.players) {
        send(player.socket, {
          type: "begin",
          players,
          seat: player.seat,
          host: player.socket === room.host,
          rounds: room.rounds,
        });
      }
      return;
    }

    if (message.type === "input" && room.phase === "match" && socket !== room.host) {
      send(room.host, { type: "input", seat: self.seat, pad: message.pad });
      return;
    }

    if (message.type === "snap" && room.phase === "match" && socket === room.host) {
      broadcast(room, { type: "snap", snap: message.snap }, socket);
    }
    } catch (error) {
      console.error(error);
    }
  });

  socket.on("close", () => {
    if (!room || !self) return;
    room.players = room.players.filter((player) => player !== self);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }
    if (room.host === socket) {
      broadcast(room, { type: "error", message: "Värden lämnade rummet." });
      for (const player of room.players) player.socket.close();
      rooms.delete(room.code);
      return;
    }
    if (room.phase === "lobby") pushLobby(room);
    else send(room.host, { type: "gone", seat: self.seat });
  });
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Funnel Crash online på port ${port}`);
});

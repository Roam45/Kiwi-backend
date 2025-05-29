const express = require("express");
const http = require("http");
const path = require("path");
const socketIO = require("socket.io");
const fs = require("fs");
const cors = require("cors");
const PORT = process.env.PORT || 3000;

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: "https://roam45.github.io",
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const USERS_FILE = "users.txt";

app.use(express.json());
app.use(cors({
  origin: "https://roam45.github.io",
  methods: ["GET", "POST"],
  credentials: true
}));

const rooms = {};
const userSockets = new Map();

let cachedUsers = [];

function readUsers() {
  if (!fs.existsSync(USERS_FILE)) return [];
  return fs.readFileSync(USERS_FILE, "utf8").trim().split("\n").map(line => {
    const [username, password, nickname] = line.split(":");
    return { username, password, nickname };
  });
}

function updateUsers() {
  cachedUsers = readUsers();
  console.log("User list updated");
}
updateUsers();
setInterval(updateUsers, 5000);

app.post("/register", (req, res) => {
  const { username, password, nickname } = req.body;
  if (!username || !password || !nickname) return res.status(400).send("All fields are required.");

  if (cachedUsers.some(user => user.username === username)) {
    return res.status(400).send("Username already taken.");
  }

  fs.appendFileSync(USERS_FILE, `${username}:${password}:${nickname}\n`);
  updateUsers();
  res.status(201).send("Registration successful.");
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const user = cachedUsers.find(user => user.username === username && user.password === password);

  if (!user) return res.status(401).send("Invalid credentials.");
  res.status(200).json({ nickname: user.nickname });
});

app.get("/", (req, res) => {
  res.send("Kiwi backend is running");
});

io.on("connection", (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Authenticate user and store on socket map
  socket.on("authenticate", (username, nickname) => {
    if (!username || !nickname) {
      socket.emit("errorMsg", "Authentication failed: missing username or nickname.");
      return;
    }
    userSockets.set(socket.id, { username, nickname, currentRoom: null });
    socket.emit("nicknameSet", nickname);
    console.log(`Socket ${socket.id} authenticated as ${nickname} (${username})`);
  });

  socket.on("joinRoom", (roomName) => {
    const userData = userSockets.get(socket.id);
    if (!userData) {
      socket.emit("errorMsg", "You must authenticate first.");
      return;
    }
    if (!roomName) {
      socket.emit("errorMsg", "Room name required.");
      return;
    }

    roomName = roomName.toLowerCase().trim();
    if (!rooms[roomName]) rooms[roomName] = { messages: [], users: new Set() };

    if (userData.currentRoom) {
      rooms[userData.currentRoom]?.users.delete(socket.id);
      socket.leave(userData.currentRoom);
    }

    userData.currentRoom = roomName;
    userSockets.set(socket.id, userData);
    rooms[roomName].users.add(socket.id);
    socket.join(roomName);

    socket.emit("joinedRoom", roomName);
    socket.emit("history", rooms[roomName].messages);

    console.log(`${userData.nickname} joined room: ${roomName}`);
  });

  socket.on("sendMessage", (msg) => {
    const userData = userSockets.get(socket.id);
    if (!userData) {
      socket.emit("errorMsg", "You must authenticate before sending messages.");
      return;
    }
    if (!userData.currentRoom || !rooms[userData.currentRoom]) {
      socket.emit("errorMsg", "You must join a room before sending messages.");
      return;
    }
    if (!msg || !msg.trim()) return;

    const timestamp = new Date().toLocaleTimeString();
    const message = `[${timestamp}] ${userData.nickname}: ${msg.trim()}`;
    rooms[userData.currentRoom].messages.push(message);

    // Keep last 100 messages only
    if (rooms[userData.currentRoom].messages.length > 100) {
      rooms[userData.currentRoom].messages.shift();
    }

    console.log(`Message from ${userData.nickname} in ${userData.currentRoom}: ${msg.trim()}`);

    io.to(userData.currentRoom).emit("receiveMessage", message);
  });

  socket.on("disconnect", () => {
    const userData = userSockets.get(socket.id);
    if (userData?.currentRoom) {
      rooms[userData.currentRoom]?.users.delete(socket.id);
    }
    userSockets.delete(socket.id);
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

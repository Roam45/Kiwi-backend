const express = require("express");
const http = require("http");
const path = require("path");
const socketIO = require("socket.io");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

const USERS_FILE = "users.txt";

app.use(express.static("public"));
app.use(express.json());

const rooms = {};
const userSockets = new Map();

let cachedUsers = [];

// Read users from file
function readUsers() {
    if (!fs.existsSync(USERS_FILE)) return [];
    return fs.readFileSync(USERS_FILE, "utf8").trim().split("\n").map(line => {
        const [username, password, nickname] = line.split(":");
        return { username, password, nickname };
    });
}

// Update cached users every 5 seconds
function updateUsers() {
    cachedUsers = readUsers();
    console.log("User list updated:");
}
updateUsers();
setInterval(updateUsers, 5000);

// Register new user
app.post("/register", (req, res) => {
    const { username, password, nickname } = req.body;
    if (!username || !password || !nickname) return res.status(400).send("All fields are required.");

    if (cachedUsers.some(user => user.username === username)) {
        return res.status(400).send("Username already taken.");
    }

    fs.appendFileSync(USERS_FILE, `${username}:${password}:${nickname}\n`);
    updateUsers(); // Update immediately after registration
    res.status(201).send("Registration successful.");
});

// Login authentication
app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const user = cachedUsers.find(user => user.username === username && user.password === password);

    if (!user) return res.status(401).send("Invalid credentials.");
    res.status(200).json({ nickname: user.nickname });
});

// WebSocket Connection
io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("authenticate", (username, nickname) => {
        userSockets.set(socket.id, { username, nickname, currentRoom: null });
        socket.emit("nicknameSet", nickname);
    });

    socket.on("joinRoom", (roomName) => {
        if (!roomName) return socket.emit("errorMsg", "Room name required.");
        roomName = roomName.toLowerCase().trim();

        if (!rooms[roomName]) rooms[roomName] = { messages: [], users: new Set() };

        const userData = userSockets.get(socket.id);
        if (userData?.currentRoom) rooms[userData.currentRoom]?.users.delete(socket.id);

        userData.currentRoom = roomName;
        userSockets.set(socket.id, userData);
        rooms[roomName].users.add(socket.id);
        socket.join(roomName);

        socket.emit("joinedRoom", roomName);
        socket.emit("history", rooms[roomName].messages);
    });

    socket.on("sendMessage", (msg) => {
        const userData = userSockets.get(socket.id);
        if (!userData || !rooms[userData.currentRoom]) return;

        const timestamp = new Date().toLocaleTimeString();
        const message = `[${timestamp}] ${userData.nickname}: ${msg}`;
        rooms[userData.currentRoom].messages.push(message);

        if (rooms[userData.currentRoom].messages.length > 100) rooms[userData.currentRoom].messages.shift();

        io.to(userData.currentRoom).emit("receiveMessage", message);
    });

    socket.on("disconnect", () => {
        userSockets.delete(socket.id);
        console.log(`Socket disconnected: ${socket.id}`);
    });
});

server.listen(3000, () => console.log(`Server running at http://localhost:3000`));

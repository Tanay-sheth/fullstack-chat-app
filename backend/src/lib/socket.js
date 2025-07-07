import { Server } from "socket.io";
import http from "http";
import express from "express";

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin:
      process.env.NODE_ENV !== "development"
        ? process.env.FRONTEND_URL ||
          "https://fullstack-chat-app-1-80v6.onrender.com"
        : "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

//used to store online users
const userSocketMap = {}; //{userId: socketId}
//connectedUsers
const connectedUsers = new Map();

io.on("connection", (socket) => {
  console.log("A user connected...", socket.id);

  const userId = socket.handshake.query.userId;
  if (userId) userSocketMap[userId] = socket.id;
  connectedUsers.set(socket.id, {
    socketId: socket.id,
    peerId: null,
    inCall: false,
  });

  io.emit("getOnlineUsers", Object.keys(userSocketMap));
  console.log("[Socket.IO] userSocketMap:", userSocketMap);
  // Send current users to newly connected user
  socket.emit("users-list", Array.from(connectedUsers.values()));
  console.log(
    "[Socket.IO] users-list (on connect):",
    Array.from(connectedUsers.values())
  );

  // Broadcast to all other users that new user joined
  socket.broadcast.emit("user-joined", {
    socketId: socket.id,
    peerId: null,
    inCall: false,
  });
  // Handle peer ID registration
  socket.on("register-peer", (peerId) => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      user.peerId = peerId;
      connectedUsers.set(socket.id, user);

      // Notify all users about peer ID update
      io.emit("peer-registered", {
        socketId: socket.id,
        peerId: peerId,
        inCall: false,
      });
    }
  });
  // Handle call initiation
  socket.on("initiate-call", ({ targetSocketId, callerPeerId }) => {
    const targetUser = connectedUsers.get(targetSocketId);
    const callerUser = connectedUsers.get(socket.id);

    if (targetUser && callerUser && !targetUser.inCall && !callerUser.inCall) {
      // Mark both users as in call
      targetUser.inCall = true;
      callerUser.inCall = true;
      connectedUsers.set(targetSocketId, targetUser);
      connectedUsers.set(socket.id, callerUser);

      // Send call invitation to target user
      socket.to(targetSocketId).emit("incoming-call", {
        from: socket.id,
        callerPeerId: callerPeerId,
        callerSocketId: socket.id,
      });

      // Update all users about call status
      io.emit("users-list", Array.from(connectedUsers.values()));
      console.log(
        "[Socket.IO] users-list (on call/initiate):",
        Array.from(connectedUsers.values())
      );
    } else {
      socket.emit("call-failed", { reason: "User busy or not available" });
    }
  });
  // Handle call acceptance
  socket.on("accept-call", ({ callerSocketId, answererPeerId }) => {
    socket.to(callerSocketId).emit("call-accepted", {
      answererPeerId: answererPeerId,
      answererSocketId: socket.id,
    });
  });
  // Handle call rejection
  socket.on("reject-call", ({ callerSocketId }) => {
    const callerUser = connectedUsers.get(callerSocketId);
    const rejectorUser = connectedUsers.get(socket.id);

    if (callerUser && rejectorUser) {
      callerUser.inCall = false;
      rejectorUser.inCall = false;
      connectedUsers.set(callerSocketId, callerUser);
      connectedUsers.set(socket.id, rejectorUser);

      socket.to(callerSocketId).emit("call-rejected");
      io.emit("users-list", Array.from(connectedUsers.values()));
      console.log(
        "[Socket.IO] users-list (on call/reject):",
        Array.from(connectedUsers.values())
      );
    }
  });
  // Handle call end
  socket.on("end-call", ({ otherSocketId }) => {
    const otherUser = connectedUsers.get(otherSocketId);
    const currentUser = connectedUsers.get(socket.id);

    if (otherUser && currentUser) {
      otherUser.inCall = false;
      currentUser.inCall = false;
      connectedUsers.set(otherSocketId, otherUser);
      connectedUsers.set(socket.id, currentUser);

      socket.to(otherSocketId).emit("call-ended");
      io.emit("users-list", Array.from(connectedUsers.values()));
      console.log(
        "[Socket.IO] users-list (on call/end):",
        Array.from(connectedUsers.values())
      );
    }
  });
  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete userSocketMap[userId];
    io.emit("getOnlineUsers", Object.keys(userSocketMap));

    // Find if user was in call and notify the other party
    const disconnectedUser = connectedUsers.get(socket.id);
    if (disconnectedUser && disconnectedUser.inCall) {
      // Find other user in call and notify them
      for (const [socketId, user] of connectedUsers.entries()) {
        if (user.inCall && socketId !== socket.id) {
          user.inCall = false;
          connectedUsers.set(socketId, user);
          socket.to(socketId).emit("call-ended");
          break;
        }
      }
    }

    connectedUsers.delete(socket.id);
    socket.broadcast.emit("user-left", socket.id);
    socket.broadcast.emit("users-list", Array.from(connectedUsers.values()));
    console.log(
      "[Socket.IO] users-list (on disconnect):",
      Array.from(connectedUsers.values())
    );
  });
});
export { io, app, server };

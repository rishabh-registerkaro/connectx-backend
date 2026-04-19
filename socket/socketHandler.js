const rooms = {}; // 1-to-1 rooms
const groupRooms = {}; // group rooms
const reconnectTimers = {}; // key: "roomId:userName" → { timer, oldSocketId, isAdmin }

const MAX_GROUP_PARTICIPANTS = 10;
const RECONNECT_GRACE_MS = 12000; // 12 seconds — cancel cleanup if user reconnects within this window

// groupRooms[roomId] shape:
// {
//   admin: { id: socketId, userName },
//   participants: [{ id, userName }],
//   waitingRoom: [{ id, userName }]
// }

module.exports = (io) => {
  io.on("connection", (socket) => {
    console.log(`User Connected ${socket.id}`);

    let currentRoomId = null;
    let currentGroupRoomId = null;

    // =====================================================================
    // 1-TO-1 PEER CONNECTION
    // =====================================================================

    socket.on("join-room", ({ roomId, userName }) => {
      currentRoomId = roomId;

      if (!rooms[roomId]) rooms[roomId] = [];

      // Remove any stale entry for this userName (handles socket reconnect
      // where new socket ID arrives before old socket's disconnect fires)
      rooms[roomId] = rooms[roomId].filter((u) => u.userName !== userName);

      if (rooms[roomId].length >= 2) {
        socket.emit("room-full");
        return;
      }

      rooms[roomId].push({ id: socket.id, userName });
      socket.join(roomId);
      console.log(
        `[1-to-1] ${userName} joined room ${roomId} (${rooms[roomId].length}/2)`,
      );

      if (rooms[roomId].length === 2) {
        const firstPeer = rooms[roomId][0];
        socket.emit("existing-user", firstPeer.userName);
        io.to(firstPeer.id).emit("user-joined", userName);
        io.to(firstPeer.id).emit("ready");
        console.log(
          `[1-to-1] Room ready — only ${firstPeer.userName} creates offer`,
        );
      }
    });

    // Relay signaling — sent to the other person in the same room
    socket.on("offer", (offer, roomId) => {
      socket.to(roomId).emit("offer", offer);
    });

    socket.on("answer", (answer, roomId) => {
      socket.to(roomId).emit("answer", answer);
    });

    socket.on("ice-candidate", (candidate, roomId) => {
      socket.to(roomId).emit("ice-candidate", candidate);
    });

    // =====================================================================
    // 1-TO-1 CHAT  ← NEW (2 events only)
    // =====================================================================

    // Relay a chat message to the other person in the room
    socket.on("chat-message", ({ roomId, message, userName, timeStamp }) => {
      if (!rooms[roomId]) return;
      const isInRoom = rooms[roomId].some((u) => u.id === socket.id);
      if (!isInRoom) return;

      // Send to the other peer only (not back to the sender)
      socket.to(roomId).emit("chat-message", {
        message,
        userName,
        timeStamp,
        fromId: socket.id,
      });
      console.log(`[Chat] ${userName} → room ${roomId}: "${message}"`);
    });

    socket.on("chat-typing", ({ roomId, userName, isTyping }) => {
      if (!rooms[roomId]) return;
      const isInRoom = rooms[roomId].some((u) => u.id === socket.id);
      if (!isInRoom) return;
      socket.to(roomId).emit("chat-typing", { userName, isTyping });
    });

    // =====================================================================
    // 1-TO-1 REACTIONS
    // =====================================================================

    socket.on("send-reaction", ({ roomId, emoji }) => {
      if (!rooms[roomId]) return;
      const isInRoom = rooms[roomId].some((u) => u.id === socket.id);
      if (!isInRoom) return;
      socket.to(roomId).emit("receive-reaction", { emoji });
    });

    // =====================================================================
    // GROUP ROOMS (mesh, max 10 people, admin admission)
    // =====================================================================

    // User requests to join a group room
    socket.on("join-group-room", ({ roomId, userName }) => {
      currentGroupRoomId = roomId;

      // ── Reconnect detection: cancel pending cleanup and restore session ──
      const reconnectKey = `${roomId}:${userName}`;
      if (reconnectTimers[reconnectKey]) {
        clearTimeout(reconnectTimers[reconnectKey].timer);
        const { isAdmin } = reconnectTimers[reconnectKey];
        delete reconnectTimers[reconnectKey];

        const room = groupRooms[roomId];
        if (room) {
          // Restore with new socket ID
          room.participants.push({ id: socket.id, userName });
          if (isAdmin) room.admin = { id: socket.id, userName };
          socket.join(roomId);

          const existingPeers = room.participants
            .filter((p) => p.id !== socket.id)
            .map((p) => ({ socketId: p.id, userName: p.userName }));

          // Tell the rejoining user who is already in the room
          socket.emit("group-admitted", {
            participants: existingPeers,
            roomId,
          });
          socket.emit("group-joined", { isAdmin });

          // Tell every existing peer to open a new WebRTC connection to this user
          existingPeers.forEach((p) => {
            io.to(p.socketId).emit("group-new-peer", {
              socketId: socket.id,
              userName,
            });
          });

          console.log(
            `[Group] ${userName} reconnected to ${roomId} (isAdmin: ${isAdmin})`,
          );
          return;
        }
      }

      // Room doesn't exist yet — this user becomes admin
      if (!groupRooms[roomId]) {
        groupRooms[roomId] = {
          admin: { id: socket.id, userName },
          participants: [{ id: socket.id, userName }],
          waitingRoom: [],
        };
        socket.join(roomId);
        socket.emit("group-joined", { isAdmin: true });
        console.log(`[Group] ${userName} created room ${roomId} as admin`);
        return;
      }
      const room = groupRooms[roomId];

      // -- Guard: already a participant -- dont reporecess
      const alreadyParticipant = room.participants.some(
        (u) => u.id === socket.id,
      );
      if (alreadyParticipant) {
        return;
      }

      // -- Guard: already in waiting room
      const alreadyWaiting = room.waitingRoom.some((u) => u.id === socket.id);
      if (alreadyWaiting) {
        return;
      }

      // Room is full
      if (room.participants.length >= MAX_GROUP_PARTICIPANTS) {
        socket.emit("group-room-full");
        return;
      }

      // Add to waiting room and notify admin
      room.waitingRoom.push({ id: socket.id, userName });

      socket.emit("waiting-for-admission", {
        adminName: room.admin.userName,
      });

      io.to(room.admin.id).emit("user-waiting", {
        socketId: socket.id,
        userName,
      });
      console.log(`[Group] ${userName} is waiting to join room ${roomId}`);
    });

    // Admin admits a waiting user
    socket.on("admit-user", ({ roomId, socketId }) => {
      const room = groupRooms[roomId];
      if (!room || room.admin.id !== socket.id) return;

      const idx = room.waitingRoom.findIndex((u) => u.id === socketId);
      if (idx === -1) return;

      const [admitted] = room.waitingRoom.splice(idx, 1);
      room.participants.push(admitted);

      const targetSocket = io.sockets.sockets.get(socketId);
      if (!targetSocket) return;

      // Only join if not already in the Socket.IO room
      const socketRooms = targetSocket.rooms;
      if (!socketRooms.has(roomId)) {
        targetSocket.join(roomId);
      }

      // Tell admitted user who is already in the room
      const existingPeers = room.participants
        .filter((p) => p.id !== socketId)
        .map((p) => ({ socketId: p.id, userName: p.userName }));

      io.to(socketId).emit("group-admitted", {
        participants: existingPeers,
        roomId,
      });

      // Tell all existing participants to create an offer to the new user
      existingPeers.forEach((p) => {
        io.to(p.socketId).emit("group-new-peer", {
          socketId: admitted.id,
          userName: admitted.userName,
        });
      });

      console.log(
        `[Group] ${admitted.userName} admitted to ${roomId} (${room.participants.length}/${MAX_GROUP_PARTICIPANTS})`,
      );
    });

    // Admin rejects a waiting user

    socket.on("reject-user", ({ roomId, socketId }) => {
      const room = groupRooms[roomId];
      if (!room || room.admin.id !== socket.id) return;

      const idx = room.waitingRoom.findIndex((u) => u.id === socketId);
      if (idx === -1) return;

      const [rejected] = room.waitingRoom.splice(idx, 1);
      io.to(socketId).emit("group-rejected");
      console.log(`[Group] ${rejected.userName} rejected from ${roomId}`);
    });

    // Group mesh signaling — always routed to a specific peer by targetId
    socket.on("group-offer", ({ offer, targetId, roomId }) => {
      io.to(targetId).emit("group-offer", {
        offer,
        fromId: socket.id,
        roomId,
      });
    });

    socket.on("group-answer", ({ answer, targetId, roomId }) => {
      io.to(targetId).emit("group-answer", {
        answer,
        fromId: socket.id,
        roomId,
      });
    });

    socket.on("group-ice-candidate", ({ candidate, targetId, roomId }) => {
      io.to(targetId).emit("group-ice-candidate", {
        candidate,
        fromId: socket.id,
        roomId,
      });
    });

    // =====================================================================
    // GROUP CHAT
    // =====================================================================

    socket.on(
      "group-chat-message",
      ({ roomId, message, userName, timeStamp }) => {
        const room = groupRooms[roomId];
        if (!room) return;
        const isInRoom = room.participants.some((u) => u.id === socket.id);
        if (!isInRoom) return;
        // Broadcast to everyone else in the room
        socket.to(roomId).emit("group-chat-message", {
          message,
          userName,
          timeStamp,
          fromId: socket.id,
        });
      },
    );

    socket.on("group-chat-typing", ({ roomId, userName, isTyping }) => {
      const room = groupRooms[roomId];
      if (!room) return;
      const isInRoom = room.participants.some((u) => u.id === socket.id);
      if (!isInRoom) return;
      socket.to(roomId).emit("group-chat-typing", { userName, isTyping });
    });

    // =====================================================================
    // GROUP REACTIONS  ← NEW
    // =====================================================================

    socket.on("group-reaction", ({ roomId, emoji, userName }) => {
      const room = groupRooms[roomId];
      if (!room) return;
      const isInRoom = room.participants.some((u) => u.id === socket.id);
      if (!isInRoom) return;
      socket
        .to(roomId)
        .emit("group-reaction", { emoji, userName, socketId: socket.id });
    });

    // =====================================================================
    // GROUP RAISE HAND  ← NEW
    // =====================================================================

    socket.on("group-raise-hand", ({ roomId, userName, isRaised }) => {
      const room = groupRooms[roomId];
      if (!room) return;
      const isInRoom = room.participants.some((u) => u.id === socket.id);
      if (!isInRoom) return;
      socket
        .to(roomId)
        .emit("group-hand-raised", { socketId: socket.id, userName, isRaised });
    });

    // =====================================================================
    // GROUP MUTE ALL (admin only)  ← NEW
    // =====================================================================

    socket.on("group-mute-all", ({ roomId }) => {
      const room = groupRooms[roomId];
      if (!room) return;
      if (room.admin.id !== socket.id) return;
      socket.to(roomId).emit("group-mute-all");
    });

    // =====================================================================
    // DISCONNECT — clean up both room types
    // =====================================================================

    socket.on("disconnect", () => {
      console.log(`User disconnected ${socket.id}`);

      // ── 1-to-1 cleanup ──
      if (currentRoomId && rooms[currentRoomId]) {
        rooms[currentRoomId] = rooms[currentRoomId].filter(
          (u) => u.id !== socket.id,
        );
        if (rooms[currentRoomId].length === 0) {
          delete rooms[currentRoomId];
        } else {
          socket.to(currentRoomId).emit("user-disconnected");
        }
      }
      // ── Group cleanup — with reconnect grace period ──
      if (currentGroupRoomId && groupRooms[currentGroupRoomId]) {
        const room = groupRooms[currentGroupRoomId];

        // Always remove from waiting room immediately (they hadn't joined yet)
        room.waitingRoom = room.waitingRoom.filter((u) => u.id !== socket.id);

        const userInfo = room.participants.find((u) => u.id === socket.id);
        if (!userInfo) return; // not a participant, nothing more to do

        const wasAdmin = room.admin.id === socket.id;
        const savedRoomId = currentGroupRoomId;
        const savedUserName = userInfo.userName;
        const reconnectKey = `${savedRoomId}:${savedUserName}`;

        // Remove from participants immediately so room state is consistent
        room.participants = room.participants.filter((u) => u.id !== socket.id);

        // Cancel any existing stale timer for this user
        if (reconnectTimers[reconnectKey]) {
          clearTimeout(reconnectTimers[reconnectKey].timer);
        }

        // Give the user RECONNECT_GRACE_MS to reconnect before finalising cleanup
        const timer = setTimeout(() => {
          delete reconnectTimers[reconnectKey];
          const currentRoom = groupRooms[savedRoomId];
          if (!currentRoom) return;

          // Notify remaining peers that this user is truly gone
          io.to(savedRoomId).emit("group-peer-left", { socketId: socket.id });
          console.log(`[Group] ${savedUserName} fully left ${savedRoomId}`);

          // Promote next admin if needed
          if (wasAdmin) {
            if (currentRoom.participants.length > 0) {
              currentRoom.admin = currentRoom.participants[0];
              io.to(currentRoom.admin.id).emit("group-you-are-admin");
              console.log(
                `[Group] ${currentRoom.admin.userName} is new admin of ${savedRoomId}`,
              );
            } else {
              delete groupRooms[savedRoomId];
              console.log(
                `[Group] Room ${savedRoomId} deleted — no participants left`,
              );
            }
          }

          // Clean up empty room
          if (
            groupRooms[savedRoomId] &&
            currentRoom.participants.length === 0
          ) {
            delete groupRooms[savedRoomId];
          }
        }, RECONNECT_GRACE_MS);

        reconnectTimers[reconnectKey] = {
          timer,
          oldSocketId: socket.id,
          isAdmin: wasAdmin,
        };
        console.log(
          `[Group] ${savedUserName} disconnected — waiting ${RECONNECT_GRACE_MS}ms for reconnect`,
        );
      }
    });
  });
};

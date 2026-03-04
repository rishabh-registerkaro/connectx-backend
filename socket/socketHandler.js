// module.exports = (io) => {
//     const rooms = {};

//     io.on('connection', (socket) => {
//         console.log('User connected', socket.id);
//         let currentRoomId = null;

//         socket.on('join-room', ({ roomId, userName }) => {
//             currentRoomId = roomId;

//             if (!rooms[roomId]) rooms[roomId] = [];

//             if (rooms[roomId].length >= 2) {
//                 socket.emit('room-full');
//                 return;
//             }

//             rooms[roomId].push({ id: socket.id, userName });
//             socket.join(roomId);
//             console.log(`${userName} joined room ${roomId} (${rooms[roomId].length}/2)`);

//             if (rooms[roomId].length === 2) {
//                 const firstPeer = rooms[roomId][0];
//                 socket.emit('existing-user', firstPeer.userName);   // → peer 2
//                 io.to(firstPeer.id).emit('user-joined', userName);  // → peer 1
//                 io.to(firstPeer.id).emit('ready');                  // → peer 1 only
//                 console.log(`Room ready – only ${firstPeer.userName} creates offer`);
//             }
//         });

//         socket.on('offer', (offer, roomId) => {
//             socket.to(roomId).emit('offer', offer);
//         });

//         socket.on('answer', (answer, roomId) => {
//             socket.to(roomId).emit('answer', answer);
//         });

//         socket.on('ice-candidate', (candidate, roomId) => {
//             socket.to(roomId).emit('ice-candidate', candidate);
//         });

//         socket.on('disconnect', () => {
//             if (!currentRoomId) return;
//             rooms[currentRoomId] = rooms[currentRoomId]?.filter(user => user.id !== socket.id) || [];
//             if (rooms[currentRoomId]?.length === 0) delete rooms[currentRoomId];
//             socket.to(currentRoomId).emit('user-disconnected');
//             console.log(`User ${socket.id} left room ${currentRoomId}`);
//         });
//     });
// };


// socket/socketHandler.js
// ─────────────────────────────────────────────────────────────────────────────
// TWO SEPARATE SYSTEMS:
//   1. 1-to-1 rooms  → used by /call/[roomId]
//   2. Group rooms   → used by /call/group/[roomId]  (max 10 people + waiting room)
// ─────────────────────────────────────────────────────────────────────────────

const rooms = {};  // 1-to-1 rooms
const groupRooms = {}; // group rooms 


const MAX_GROUP_PARTICIPANTS = 10;

// groupRooms[roomId] shape:
// {
//   admin: { id: socketId, userName },
//   participants: [{ id, userName }],
//   waitingRoom: [{ id, userName }]
// }


module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log(`User Connected ${socket.id}`);

        let currentRoomId = null;
        let currentGroupRoomId = null;


        // =====================================================================
        // 1-TO-1 PEER CONNECTION
        // =====================================================================

        socket.on('join-room', ({ roomId, userName }) => {
            currentRoomId = roomId;

            if (!rooms[roomId]) rooms[roomId] = [];

            if (rooms[roomId].length >= 2) {
                socket.emit("room-full");
                return;
            }

            rooms[roomId].push({ id: socket.id, userName });
            socket.join(roomId);
            console.log(`[1-to-1] ${userName} joined room ${roomId} (${rooms[roomId].length}/2)`);

            if (rooms[roomId].length === 2) {
                const firstPeer = rooms[roomId][0];
                socket.emit("existing-user", firstPeer.userName);
                io.to(firstPeer.id).emit("user-joined", userName);
                io.to(firstPeer.id).emit("ready");
                console.log(`[1-to-1] Room ready — only ${firstPeer.userName} creates offer`);
            }
        })

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
        // GROUP ROOMS (mesh, max 10 people, admin admission)
        // =====================================================================

        // User requests to join a group room
        socket.on('join-group-room', ({ roomId, userName }) => {
            currentGroupRoomId = roomId;

            // Room doesn't exist yet — this user becomes admin
            if (!groupRooms[roomId]) {
                groupRooms[roomId] = {
                    admin: { id: socket.id, userName },
                    participants: [{ id: socket.id, userName }],
                    waitingRoom: []
                }
                socket.join(roomId);
                socket.emit('group-joined', { isAdmin: true })
                console.log(`[Group] ${userName} created room ${roomId} as admin`);
                return;
            }
            const room = groupRooms[roomId];

            // Room is full
            if (room.participants.length >= MAX_GROUP_PARTICIPANTS) {
                socket.emit("group-room-full");
                return;
            }

            // Add to waiting room and notify admin
            room.waitingRoom.push({ id: socket.id, userName });

            socket.emit("waiting-for-admission", {
                adminName: room.admin.userName
            });

            io.to(room.admin.id).emit("user-waiting", {
                socketId: socket.id,
                userName
            })
            console.log(`[Group] ${userName} is waiting to join room ${roomId}`);
        })

        // Admin admits a waiting user
        socket.on("admit-user", ({ roomId, socketId }) => {
            const room = groupRooms[roomId];
            if (!room || room.admin.id !== socket.id) return;

            const idx = room.waitingRoom.findIndex(u => u.id === socketId);
            if (idx === -1) return;

            const [admitted] = room.waitingRoom.splice(idx, 1);
            room.participants.push(admitted);

            const targetSocket = io.sockets.sockets.get(socketId);
            if (!targetSocket) return;

            targetSocket.join(roomId);

            // Tell admitted user who is already in the room
            const existingPeers = room.participants.filter(p => p.id !== socketId).map(p => ({ socketId: p.id, userName: p.userName }))

            io.to(socketId).emit('group-admitted', {
                participants: existingPeers,
                roomId
            })

            // Tell all existing participants to create an offer to the new user
            existingPeers.forEach(p => {
                io.to(p.socketId).emit("group-new-peer", {
                    socketId: admitted.id,
                    userName: admitted.userName
                });
            });

            console.log(`[Group] ${admitted.userName} admitted to ${roomId} (${room.participants.length}/${MAX_GROUP_PARTICIPANTS})`);
        })

        // Admin rejects a waiting user

        socket.on('admin-reject', ({ roomId, socketId }) => {
            const room = groupRooms[roomId];
            if (!room || room.admin.id !== socket.id) return;

            const idx = room.waitingRoom.findIndex(u => u.id === socketId);
            if (idx === -1) return;

            const [rejected] = room.waitingRoom.splice(idx, 1);
            io.to(socketId).emit("group-rejected");
            console.log(`[Group] ${rejected.userName} rejected from ${roomId}`);
        })

        // Group mesh signaling — always routed to a specific peer by targetId
        socket.on("group-offer", ({ offer, targetId, roomId }) => {
            io.to(targetId).emit("group-offer", {
                offer,
                fromId: socket.id,
                roomId
            });
        });

        socket.on("group-answer", ({ answer, targetId, roomId }) => {
            io.to(targetId).emit("group-answer", {
                answer,
                fromId: socket.id,
                roomId
            });
        });

        socket.on("group-ice-candidate", ({ candidate, targetId, roomId }) => {
            io.to(targetId).emit("group-ice-candidate", {
                candidate,
                fromId: socket.id,
                roomId
            });
        });

        // =====================================================================
        // DISCONNECT — clean up both room types
        // =====================================================================

        socket.on('disconnect', () => {
            console.log(`User disconnected ${socket.id}`);

            // ── 1-to-1 cleanup ──
            if (currentRoomId && rooms[currentRoomId]) {
                rooms[currentRoomId] = rooms[currentRoomId].filter(u => u.id !== socket.id);
                if (rooms[currentRoomId].length === 0) {
                    delete rooms[currentRoomId];
                } else {
                    socket.to(currentRoomId).emit("user-disconnected");
                }
            }
            // ── Group cleanup ──
            if (currentGroupRoomId && groupRooms[currentGroupRoomId]) {
                const room = groupRooms[currentGroupRoomId];

                // Remove from waiting room if they were waiting
                room.waitingRoom = room.waitingRoom.filter(u => u.id !== socket.id);

                // Remove from participants
                const wasParticipant = room.participants.some(u => u.id === socket.id);
                room.participants = room.participants.filter(u => u.id !== socket.id);

                if (wasParticipant) {
                    socket.to(currentGroupRoomId).emit("group-peer-left", {
                        socketId: socket.id
                    });
                    console.log(`[Group] ${socket.id} left room ${currentGroupRoomId} (${room.participants.length} remaining)`);
                }

                // If admin left — promote next participant
                if (room.admin.id === socket.id) {
                    if (room.participants.length > 0) {
                        room.admin = room.participants[0];
                        io.to(room.admin.id).emit("group-you-are-admin");
                        console.log(`[Group] ${room.admin.userName} is new admin of ${currentGroupRoomId}`);
                    } else {
                        delete groupRooms[currentGroupRoomId];
                        console.log(`[Group] Room ${currentGroupRoomId} deleted — no participants left`);
                    }
                }

                // Clean up empty rooms
                if (groupRooms[currentGroupRoomId] && room.participants.length === 0) {
                    delete groupRooms[currentGroupRoomId];
                }
            }
        })
    })
}
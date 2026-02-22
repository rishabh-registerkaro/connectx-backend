// module.exports = (io) => {
//     const rooms = {} // in memory
//     io.on('connection', (socket) => {
//         console.log('User connected', socket.id);
//         let currentRoomId = null;
//         socket.on('join-room', (roomId) => {
//             currentRoomId = roomId
//             if (!rooms[roomId]) rooms[roomId] = [];

//             if (rooms[roomId].length >= 2) {
//                 socket.emit('room-full');
//                 console.log(`Room ${roomId} is full`);
//                 return;
//             }

//             rooms[roomId].push(socket.id);
//             socket.join(roomId);

//             console.log(`User ${socket.id} joined room ${roomId} (${rooms[roomId].length}/2)`);

//             // Tell others in room someone joined
//             socket.to(roomId).emit('user-joined', socket.id);

//             // If second user → tell everyone to start negotiation
//             if (rooms[roomId].length === 2) {
//                 io.to(roomId).emit('ready');
//                 console.log(`Room ${roomId} is ready – negotiation can start`);
//             }

//             socket.on('offer', (offer) => {
//                 console.log(`Offer recevied in room ${roomId} from ${socket.id}`);
//                 socket.to(roomId).emit('offer', offer);
//             })

//             socket.on('answer', (answer) => {
//                 console.log(`Answer received in room ${roomId} from ${socket.id}`)
//                 socket.to(roomId).emit('answer', answer)
//             })

//             socket.on('ice-candidate', (candidate) => {
//                 console.log(`ICE candidate received in room ${roomId} from ${socket.id}`);
//                 socket.to(roomId).emit('ice-candidate', candidate);
//             });


//         })
//         // disconnect
//         socket.on('disconnect', () => {
//             rooms[roomId] = rooms[roomId]?.filter(id => id !== socket.id) || [];
//             if (rooms[roomId]?.length === 0) delete rooms[roomId];
//             socket.to(roomId).emit('user-disconnected');
//             console.log(`User ${socket.id} left room ${roomId}`);
//         })
//     })
// }

module.exports = (io) => {
    const rooms = {};

    io.on('connection', (socket) => {
        console.log('User connected', socket.id);

        let currentRoomId = null; // ← track it here

        socket.on('join-room', (roomId) => {
            currentRoomId = roomId; // ← assign it

            if (!rooms[roomId]) rooms[roomId] = [];

            if (rooms[roomId].length >= 2) {
                socket.emit('room-full');
                return;
            }

            rooms[roomId].push(socket.id);
            socket.join(roomId);
            console.log(`User ${socket.id} joined room ${roomId} (${rooms[roomId].length}/2)`);

            socket.to(roomId).emit('user-joined', socket.id);

            if (rooms[roomId].length === 2) {
                io.to(roomId).emit('ready');
                console.log(`Room ${roomId} ready – starting negotiation`);
            }
        });

        socket.on('offer', (offer, roomId) => {
            socket.to(roomId).emit('offer', offer);
        });

        socket.on('answer', (answer, roomId) => {
            socket.to(roomId).emit('answer', answer);
        });

        socket.on('ice-candidate', (candidate, roomId) => {
            socket.to(roomId).emit('ice-candidate', candidate);
        });

        socket.on('disconnect', () => {
            if (!currentRoomId) return;
            rooms[currentRoomId] = rooms[currentRoomId]?.filter(id => id !== socket.id) || [];
            if (rooms[currentRoomId]?.length === 0) delete rooms[currentRoomId];
            socket.to(currentRoomId).emit('user-disconnected');
            console.log(`User ${socket.id} left room ${currentRoomId}`);
        });
    });
};
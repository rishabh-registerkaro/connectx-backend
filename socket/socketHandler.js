module.exports = (io) => {
    const rooms = {};

    io.on('connection', (socket) => {
        console.log('User connected', socket.id);
        let currentRoomId = null;

        socket.on('join-room', ({ roomId, userName }) => {
            currentRoomId = roomId;

            if (!rooms[roomId]) rooms[roomId] = [];

            if (rooms[roomId].length >= 2) {
                socket.emit('room-full');
                return;
            }

            rooms[roomId].push({ id: socket.id, userName });
            socket.join(roomId);
            console.log(`${userName} joined room ${roomId} (${rooms[roomId].length}/2)`);

            if (rooms[roomId].length === 2) {
                const firstPeer = rooms[roomId][0];
                socket.emit('existing-user', firstPeer.userName);   // → peer 2
                io.to(firstPeer.id).emit('user-joined', userName);  // → peer 1
                io.to(firstPeer.id).emit('ready');                  // → peer 1 only
                console.log(`Room ready – only ${firstPeer.userName} creates offer`);
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
            rooms[currentRoomId] = rooms[currentRoomId]?.filter(user => user.id !== socket.id) || [];
            if (rooms[currentRoomId]?.length === 0) delete rooms[currentRoomId];
            socket.to(currentRoomId).emit('user-disconnected');
            console.log(`User ${socket.id} left room ${currentRoomId}`);
        });
    });
};
module.exports = (io) => {
    const rooms = {};

    io.on('connection', (socket) => {
        console.log('User connected', socket.id);

        let currentRoomId = null; // ← track it here

        socket.on('join-room', ({ roomId, userName }) => {
            currentRoomId = roomId; // ← assign it

            if (!rooms[roomId]) rooms[roomId] = [];

            if (rooms[roomId].length >= 2) {
                socket.emit('room-full');
                return;
            }

            // rooms[roomId].push(socket.id);
            rooms[roomId].push({ id: socket.id, userName })
            socket.join(roomId);
            console.log(`User ${socket.id} joined room ${roomId} (${rooms[roomId].length}/2)`);

            // socket.to(roomId).emit('user-joined', socket.id);
            socket.to(roomId).emit('user-joined', userName)

            if (rooms[roomId].length === 2) {
                io.to(roomId).emit('ready');
                console.log(`Room ${roomId} ready – starting negotiation`);
            }

            const existingUser = rooms[roomId].find(user => user.id !== socket.id)
            if (existingUser) {
                socket.emit('user-joined', existingUser.userName)
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
            // ✅ Change to this (filter by user.id now):
            // rooms[currentRoomId] = rooms[currentRoomId]?.filter(id => id !== socket.id) || [];
            rooms[currentRoomId] = rooms[currentRoomId]?.filter(user => user.id !== socket.id) || [];
            if (rooms[currentRoomId]?.length === 0) delete rooms[currentRoomId];
            socket.to(currentRoomId).emit('user-disconnected');
            console.log(`User ${socket.id} left room ${currentRoomId}`);
        });
    });
};
module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log('User connected', socket.id);

        const rooms = {} // in memory

        socket.on('join-room', (roomId) => {
            if (!rooms[roomId]) rooms[roomId] = [];

            if (rooms[roomId].length > 2) {
                socket.emit('room-full');
                console.log(`Room ${roomId} is full`);
                return;
            }

            rooms[roomId].push(socket.id);
            socket.join(roomId);

            console.log(`User ${socket.id} joined room ${roomId} (${rooms[roomId].length}/2)`);

            // Tell others in room someone joined
            socket.to(roomId).emit('user-joined', socket.id);

            // If second user → tell everyone to start negotiation
            if (rooms[roomId].length === 2) {
                io.to(roomId).emit('ready');
                console.log(`Room ${roomId} is ready – negotiation can start`);
            }

            socket.on('offer', (offer) => {
                console.log(`Offer recevied in room ${roomId} from ${socket.id}`);
                socket.to(roomId).emit('offer', offer);
            })

            socket.on('answer', (answer) => {
                console.log(`Answer received in room ${roomId} from ${socket.id}`)
                socket.to(roomId).emit('answer', answer)
            })

            socket.on('ice-candidate', (candidate) => {
                console.log(`ICE candidate received in room ${roomId} from ${socket.id}`);
                socket.to(roomId).emit('ice-candidate', candidate);
            });

            // disconnect
            socket.on('disconnect', () => {
                rooms[roomId] = rooms[roomId]?.filter(id => id !== socket.id) || [];
                if (rooms[roomId]?.length === 0) delete rooms[roomId];
                socket.to(roomId).emit('user-disconnected');
                console.log(`User ${socket.id} left room ${roomId}`);
            })
        })
    })
}
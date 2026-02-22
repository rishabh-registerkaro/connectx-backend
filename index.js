const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes.route');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);
const io = socketio(server, { cors: { origin: '*' } });  // For now, open CORS; tighten later

app.use(helmet());
app.use(cors({
    origin: '*', // temporary for local testing
    credentials: true,
}));
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/health', (req, res) => {
    res.status(200).json({ message: 'OK' })
})

// Socket.io setup (placeholder for now; we'll expand in Phase 2)
io.on('connection', (socket) => {
    console.log('User connected');
    socket.on('disconnect', () => console.log('User disconnected'));
});

const PORT = process.env.PORT || 5001;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
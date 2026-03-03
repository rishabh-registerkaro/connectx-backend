const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes.route');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const dotenv = require('dotenv');
const socketHandler = require('./socket/socketHandler')
dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:3000',
        credentials: true
    },
    transports: ["websocket"],
    pingTimeout: 60000,   // ← ADD
    pingInterval: 25000,  // ← ADD
});
// hello world
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));
app.use(cookieParser()); // ← Add this BEFORE routes
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000', // Must be specific when credentials: true
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/health', (req, res) => {
    res.status(200).json({ message: 'OK' })
})

// Initializing Socket Handler
socketHandler(io);

const PORT = process.env.PORT || 5001;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
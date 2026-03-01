const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const connectDB = require('./config/db');
const authRoutes = require('./routes/authRoutes.route');
const cors = require('cors');
const helmet = require('helmet');
const dotenv = require('dotenv');
const socketHandler = require('./socket/socketHandler')
dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
    cors: { origin: '*' },
    transports: ["websocket"]
});  // For now, open CORS; tighten later

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

// Initializing Socket Handler
socketHandler(io);

const PORT = process.env.PORT || 5001;
server.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const http = require('http');
const { Server } = require('socket.io');

// Load environment variables
dotenv.config();

const app = express();
const server = http.createServer(app);

// Parse client origins for CORS
const rawClientUrls = process.env.CLIENT_URL || "http://localhost:5173";
const allowedOrigins = rawClientUrls
  .split(',')
  .map(url => url.trim().replace(/\/$/, ''))
  .filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const cleanOrigin = origin.replace(/\/$/, '');
    if (
      allowedOrigins.includes('*') ||
      allowedOrigins.includes(cleanOrigin) ||
      process.env.NODE_ENV !== 'production'
    ) {
      return callback(null, true);
    }
    return callback(null, true); // Permissive to prevent CORS block on varied deployment subdomains
  },
  methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  credentials: true
};

// Socket.IO setup with CORS
const io = new Server(server, {
  cors: corsOptions
});

// Store io instance globally for use in routes
global.io = io;

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Join room based on user office for targeted updates
  socket.on('join-office', (office) => {
    if (office) {
      socket.join(`office:${office}`);
      console.log(`Socket ${socket.id} joined office: ${office}`);
    }
  });

  // Join room based on user role
  socket.on('join-role', (role) => {
    if (role) {
      socket.join(`role:${role}`);
      console.log(`Socket ${socket.id} joined role: ${role}`);
    }
  });

  // Join personal room for user-specific updates
  socket.on('join-user', (userId) => {
    if (userId) {
      socket.join(`user:${userId}`);
      console.log(`Socket ${socket.id} joined user: ${userId}`);
    }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Handle unhandled rejections globally without crashing node process immediately
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Mongoose event listeners
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB connection lost. Attempting to reconnect...');
});
mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err.message);
});

// MongoDB Connection with auto-retry
const connectDB = async (retryCount = 0) => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    console.log(`Retrying MongoDB connection in 5 seconds (attempt ${retryCount + 1})...`);
    setTimeout(() => connectDB(retryCount + 1), 5000);
  }
};

// Connect to database
connectDB();

// Basic route
app.get('/', (req, res) => {
  res.json({ message: 'Document Tracking System API is running!' });
});

// Health check route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    database: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    socketConnections: io.engine.clientsCount
  });
});

// Routes
app.use('/api/auth', require('./routes/auth.routes').router);
app.use('/api/endusers', require('./routes/enduser.routes'));
app.use('/api/procurementusers', require('./routes/procurementuser.routes'));
app.use('/api/documents', require('./routes/documents.routes'));
app.use('/api/offices', require('./routes/offices.routes'));
app.use('/api/departments', require('./routes/departments.routes'));
app.use('/api/source-of-funds', require('./routes/sourceOfFunds.routes'));
app.use('/api/profile', require('./routes/profile.routes'));
app.use('/api/settings', require('./routes/settings.routes'));
app.use('/api/reports', require('./routes/reports.routes'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

const PORT = process.env.PORT || 5000;

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set PORT to a different value.`);
    process.exit(1);
  }
  console.error('Server error:', error);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`Socket.IO ready for real-time updates`);
});

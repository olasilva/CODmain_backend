const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fileUpload = require('express-fileupload');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const courseRoutes = require('./routes/courseRoutes');
const admissionRoutes = require('./routes/admissionRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const assignmentRoutes = require('./routes/assignmentRoutes');
const resultRoutes = require('./routes/resultRoutes');
const newsRoutes = require('./routes/newsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const staffRoutes = require('./routes/staffRoutes');
const materialRoutes = require('./routes/materialRoutes');
const messageRoutes = require('./routes/messageRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const settingsRoutes = require('./routes/settingsRoutes');
const reportRoutes = require('./routes/reportRoutes');
const publicRoutes = require('./routes/publicRoutes');

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api', limiter);

// Body parsing
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(fileUpload({
  limits: { fileSize: 50 * 1024 * 1024 },
  useTempFiles: true
}));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/admissions', admissionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/results', resultRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api', publicRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
// src/app.js
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fileUpload = require('express-fileupload');
const session = require('express-session');
const passport = require('./config/passport');
require('dotenv').config();

// ─── Route imports ───
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
const uploadRoutes = require('./routes/uploadRoutes');
const sessionRoutes = require('./routes/sessionRoutes');
const contactRoutes = require('./routes/contactRoutes');   // ← NEW

const app = express();

// ═══════════════════════════════════════════════════════════════
// 1. SECURITY + CORS
// ═══════════════════════════════════════════════════════════════

app.use(helmet());

// ─── Static origins (always allowed) ───
const staticOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'https://co-dmain.vercel.app',
];

// ─── Extra origins from FRONTEND_URL (comma-separated) ───
const envOrigins = (process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...staticOrigins, ...envOrigins])];

// ─── Vercel preview URLs: co-dmain-<hash>.vercel.app ───
const vercelPreviewRegex = /^https:\/\/co-dmain[a-z0-9-]*\.vercel\.app$/;

// Log the allowlist once at boot so it's easy to verify
console.log('🔓 CORS allowlist:', allowedOrigins);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      if (vercelPreviewRegex.test(origin)) return callback(null, true);

      console.warn('🚫 CORS blocked origin:', origin);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.options('*', cors());

// ═══════════════════════════════════════════════════════════════
// 2. RATE LIMITING
// ═══════════════════════════════════════════════════════════════

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
});
app.use('/api', limiter);

// ═══════════════════════════════════════════════════════════════
// 3. BODY PARSERS
// ═══════════════════════════════════════════════════════════════

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(
  fileUpload({
    limits: { fileSize: 5 * 1024 * 1024 },
    useTempFiles: false,
    createParentPath: true,
    abortOnLimit: true,
  })
);

// ═══════════════════════════════════════════════════════════════
// 4. SESSION + PASSPORT
// ═══════════════════════════════════════════════════════════════

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'fallback_secret_for_dev',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production' },
  })
);
app.use(passport.initialize());
app.use(passport.session());

// ═══════════════════════════════════════════════════════════════
// 5. ROUTES
// ═══════════════════════════════════════════════════════════════

app.use('/api/upload', uploadRoutes);
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
app.use('/api/contact', contactRoutes);   // ← NEW

// ─── Online sessions (staff + student) ───
app.use('/api', sessionRoutes);

// ═══════════════════════════════════════════════════════════════
// 6. HEALTH CHECK
// ═══════════════════════════════════════════════════════════════

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
  });
});

// ═══════════════════════════════════════════════════════════════
// 7. ERROR HANDLERS
// ═══════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
  console.error('Error:', err);
  const status = err.status || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

module.exports = app;
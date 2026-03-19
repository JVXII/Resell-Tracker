require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

let GIT_COMMIT = 'unknown';
try { GIT_COMMIT = execSync('git rev-parse --short HEAD').toString().trim(); } catch (_) {}

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const { db } = require('./db');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Attach DB to every request
app.use((req, res, next) => { req.db = db; next(); });

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/api/items', require('./routes/items'));
app.use('/api/share', require('./routes/share'));
app.use('/api/shared', require('./routes/shared'));

// Version endpoint
app.get('/api/version', (req, res) => res.json({ commit: GIT_COMMIT }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(JSON.stringify({ done: 'started' })));

module.exports = app;

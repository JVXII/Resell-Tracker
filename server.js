require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const SQLiteStore = require('connect-sqlite3')(session);
const { db } = require('./db');

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: dataDir }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
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

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Resell Tracker running on http://localhost:${PORT}`));

module.exports = app;

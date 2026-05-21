// server.js - Backend kuu ya Phone Tracker System
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ============ MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// ============ DATA STORAGE (In-memory with file backup) ============
const DATA_FILE = './data.json';
let data = {
  users: [],
  devices: [],
  locations: [],
  commands: [],
  updates: []
};

// Load data from file if exists
if (fs.existsSync(DATA_FILE)) {
  try {
    const savedData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    data = { ...data, ...savedData };
  } catch(e) { console.log('No existing data file'); }
}

// Save data function
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Default admin user (change password after first login!)
const DEFAULT_ADMIN = {
  id: 'admin-001',
  username: 'admin',
  password: bcrypt.hashSync('admin123', 10),
  role: 'super_admin',
  createdAt: new Date().toISOString()
};

if (!data.users.find(u => u.username === 'admin')) {
  data.users.push(DEFAULT_ADMIN);
  saveData();
}

// ============ AUTHENTICATION MIDDLEWARE ============
function verifyToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ success: false, message: 'No token provided' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET || 'zass-secret-key-2024', (err, decoded) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Invalid token' });
    }
    req.userId = decoded.userId;
    req.username = decoded.username;
    next();
  });
}

// ============ API ROUTES ============

// Health check
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'running', 
    timestamp: new Date().toISOString(),
    devices: data.devices.length,
    locations: data.locations.length
  });
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  const user = data.users.find(u => u.username === username);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  
  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
  
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET || 'zass-secret-key-2024',
    { expiresIn: '7d' }
  );
  
  res.json({
    success: true,
    token: token,
    user: { id: user.id, username: user.username, role: user.role }
  });
});

// Change password
app.post('/api/change-password', verifyToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  
  const user = data.users.find(u => u.id === req.userId);
  if (!user || !bcrypt.compareSync(oldPassword, user.password)) {
    return res.status(401).json({ success: false, message: 'Old password incorrect' });
  }
  
  user.password = bcrypt.hashSync(newPassword, 10);
  saveData();
  
  res.json({ success: true, message: 'Password changed successfully' });
});

// Register a new device (kwa ajili ya simu yako)
app.post('/api/device/register', verifyToken, async (req, res) => {
  const { deviceName, deviceId, imei } = req.body;
  
  const existingDevice = data.devices.find(d => d.deviceId === deviceId);
  if (existingDevice) {
    return res.json({ 
      success: true, 
      message: 'Device already registered',
      device: existingDevice 
    });
  }
  
  const newDevice = {
    id: uuidv4(),
    deviceId: deviceId,
    deviceName: deviceName || 'My Phone',
    imei: imei || 'N/A',
    ownerId: req.userId,
    status: 'active',
    lastSeen: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    settings: {
      updateInterval: 5, // minutes
      autoUpdate: true,
      locationSharing: true
    }
  };
  
  data.devices.push(newDevice);
  saveData();
  
  res.json({ success: true, device: newDevice });
});

// Receive location from phone (Android app inatuma hapa)
app.post('/api/location', async (req, res) => {
  const { deviceId, lat, lng, accuracy, battery, networkType, timestamp } = req.body;
  
  const device = data.devices.find(d => d.deviceId === deviceId);
  if (!device) {
    return res.status(404).json({ success: false, message: 'Device not registered' });
  }
  
  // Update device last seen
  device.lastSeen = new Date().toISOString();
  
  // Save location
  const location = {
    id: uuidv4(),
    deviceId: deviceId,
    lat: parseFloat(lat),
    lng: parseFloat(lng),
    accuracy: accuracy || 0,
    battery: battery || 0,
    networkType: networkType || 'unknown',
    timestamp: timestamp || new Date().toISOString()
  };
  
  data.locations.push(location);
  
  // Keep only last 10000 locations per device (cleanup)
  const deviceLocations = data.locations.filter(l => l.deviceId === deviceId);
  if (deviceLocations.length > 10000) {
    const toRemove = deviceLocations.slice(0, deviceLocations.length - 10000);
    data.locations = data.locations.filter(l => !toRemove.includes(l));
  }
  
  saveData();
  
  // Emit realtime update via socket
  io.emit(`location-${deviceId}`, location);
  
  res.json({ success: true, message: 'Location saved' });
});

// Get locations for a device
app.get('/api/locations/:deviceId', verifyToken, async (req, res) => {
  const { deviceId } = req.params;
  const { limit = 100, from, to } = req.query;
  
  const device = data.devices.find(d => d.deviceId === deviceId);
  if (!device || device.ownerId !== req.userId) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  
  let locations = data.locations.filter(l => l.deviceId === deviceId);
  
  // Filter by date range
  if (from) {
    locations = locations.filter(l => new Date(l.timestamp) >= new Date(from));
  }
  if (to) {
    locations = locations.filter(l => new Date(l.timestamp) <= new Date(to));
  }
  
  // Sort descending and limit
  locations = locations.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  locations = locations.slice(0, parseInt(limit));
  
  res.json({ success: true, locations: locations });
});

// Get all devices for current user
app.get('/api/devices', verifyToken, async (req, res) => {
  const userDevices = data.devices.filter(d => d.ownerId === req.userId);
  res.json({ success: true, devices: userDevices });
});

// Send remote command to phone
app.post('/api/command', verifyToken, async (req, res) => {
  const { deviceId, command, params } = req.body;
  
  const device = data.devices.find(d => d.deviceId === deviceId);
  if (!device || device.ownerId !== req.userId) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  
  const newCommand = {
    id: uuidv4(),
    deviceId: deviceId,
    command: command, // 'lock', 'unlock', 'alarm', 'wipe', 'get_location', 'take_photo'
    params: params || {},
    status: 'pending',
    createdAt: new Date().toISOString(),
    executedAt: null,
    result: null
  };
  
  data.commands.push(newCommand);
  saveData();
  
  // Emit command via socket for realtime delivery
  io.emit(`command-${deviceId}`, newCommand);
  
  res.json({ success: true, command: newCommand });
});

// Get pending commands for device (Android app inaquery hapa)
app.get('/api/commands/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  
  const pendingCommands = data.commands.filter(
    c => c.deviceId === deviceId && c.status === 'pending'
  );
  
  res.json({ success: true, commands: pendingCommands });
});

// Update command status (Android app inatuma baada ya kutekeleza)
app.put('/api/command/:commandId', async (req, res) => {
  const { commandId } = req.params;
  const { status, result } = req.body;
  
  const command = data.commands.find(c => c.id === commandId);
  if (command) {
    command.status = status;
    command.executedAt = new Date().toISOString();
    command.result = result;
    saveData();
  }
  
  res.json({ success: true });
});

// Check for app update (Android app inaangalia hapa)
app.get('/api/update/check', async (req, res) => {
  const { version, deviceId } = req.query;
  
  const LATEST_VERSION = '2.0.0';
  const UPDATE_URL = `http://${req.headers.host}/api/update/download`;
  
  if (version !== LATEST_VERSION) {
    res.json({
      success: true,
      updateAvailable: true,
      latestVersion: LATEST_VERSION,
      downloadUrl: UPDATE_URL,
      forceUpdate: true,
      changelog: [
        "Auto-update system improved",
        "Battery optimization",
        "Background service stability",
        "New remote commands"
      ]
    });
  } else {
    res.json({ success: true, updateAvailable: false });
  }
});

// Download update (Android app inapakua hapa)
app.get('/api/update/download', (req, res) => {
  // In real scenario, send actual APK file
  res.json({
    success: true,
    message: "Update endpoint ready",
    downloadUrl: "https://your-cdn.com/app-update.apk"
  });
});

// Get device statistics
app.get('/api/stats/:deviceId', verifyToken, async (req, res) => {
  const { deviceId } = req.params;
  
  const device = data.devices.find(d => d.deviceId === deviceId);
  if (!device || device.ownerId !== req.userId) {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }
  
  const deviceLocations = data.locations.filter(l => l.deviceId === deviceId);
  const lastLocation = deviceLocations[deviceLocations.length - 1];
  const today = new Date().toDateString();
  const todayLocations = deviceLocations.filter(l => new Date(l.timestamp).toDateString() === today);
  
  res.json({
    success: true,
    stats: {
      totalLocations: deviceLocations.length,
      todayLocations: todayLocations.length,
      lastSeen: device.lastSeen,
      lastLocation: lastLocation || null,
      status: device.status,
      battery: lastLocation?.battery || 'Unknown'
    }
  });
});

// ============ WEBSOCKET EVENTS ============
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('subscribe', (deviceId) => {
    socket.join(`device-${deviceId}`);
    console.log(`Client subscribed to device-${deviceId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// ============ CRON JOBS (Auto cleanup) ============
// Delete old locations every day (keep 30 days)
cron.schedule('0 2 * * *', () => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const oldCount = data.locations.filter(l => new Date(l.timestamp) < thirtyDaysAgo).length;
  data.locations = data.locations.filter(l => new Date(l.timestamp) >= thirtyDaysAgo);
  saveData();
  
  console.log(`Cleaned up ${oldCount} old locations`);
});

// ============ START SERVER ============
const PORT = process.env.PORT || 16232;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║     ZASS PHONE TRACKER SYSTEM - RUNNING                  ║
╠══════════════════════════════════════════════════════════╣
║  Server: http://0.0.0.0:${PORT}                          ║
║  API: http://0.0.0.0:${PORT}/api                        ║
║  Dashboard: http://0.0.0.0:${PORT}/dashboard.html       ║
║                                                          ║
║  Default Login: admin / admin123                         ║
║  (Change password after first login!)                    ║
╚══════════════════════════════════════════════════════════╝
  `);
});



// ============ REGISTER ENDPOINT (NEW) ============
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;
  
  // Check if user exists
  const existingUser = data.users.find(u => u.username === username);
  if (existingUser) {
    return res.status(400).json({ 
      success: false, 
      message: 'Username already exists' 
    });
  }
  
  // Create new user
  const newUser = {
    id: uuidv4(),
    username: username,
    password: bcrypt.hashSync(password, 10),
    email: email || '',
    role: 'user',
    createdAt: new Date().toISOString()
  };
  
  data.users.push(newUser);
  saveData();
  
  // Create token
  const token = jwt.sign(
    { userId: newUser.id, username: newUser.username, role: newUser.role },
    process.env.JWT_SECRET || 'zass-secret-key-2024',
    { expiresIn: '7d' }
  );
  
  res.json({
    success: true,
    token: token,
    user: { id: newUser.id, username: newUser.username, role: newUser.role },
    message: 'Registration successful!'
  });
});

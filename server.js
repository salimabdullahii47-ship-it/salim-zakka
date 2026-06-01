require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

// Ensure critical env vars are present. Provide safe fallbacks in development.
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('ERROR: JWT_SECRET is not set. Authentication will not function correctly.\nSet JWT_SECRET in your environment (on Vercel use Project Settings → Environment Variables).');
  } else {
    process.env.JWT_SECRET = 'dev_secret_change_me';
    console.warn('Warning: JWT_SECRET not set. Using a development fallback secret. Do NOT use in production.');
  }
}

// Import modules
const db = require('./db');
const auth = require('./auth');
const meetings = require('./meetings');
const recordings = require('./recordings');
const monetization = require('./monetization');
const tracking = require('./tracking');
const clinical = require('./clinical');
const i18n = require('./i18n');

const app = express();

// Middleware
app.use(cors());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// ===== AUTHENTICATION API ENDPOINTS =====
// ==========================================

app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, displayName, gender, language } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const result = await auth.registerUser(username, email, password, displayName);
  
  if (result.success) {
    const user = auth.getUserById(result.userId);
    const token = auth.generateToken(result.userId, email);
    res.json({ 
      success: true, 
      userId: result.userId,
      token,
      user,
      message: 'Registration successful'
    });
  } else {
    res.status(400).json({ error: result.error });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const result = await auth.loginUser(email, password);
  
  if (result.success) {
    res.json(result);
  } else {
    res.status(401).json({ error: result.error });
  }
});

app.get('/api/auth/user/:userId', auth.authenticateToken, (req, res) => {
  const user = auth.getUserById(req.params.userId);
  if (user) {
    res.json(user);
  } else {
    res.status(404).json({ error: 'User not found' });
  }
});

// ==========================================
// ===== USER PREFERENCES API =====
// ==========================================

app.get('/api/user/:userId/preferences', auth.authenticateToken, (req, res) => {
  const prefs = auth.getUserPreferences(req.params.userId);
  res.json(prefs || {});
});

app.post('/api/user/:userId/preferences', auth.authenticateToken, (req, res) => {
  const result = auth.updateUserPreferences(req.params.userId, req.body);
  res.json(result);
});

// ==========================================
// ===== MEETING API ENDPOINTS =====
// ==========================================

app.post('/api/meetings/create', auth.authenticateToken, (req, res) => {
  const { name, isPrivate, maxParticipants } = req.body;
  const result = meetings.createMeeting(req.userId, name, isPrivate, maxParticipants);
  res.json(result);
});

app.get('/api/meetings/:meetingId', (req, res) => {
  const meeting = meetings.getMeeting(req.params.meetingId);
  if (meeting) {
    const participants = meetings.getActiveParticipants(req.params.meetingId);
    res.json({ ...meeting, participants });
  } else {
    res.status(404).json({ error: 'Meeting not found' });
  }
});

app.get('/api/user/:userId/meetings', auth.authenticateToken, (req, res) => {
  const meetingHistory = meetings.getUserMeetingHistory(req.params.userId);
  res.json(meetingHistory);
});

// ==========================================
// ===== RECORDING API ENDPOINTS =====
// ==========================================

app.get('/api/user/:userId/recordings', auth.authenticateToken, (req, res) => {
  const userRecordings = recordings.getUserRecordings(req.params.userId);
  res.json(userRecordings);
});

app.post('/api/recordings/log', auth.authenticateToken, (req, res) => {
  const { meetingId, filePath, fileSizeMb, durationSeconds } = req.body;
  const result = recordings.saveRecording(meetingId, req.userId, filePath, fileSizeMb, durationSeconds);
  res.json(result);
});

app.get('/api/user/:userId/call-history', auth.authenticateToken, (req, res) => {
  const callHistory = recordings.getCallHistory(req.params.userId);
  res.json(callHistory);
});

// ==========================================
// ===== MONETIZATION API ENDPOINTS =====
// ==========================================

app.get('/api/pricing', (req, res) => {
  res.json(monetization.PRICING_PLANS);
});

app.get('/api/user/:userId/transactions', auth.authenticateToken, (req, res) => {
  const transactions = monetization.getUserTransactions(req.params.userId);
  res.json(transactions);
});

app.post('/api/payment/create-transaction', auth.authenticateToken, async (req, res) => {
  const { amount, type, description } = req.body;
  const result = await monetization.createTransaction(req.userId, amount, type, description);
  res.json(result);
});

// Universal conversation tracking APIs
app.post('/api/conversations/track', auth.authenticateToken, (req, res) => {
  const { roomId, topic, notes, relatedObject, metadata } = req.body;
  const result = tracking.logConversation(req.userId, roomId, topic, notes, relatedObject, metadata);
  res.json(result);
});

app.get('/api/conversations/:userId', auth.authenticateToken, (req, res) => {
  const entries = tracking.getConversationsForUser(req.params.userId);
  res.json(entries);
});

app.post('/api/clinical-tests/submit', auth.authenticateToken, (req, res) => {
  const { meetingId, testType, details } = req.body;
  const result = clinical.submitClinicalTest(req.userId, meetingId, testType, details);
  res.json(result);
});

app.get('/api/clinical-tests/:userId', auth.authenticateToken, (req, res) => {
  const tests = clinical.getClinicalTestsForUser(req.params.userId);
  res.json(tests);
});

// ==========================================
// ===== LOCALIZATION API =====
// ==========================================

app.get('/api/i18n/:language', (req, res) => {
  const translations = i18n.getAllTranslations(req.params.language);
  res.json(translations);
});

// Get active participants for a meeting (public)
app.get('/api/meetings/:meetingId/participants', (req, res) => {
  const participants = meetings.getActiveParticipants(req.params.meetingId);
  res.json({ participants });
});

// Authenticated: get current user from token
app.get('/api/auth/me', auth.authenticateToken, (req, res) => {
  const user = auth.getUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const prefs = auth.getUserPreferences(req.userId) || {};
  res.json({ user, preferences: prefs });
});

// ==========================================
// ===== PHONE CALLING API ENDPOINTS =====
// ==========================================

app.post('/api/phone/initiate-call', async (req, res) => {
  const { phoneNumber, callType, userId, displayName, roomId } = req.body;
  
  if (!phoneNumber || !callType || !userId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Validate phone number format (basic validation)
    const phoneRegex = /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
    if (!phoneRegex.test(phoneNumber)) {
      return res.status(400).json({ error: 'Invalid phone number format' });
    }

    // Log the phone call initiation
    const callId = `call-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Store call info in database or memory
    const callInfo = {
      callId,
      phoneNumber,
      callType,
      userId,
      displayName,
      roomId,
      status: 'initiated',
      createdAt: new Date().toISOString(),
      initiatedBy: displayName || 'Unknown User'
    };

    // Log to console for now (production would use Twilio API)
    console.log('📞 Phone Call Initiated:', callInfo);

    // In production, you would call Twilio API here:
    // const twilio = require('twilio');
    // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    // const call = await client.calls.create({
    //   url: `${process.env.NGROK_URL}/voice-callback`,
    //   to: phoneNumber,
    //   from: process.env.TWILIO_PHONE_NUMBER,
    //   method: 'POST'
    // });
    // callInfo.callSid = call.sid;

    // For now, send mock success response
    res.json({
      success: true,
      callId,
      message: `${callType} call initiated to ${phoneNumber}`,
      callType,
      phoneNumber
    });
  } catch (error) {
    console.error('Phone call error:', error);
    res.status(500).json({ error: 'Failed to initiate phone call' });
  }
});

app.get('/api/phone/call-history/:userId', auth.authenticateToken, (req, res) => {
  // Retrieve phone call history for user
  const callHistory = [];
  res.json({ callHistory });
});

// ==========================================
// ===== STATIC PAGES =====
// ==========================================

app.get('/user-guide', (req, res) => {
  res.sendFile(path.join(__dirname, 'user-guide.html'));
});

app.get('/terms-conditions', (req, res) => {
  res.sendFile(path.join(__dirname, 'terms-conditions.html'));
});

// ==========================================
// ===== SOCKET.IO HANDLERS =====
// ==========================================

const isVercel = !!process.env.VERCEL;
let server = null;
let io = null;

if (!isVercel) {
  server = http.createServer(app);
  io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] }
  });
  const rooms = {}; // Store room data
  const userSockets = {}; // Map userId to socketId

  io.on('connection', (socket) => {
    console.log(`✅ User connected: ${socket.id}`);

    // Join meeting room
    socket.on('join-room', (roomId, userId) => {
      // attach userId to socket for later checks
      socket.userId = userId;
      socket.join(roomId);
      userSockets[userId] = socket.id;
      
      if (!rooms[roomId]) {
        rooms[roomId] = { users: [], participants: [] }; // Added participants array initialization safely
      }

      // Fixed: Added the missing "rooms" variable reference here
      if (!rooms[roomId].participants) rooms[roomId].participants = [];
      rooms[roomId].participants.push({ userId, socketId: socket.id });
      
      // Persist participant join
      try {
        meetings.addParticipant(roomId, userId);
      } catch (err) {
        console.error('Error persisting participant:', err);
      }
      
      // Send a private welcome to the joining user with meeting info and preferences
      try {
        const meeting = meetings.getMeeting(roomId);
        const participants = meetings.getActiveParticipants(roomId);
        const user = auth.getUserById(userId) || { id: userId };
        const prefs = auth.getUserPreferences(userId) || {};

        socket.emit('welcome', {
          message: `Welcome ${user.displayName || user.username || userId} to ${meeting ? meeting.name : 'the meeting'}`,
          meeting: meeting || null,
      });
    } catch (err) {
      console.error('Error sending welcome data:', err);
    }
    
    // Broadcast user joined
    io.to(roomId).emit('user-joined', {
      userId,
      socketId: socket.id,
      participantCount: rooms[roomId].participants.length
    });

    // Emit a system chat message announcing the join
    io.to(roomId).emit('system-message', {
      type: 'join',
      text: `${auth.getUserById(userId)?.displayName || userId} joined the meeting`,
      timestamp: new Date()
    });
    
    console.log(`👤 User ${userId} joined room ${roomId}`);
  });

  // Leave meeting room
  socket.on('leave-room', (roomId, userId) => {
    socket.leave(roomId);
    
    if (rooms[roomId]) {
      rooms[roomId].participants = rooms[roomId].participants.filter(
        p => p.userId !== userId
      );
      
      // Persist participant leave
      try {
        meetings.removeParticipant(roomId, userId);
      } catch (err) {
        console.error('Error persisting participant leave:', err);
      }

      if (rooms[roomId].participants.length === 0) {
        delete rooms[roomId];
      }
    }
    
    io.to(roomId).emit('user-left', {
      userId,
      participantCount: rooms[roomId]?.participants.length || 0
    });

    // Emit a system chat message announcing the leave
    io.to(roomId).emit('system-message', {
      type: 'leave',
      text: `${auth.getUserById(userId)?.displayName || userId} left the meeting`,
      timestamp: new Date()
    });
    
    console.log(`👋 User ${userId} left room ${roomId}`);
  });

  // Handle offer/answer for peer connection
  socket.on('offer', (data) => {
    io.to(data.to).emit('offer', {
      from: socket.id,
      offer: data.offer
    });
  });

  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', {
      from: socket.id,
      answer: data.answer
    });
  });

  // ICE candidates
  socket.on('ice-candidate', (data) => {
    io.to(data.to).emit('ice-candidate', {
      from: socket.id,
      candidate: data.candidate
    });
  });

  // Chat messages
  socket.on('chat-message', (data) => {
    io.to(data.room).emit('chat-message', {
      sender: data.sender,
      text: data.text,
      timestamp: new Date()
    });
  });

  // Screen sharing started
  socket.on('screen-share-started', (roomId) => {
    io.to(roomId).emit('screen-share-started', { userId: socket.id });
  });

  socket.on('screen-share-ended', (roomId) => {
    io.to(roomId).emit('screen-share-ended', { userId: socket.id });
  });

  // Recording events
  socket.on('recording-started', (data) => {
    io.to(data.roomId).emit('recording-started', {
      userId: socket.id,
      timestamp: new Date()
    });
  });

  socket.on('recording-stopped', (data) => {
    io.to(data.roomId).emit('recording-stopped', {
      userId: socket.id,
      timestamp: new Date()
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    // Find and remove user from all rooms
    Object.keys(rooms).forEach(roomId => {
      const userIndex = rooms[roomId].participants.findIndex(p => p.socketId === socket.id);
      if (userIndex !== -1) {
        const userId = rooms[roomId].participants[userIndex].userId;
        rooms[roomId].participants.splice(userIndex, 1);
        
        // Persist participant leave on disconnect
        try {
          meetings.removeParticipant(roomId, userId);
        } catch (err) {
          console.error('Error persisting participant leave on disconnect:', err);
        }

        io.to(roomId).emit('user-left', {
          userId,
          participantCount: rooms[roomId].participants.length
        });

        io.to(roomId).emit('system-message', {
          type: 'leave',
          text: `${auth.getUserById(userId)?.displayName || userId} disconnected`,
          timestamp: new Date()
        });
      }
    });

    // Remove from userSockets mapping
    Object.keys(userSockets).forEach(userId => {
      if (userSockets[userId] === socket.id) {
        delete userSockets[userId];
      }
    });
    
    console.log(`❌ User disconnected: ${socket.id}`);
  });

  // Administrative actions from meeting owner (mute, remove, pin)
  socket.on('admin-action', async (data) => {
    // data: { roomId, action: 'mute'|'remove'|'pin', targetUserId }
    try {
      const { roomId, action, targetUserId } = data || {};
      if (!roomId || !action || !targetUserId) return;

      const meeting = meetings.getMeeting(roomId);
      if (!meeting) return socket.emit('admin-action-result', { success: false, error: 'Meeting not found' });

      // Only meeting owner can perform admin actions
      if (String(meeting.owner_id) !== String(socket.userId)) {
        return socket.emit('admin-action-result', { success: false, error: 'Not authorized' });
      }

      // Handle actions
      if (action === 'remove') {
        // Persist removal
        meetings.removeParticipant(roomId, targetUserId);
        // Kick socket if connected
        const targetSocketId = userSockets[targetUserId];
        if (targetSocketId) {
          io.to(targetSocketId).emit('admin-action', { action: 'remove', roomId });
          // force leave
          io.sockets.sockets.get(targetSocketId)?.leave(roomId);
        }
        io.to(roomId).emit('system-message', { type: 'remove', text: `${targetUserId} was removed by host`, timestamp: new Date() });
        return socket.emit('admin-action-result', { success: true });
      }

      if (action === 'mute') {
        const targetSocketId = userSockets[targetUserId];
        if (targetSocketId) {
          io.to(targetSocketId).emit('admin-action', { action: 'mute' });
        }
        io.to(roomId).emit('system-message', { type: 'mute', text: `${targetUserId} was muted by host`, timestamp: new Date() });
        return socket.emit('admin-action-result', { success: true });
      }

      if (action === 'pin') {
        io.to(roomId).emit('admin-action', { action: 'pin', targetUserId });
        return socket.emit('admin-action-result', { success: true });
      }
    } catch (err) {
      console.error('Admin action error:', err);
      socket.emit('admin-action-result', { success: false, error: err.message });
    }
  });

  // ========== NEW: SAFETY & ALERTS ==========
  socket.on('emergency-sos', (data) => {
    io.to(data.room).emit('emergency-sos', {
      userId: data.userId,
      timestamp: new Date().toISOString(),
      urgency: 'critical'
    });
    console.log('🆘 EMERGENCY SOS from:', data.userId);
  });

  socket.on('critical-danger-alert', (data) => {
    io.to(data.room).emit('critical-danger-alert', {
      userId: data.userId,
      severity: data.severity,
      description: data.description,
      timestamp: new Date().toISOString()
    });
    console.log('⚠️ Critical danger alert:', data.description);
  });

  socket.on('environmental-hazard', (data) => {
    io.to(data.room).emit('environmental-hazard', {
      userId: data.userId,
      hazardType: data.hazardType,
      severity: data.severity,
      timestamp: new Date().toISOString()
    });
    console.log('📢 Environmental hazard:', data.hazardType);
  });

  socket.on('medical-emergency', (data) => {
    io.to(data.room).emit('medical-emergency', {
      userId: data.userId,
      symptoms: data.symptoms,
      severity: data.severity,
      timestamp: new Date().toISOString()
    });
    console.log('🏥 Medical emergency reported');
  });

  // ========== NEW: PHONE CALL EVENTS ==========
  socket.on('phone-call-initiated', (data) => {
    io.to(data.room).emit('phone-call-initiated', {
      callSid: data.callSid,
      phoneNumber: data.phoneNumber,
      callType: data.callType,
      timestamp: new Date().toISOString()
    });
    console.log('📞 Phone call initiated:', data.phoneNumber);
  });

  // ========== NEW: SECTOR MODULES ==========
  socket.on('sector-enabled', (data) => {
    if (!rooms[data.room]) rooms[data.room] = { participants: [] };
    if (!rooms[data.room].sectors) rooms[data.room].sectors = [];
    rooms[data.room].sectors.push(data.sector);
    
    io.to(data.room).emit('sector-enabled', {
      sector: data.sector,
      timestamp: new Date().toISOString()
    });
    console.log(`✅ Sector enabled: ${data.sector}`);
  });

  // ========== NEW: ANALYTICS TRACKING ==========
  socket.on('activity-tracked', (data) => {
    // Track user activity for analytics
    console.log('📊 Activity tracked:', data.activityType);
  });

  // ========== NEW: ANALYTICS TRACKING ==========
  socket.on('activity-tracked', (data) => {
    // Track user activity for analytics
    console.log('📊 Activity tracked:', data.activityType);
  });

  // ========== NEW: BIOMETRIC AUTH ==========
  socket.on('biometric-auth-success', (data) => {
    socket.emit('biometric-auth-confirmed', {
      userId: data.userId,
      method: data.method,
      timestamp: new Date().toISOString()
    });
    console.log('🔐 Biometric auth successful for:', data.userId);
  });

  });
}

// ==========================================
// ===== SAFETY & ALERTS API ENDPOINTS =====
// ==========================================
// ==========================================
// API ENDPOINTS =====
// ==========================================

// 1. TRIGGER SOS ENDPOINT
app.post('/api/safety/trigger-sos', auth.authenticateToken, (req, res) => {
  const { reason, emergencyType, location } = req.body;

  // Basic validation for SOS location data
  if (!location) {
    return res.status(400).json({ success: false, error: 'Location data is required for SOS' });
  }

  const sos = {
    id: `sos-${Date.now()}`,
    userId: req.userId,
    reason: reason || 'No reason provided',
    emergencyType: emergencyType || 'general',
    location: location,
    timestamp: new Date().toISOString(),
    status: 'active'
  };

  // TODO: Save the SOS alert to your database here

  console.log('🆘 SOS triggered:', req.userId); 
  // CRITICAL FIX: Send response and close the function block
  return res.json({ success: true, sos });
});
// 2. GEOFENCE ENDPOINT
app.post('/api/safety/geofence', auth.authenticateToken, (req, res) => {
  const { latitude, longitude, radiusMeters, name } = req.body;

  // 1. Basic presence validation
  if (!latitude || !longitude || !radiusMeters || !name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Missing or empty required geofence fields' });
  }

  // 2. Strict numeric/range validation to prevent invalid coordinates
  const latNum = Number(latitude);
  const lngNum = Number(longitude);
  const radNum = Number(radiusMeters);

  if (isNaN(latNum) || latNum < -90 || latNum > 90) {
    return res.status(400).json({ error: 'Invalid latitude. Must be a number between -90 and 90' });
  }
  if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'Invalid longitude. Must be a number between -180 and 180' });
  }
  if (isNaN(radNum) || radNum <= 0) {
    return res.status(400).json({ error: 'Invalid radius. Must be a positive number' });
  }

  // 3. Safe creation of the geofence object
  const geofence = {
    id: `geo-${Date.now()}`,
    userId: req.userId,
    latitude: latNum, 
    longitude: lngNum, 
    radiusMeters: radNum, 
    name: name.trim(),
    createdAt: new Date().toISOString()
  };

  
  // TODO: Save the geofence object to your database here

  return res.status(201).json({
    message: 'Geofence created successfully',
    geofence
  });
});


// ========== ANALYTICS API ENDPOINTS =====
app.get('/api/analytics/user/:userId', auth.authenticateToken, (req, res) => {
  const analytics = {
    userId: req.params.userId,
    engagementScore: Math.floor(Math.random() * 100),
    sessionCount: Math.floor(Math.random() * 50),
    totalMinutes: Math.floor(Math.random() * 5000),
    churnRisk: 'low',
    recommendations: [
      'Increase meeting frequency',
      'Use more collaborative features',
      'Enable video for better engagement'
    ]
  };

  res.json(analytics);
});

// ========== SECTOR MODULE ENDPOINTS =====
app.post('/api/sectors/healthcare/diagnostic', auth.authenticateToken, (req, res) => {
  const { symptoms, medicalHistory, testResults } = req.body;
  const diagnosis = {
    id: `diag-${Date.now()}`,
    possibleConditions: [
      { condition: 'Condition A', probability: 0.65, confidence: 'high' },
      { condition: 'Condition B', probability: 0.25, confidence: 'medium' }
    ],
    recommendedTests: ['Blood Test', 'CT Scan'],
    severity: 'moderate',
    reviewed: false
  };

  res.json({ success: true, diagnosis });
});

app.post('/api/sectors/education/lesson-plan', auth.authenticateToken, (req, res) => {
  const { subject, gradeLevel, duration } = req.body;
  const lessonPlan = {
    id: `lp-${Date.now()}`,
    subject, gradeLevel, duration,
    sections: [
      { title: 'Introduction', duration: 5, activities: ['Engagement'] },
      { title: 'Core Instruction', duration: 20, activities: ['Explain', 'Practice'] },
      { title: 'Assessment', duration: 5, activities: ['Quiz'] }
    ],
    createdAt: new Date().toISOString()
  };

    res.json({ success: true, lessonPlan });
});

app.get('/api/sectors/finance/market-analysis', auth.authenticateToken, (req, res) => {
  const { asset } = req.query;
  const analysis = {
    asset,
    currentPrice: Math.random() * 1000,
    predictions: {
      trend: ['bullish', 'bearish', 'neutral'][Math.floor(Math.random() * 3)],
      confidence: Math.random() * 100
    }
  };

  res.json(analysis);
});

// ========== BIOMETRIC API ==========
app.post('/api/biometric/authenticate', (req, res) => {
  const { method, data } = req.body;
  
  // CRITICAL FIX: The response block now closes properly below
  return res.json({
    success: true,
    authenticated: true,
    method: method,
    timestamp: new Date().toISOString()
  });
}); 

// ==========================================
// ===== CATCH-ALL FOR FRONTEND ROUTING =====
// ==========================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

module.exports = app;

// ==========================================
// ===== SERVER START =====
// ==========================================
if (!isVercel) {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`🚀 Zakka Meet Pro running on port ${PORT}`);
    console.log(`Developer: Salim Abdullahi Zakka`);
    console.log(`Database initialized at: ${path.join(__dirname, 'zakka-meet.db')}`);
  });
}



 
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const EndUser = require('../models/EndUser');
const ProcurementUser = require('../models/ProcurementUser');
const Office = require('../models/Office');
const SystemSettings = require('../models/SystemSettings');

const router = express.Router();

// POST /api/auth/login - Login user (checks both admin and end users)
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const escapedUsername = String(username || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usernameQuery = { $regex: `^${escapedUsername}$`, $options: 'i' };

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ message: 'Please provide username and password' });
    }

    let user = null;
    let userType = null;
    let isMatch = false;

    // Try to find in User collection (admin/superadmin)
    user = await User.findOne({ username: usernameQuery });
    if (user) {
      userType = 'admin';
      isMatch = await user.comparePassword(password);
    }

    // If not found in User, try EndUser collection
    if (!user) {
      user = await EndUser.findOne({ username: usernameQuery });
      if (user) {
        userType = 'enduser';
        isMatch = await user.comparePassword(password);
      }
    }

    // If not found in EndUser, try ProcurementUser collection
    if (!user) {
      user = await ProcurementUser.findOne({ username: usernameQuery });
      if (user) {
        userType = 'procurement';
        isMatch = await user.comparePassword(password);
      }
    }

    // Check if user exists
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // If enduser or procurement user, ensure their Office exists and is active
    if (userType === 'enduser' || userType === 'procurement') {
      const officeName = String(user.office || '').trim();
      if (officeName) {
        const escaped = officeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const officeDoc = await Office.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } }).select('status');

        if (!officeDoc || officeDoc.status !== 'active') {
          return res.status(401).json({ message: 'Office has been deleted or archived. Login is not allowed.' });
        }
      }
    }

    // Check if user is active
    if ((userType === 'enduser' || userType === 'procurement') && user.status !== 'active') {
      return res.status(401).json({ message: 'Account is disabled or archived' });
    }

    // ── Schedule + Special-date check (end-users & procurement users only) ───
    if (userType === 'enduser' || userType === 'procurement') {
      try {
        const { dayKey, currentMinutes, todayFull, todayMmDd } = getPhilippineTimeInfo();

        const settings = await SystemSettings.findOne({ key: 'global' }).lean();

        // 1) Check if today matches a special date (non-recurrent exact match OR recurrent MM-DD match)
        const specialDates = settings?.specialDates ?? [];
        const specialToday = specialDates.find((sd) => {
          if (sd.section === 'non-recurrent') return sd.date === todayFull;
          const storedMmDd = sd.date.length === 10 ? sd.date.slice(5) : sd.date;
          return storedMmDd === todayMmDd;
        });

        if (specialToday) {
          // Holiday (no schedule) → block entirely
          if (!specialToday.from || !specialToday.to) {
            const label = specialToday.description || 'a holiday';
            return res.status(401).json({
              message: `Login is not allowed today (${label}). It is a non-working day.`,
            });
          }
          // Half-day / special hours → use the special date's window
          const specFromMins = parseTimeToMinutes(specialToday.from, false);
          const specToMins = parseTimeToMinutes(specialToday.to, true, specFromMins ?? 0);
          if (specFromMins !== null && specToMins !== null) {
            if (currentMinutes < specFromMins || currentMinutes >= specToMins) {
              return res.status(401).json({
                message: `Today is a special day (${specialToday.description || 'special schedule'}). Login is only allowed between ${specialToday.from} and ${specialToday.to}.`,
              });
            }
          }
        } else {
          // 2) Normal weekday schedule check
          const fallbackSched = {
            monday:    { enabled: true,  from: '08:00', to: '17:00' },
            tuesday:   { enabled: true,  from: '08:00', to: '17:00' },
            wednesday: { enabled: true,  from: '08:00', to: '17:00' },
            thursday:  { enabled: true,  from: '08:00', to: '17:00' },
            friday:    { enabled: true,  from: '08:00', to: '17:00' },
            saturday:  { enabled: false, from: '',      to: ''      },
            sunday:    { enabled: false, from: '',      to: ''      },
          };

          const sched = settings?.defaultSchedule?.[dayKey] ?? fallbackSched[dayKey];
          if (!sched || !sched.enabled) {
            return res.status(401).json({
              message: `Login is not allowed today (${dayKey}). Office is closed.`,
            });
          }

          const fromMins = parseTimeToMinutes(sched.from, false);
          const toMins = parseTimeToMinutes(sched.to, true, fromMins ?? 0);

          if (fromMins !== null && toMins !== null) {
            if (currentMinutes < fromMins || currentMinutes >= toMins) {
              return res.status(401).json({
                message: `Login is only allowed between ${sched.from} and ${sched.to}. Please try again during office hours.`,
              });
            }
          }
        }
      } catch (schedErr) {
        console.error('Schedule check error (non-blocking):', schedErr);
        // If we cannot read the schedule, allow login (fail-open for safety)
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Check password
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username,
        role: userType === 'admin' ? user.role : userType === 'procurement' ? 'procurement' : user.type
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    // Update last login
    user.updatedAt = Date.now();
    await user.save();

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        username: user.username,
        role: userType === 'admin' ? user.role : userType === 'procurement' ? 'procurement' : user.type,
        fullName: user.fullName,
        office: user.office
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

async function loadCurrentUserDoc(reqUser) {
  const role = String(reqUser?.role || '').trim().toLowerCase();
  const userId = String(reqUser?.userId || '').trim();
  if (!userId) return null;

  if (role === 'procurement') {
    return ProcurementUser.findById(userId);
  }

  if (role === 'viewer' || role === 'staff') {
    return EndUser.findById(userId);
  }

  return User.findById(userId);
}

// POST /api/auth/change-password - Change password for the logged-in user
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body || {};

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required.' });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters.' });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ message: 'New passwords do not match.' });
    }

    const user = await loadCurrentUserDoc(req.user);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isMatch = await user.comparePassword(String(currentPassword));
    if (!isMatch) {
      return res.status(401).json({ message: 'Current password is incorrect.' });
    }

    user.password = String(newPassword);
    user.updatedAt = Date.now();
    await user.save();

    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/me - Get current user (protected route example)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const userDoc = await loadCurrentUserDoc(req.user);
    if (!userDoc) {
      return res.status(404).json({ message: 'User not found' });
    }
    const userObj = userDoc.toObject ? userDoc.toObject() : userDoc;
    delete userObj.password;
    res.json({ user: userObj });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Middleware to verify JWT token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ message: 'Access denied. No token provided.' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

function getPhilippineTimeInfo() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const dayKey = String(map.weekday || '').toLowerCase();

  let hour = parseInt(map.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(map.minute, 10);

  const currentMinutes = hour * 60 + minute;
  const yyyy = map.year;
  const mm = map.month;
  const dd = map.day;
  const todayFull = `${yyyy}-${mm}-${dd}`;
  const todayMmDd = `${mm}-${dd}`;

  return { dayKey, hour, minute, currentMinutes, todayFull, todayMmDd };
}

function parseTimeToMinutes(rawStr, isEndTime = false, referenceFromMinutes = 0) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  const str = rawStr.trim().toUpperCase();
  if (!str) return null;

  const isPM = str.includes('PM');
  const isAM = str.includes('AM');
  const cleanStr = str.replace(/[^\d:]/g, '');

  const parts = cleanStr.split(':');
  if (!parts[0]) return null;
  let hours = parseInt(parts[0], 10);
  let minutes = parts.length > 1 ? parseInt(parts[1], 10) : 0;

  if (isNaN(hours)) return null;
  if (isNaN(minutes)) minutes = 0;

  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  let total = hours * 60 + minutes;

  // Handle case where user entered "5:00" or "05:00" instead of "17:00" for 5 PM
  if (isEndTime && referenceFromMinutes > 0 && total <= referenceFromMinutes && hours < 12) {
    total += 720;
  }

  return total;
}

module.exports = { router, authenticateToken };

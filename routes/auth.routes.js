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

    // If procurement user, ensure their Office is active
    if (userType === 'procurement') {
      const officeName = String(user.office || '').trim();
      if (officeName) {
        const escaped = officeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const officeDoc = await Office.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } }).select('status');

        if (!officeDoc || officeDoc.status !== 'active') {
          return res.status(401).json({ message: 'Office is archived or disabled. Login is not allowed.' });
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
        const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        // Use Philippine Standard Time (UTC+8) for schedule checks
        const now = new Date();
        const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
        const nowPH = new Date(now.getTime() + PH_OFFSET_MS);
        const dayKey = DAYS[nowPH.getUTCDay()];
        const hhmm = `${String(nowPH.getUTCHours()).padStart(2, '0')}:${String(nowPH.getUTCMinutes()).padStart(2, '0')}`;

        // "YYYY-MM-DD" of today in Philippine time
        const yyyy = nowPH.getUTCFullYear();
        const mm = String(nowPH.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(nowPH.getUTCDate()).padStart(2, '0');
        const todayFull = `${yyyy}-${mm}-${dd}`;   // e.g. "2026-03-24"
        const todayMmDd = `${mm}-${dd}`;           // e.g. "03-24"

        const settings = await SystemSettings.findOne({ key: 'global' }).lean();

        // 1) Check if today matches a special date (non-recurrent exact match OR recurrent MM-DD match)
        const specialDates = settings?.specialDates ?? [];
        const specialToday = specialDates.find((sd) => {
          if (sd.section === 'non-recurrent') return sd.date === todayFull;
          // recurrent: stored as "MM-DD"
          const storedMmDd = sd.date.length === 10 ? sd.date.slice(5) : sd.date; // handle YYYY-MM-DD too
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
          if (hhmm < specialToday.from || hhmm >= specialToday.to) {
            return res.status(401).json({
              message: `Today is a special day (${specialToday.description || 'special schedule'}). Login is only allowed between ${specialToday.from} and ${specialToday.to}.`,
            });
          }
          // Within special hours → allow login (skip normal schedule check)
        } else {
          // 2) Normal weekday schedule check
          const sched = settings?.defaultSchedule?.[dayKey];
          if (!sched || !sched.enabled) {
            return res.status(401).json({
              message: `Login is not allowed today (${dayKey}). Office is closed.`,
            });
          }
          if (hhmm < sched.from || hhmm >= sched.to) {
            return res.status(401).json({
              message: `Login is only allowed between ${sched.from} and ${sched.to}. Please try again during office hours.`,
            });
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

module.exports = { router, authenticateToken };

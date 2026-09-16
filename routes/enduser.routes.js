const express = require('express');
const EndUser = require('../models/EndUser');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

// GET /api/endusers - Get all end users
router.get('/', authenticateToken, async (req, res) => {
  try {
    const users = await EndUser.find().sort({ createdAt: -1 });
    res.json({ users });
  } catch (error) {
    console.error('Get end users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/endusers - Create new end user
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { office, firstName, middleName, lastName, username, password, type } = req.body;

    const escapedUsername = String(username || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usernameQuery = { $regex: `^${escapedUsername}$`, $options: 'i' };

    // Validate required fields
    if (!office || !firstName || !lastName || !username || !password) {
      return res.status(400).json({ message: 'Please fill out all required fields.' });
    }

    // Check if username already exists
    const existingUser = await EndUser.findOne({ username: usernameQuery });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists.' });
    }

    // Create full name
    const fullName = `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ''}`;

    // Create new user
    const newUser = new EndUser({
      office: office.trim(),
      firstName: firstName.trim(),
      middleName: middleName ? middleName.trim() : '',
      lastName: lastName.trim(),
      fullName,
      username: username.trim(),
      password,
      type: type || 'viewer',
      status: 'active'
    });

    await newUser.save();

    res.status(201).json({
      message: 'User created successfully',
      user: {
        id: newUser._id,
        office: newUser.office,
        fullName: newUser.fullName,
        username: newUser.username,
        type: newUser.type,
        status: newUser.status,
        createdAt: newUser.createdAt
      }
    });
  } catch (error) {
    console.error('Create end user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/endusers/:id/toggle-status - Toggle user status (active/archived)
router.patch('/:id/toggle-status', authenticateToken, async (req, res) => {
  try {
    const user = await EndUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.status = user.status === 'active' ? 'archived' : 'active';
    user.updatedAt = Date.now();
    await user.save();

    res.json({
      message: 'User status updated',
      user: {
        id: user._id,
        status: user.status
      }
    });
  } catch (error) {
    console.error('Toggle status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/endusers/:id/reset-password - Reset user password
router.patch('/:id/reset-password', authenticateToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const defaultPassword = newPassword || 'p@ssw0rd';

    const user = await EndUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.password = defaultPassword;
    user.updatedAt = Date.now();
    await user.save();

    res.json({
      message: 'Password reset successfully',
      defaultPassword
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/endusers/:id - Update end user details
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { office, firstName, middleName, lastName, username, type, status } = req.body;

    const user = await EndUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (typeof username === 'string' && username.trim() && username.trim() !== user.username) {
      const escapedUsername = username.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingUser = await EndUser.findOne({ username: { $regex: `^${escapedUsername}$`, $options: 'i' } });
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists.' });
      }
      user.username = username.trim();
    }

    if (typeof office === 'string' && office.trim()) {
      user.office = office.trim();
    }

    if (typeof firstName === 'string' && firstName.trim()) {
      user.firstName = firstName.trim();
    }

    if (typeof middleName === 'string') {
      user.middleName = middleName.trim();
    }

    if (typeof lastName === 'string' && lastName.trim()) {
      user.lastName = lastName.trim();
    }

    if (typeof type === 'string' && ['viewer', 'staff'].includes(type)) {
      user.type = type;
    }

    if (typeof status === 'string' && ['active', 'archived'].includes(status)) {
      user.status = status;
    }

    user.fullName = `${user.lastName}, ${user.firstName}${user.middleName ? ` ${user.middleName}` : ''}`;
    user.updatedAt = Date.now();
    await user.save();

    res.json({
      message: 'User updated successfully',
      user: {
        id: user._id,
        office: user.office,
        firstName: user.firstName,
        middleName: user.middleName,
        lastName: user.lastName,
        fullName: user.fullName,
        username: user.username,
        type: user.type,
        status: user.status,
        updatedAt: user.updatedAt,
      },
    });
  } catch (error) {
    console.error('Update end user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

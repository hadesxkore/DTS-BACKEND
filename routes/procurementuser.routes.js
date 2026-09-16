const express = require('express');
const ProcurementUser = require('../models/ProcurementUser');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

// GET /api/procurementusers?office=OFFICE - Get all procurement users (optionally filter by office)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { office } = req.query;
    const query = {};

    if (typeof office === 'string' && office.trim()) {
      query.office = office.trim();
    }

    const users = await ProcurementUser.find(query).sort({ createdAt: -1 });
    res.json({ users });
  } catch (error) {
    console.error('Get procurement users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/procurementusers - Create new procurement user
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { office, firstName, middleName, lastName, username, password, type } = req.body;

    const escapedUsername = String(username || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const usernameQuery = { $regex: `^${escapedUsername}$`, $options: 'i' };

    if (!office || !firstName || !lastName || !username || !password) {
      return res.status(400).json({ message: 'Please fill out all required fields.' });
    }

    const existingUser = await ProcurementUser.findOne({ username: usernameQuery });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists.' });
    }

    const fullName = `${lastName}, ${firstName}${middleName ? ` ${middleName}` : ''}`;

    const newUser = new ProcurementUser({
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
        firstName: newUser.firstName,
        middleName: newUser.middleName,
        lastName: newUser.lastName,
        fullName: newUser.fullName,
        username: newUser.username,
        type: newUser.type,
        status: newUser.status,
        createdAt: newUser.createdAt
      }
    });
  } catch (error) {
    console.error('Create procurement user error:', error);

    if (error && typeof error === 'object') {
      if (error.name === 'ValidationError' && error.errors) {
        const firstKey = Object.keys(error.errors)[0];
        const message = firstKey ? error.errors[firstKey].message : 'Validation error';
        return res.status(400).json({ message });
      }

      if (error.code === 11000) {
        return res.status(400).json({ message: 'Username already exists.' });
      }
    }

    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/procurementusers/:id/toggle-status - Toggle user status (active/archived)
router.patch('/:id/toggle-status', authenticateToken, async (req, res) => {
  try {
    const user = await ProcurementUser.findById(req.params.id);
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
    console.error('Toggle procurement user status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/procurementusers/:id/reset-password - Reset user password
router.patch('/:id/reset-password', authenticateToken, async (req, res) => {
  try {
    const { newPassword } = req.body;
    const defaultPassword = newPassword || 'p@ssw0rd';

    const user = await ProcurementUser.findById(req.params.id);
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
    console.error('Reset procurement user password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/procurementusers/:id - Update procurement user details
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { office, firstName, middleName, lastName, username, type, status } = req.body;

    const user = await ProcurementUser.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (typeof username === 'string' && username.trim() && username.trim() !== user.username) {
      const escapedUsername = username.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingUser = await ProcurementUser.findOne({ username: { $regex: `^${escapedUsername}$`, $options: 'i' } });
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
        updatedAt: user.updatedAt
      }
    });
  } catch (error) {
    console.error('Update procurement user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

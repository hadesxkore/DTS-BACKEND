const express = require('express');
const { authenticateToken } = require('./auth.routes');
const SystemSettings = require('../models/SystemSettings');

const router = express.Router();

/** GET /api/settings  – public */
router.get('/', async (req, res) => {
  try {
    const settings = await SystemSettings.findOne({ key: 'global' }).lean();
    res.json({
      defaultSchedule: settings?.defaultSchedule ?? {
        monday:    { enabled: true,  from: '08:00', to: '17:00' },
        tuesday:   { enabled: true,  from: '08:00', to: '17:00' },
        wednesday: { enabled: true,  from: '08:00', to: '17:00' },
        thursday:  { enabled: true,  from: '08:00', to: '17:00' },
        friday:    { enabled: true,  from: '08:00', to: '17:00' },
        saturday:  { enabled: false, from: '',      to: ''      },
        sunday:    { enabled: false, from: '',      to: ''      },
      },
      specialDates: settings?.specialDates ?? [],
    });
  } catch (err) {
    console.error('GET /api/settings error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/** GET /api/settings/schedule  – public (needed for login-page check) */
router.get('/schedule', async (req, res) => {
  try {
    const settings = await SystemSettings.findOne({ key: 'global' });
    if (!settings) {
      // Return hardcoded defaults when nothing is saved yet
      return res.json({
        defaultSchedule: {
          monday:    { enabled: true,  from: '08:00', to: '17:00' },
          tuesday:   { enabled: true,  from: '08:00', to: '17:00' },
          wednesday: { enabled: true,  from: '08:00', to: '17:00' },
          thursday:  { enabled: true,  from: '08:00', to: '17:00' },
          friday:    { enabled: true,  from: '08:00', to: '17:00' },
          saturday:  { enabled: false, from: '',      to: ''      },
          sunday:    { enabled: false, from: '',      to: ''      },
        },
      });
    }
    res.json({ defaultSchedule: settings.defaultSchedule });
  } catch (err) {
    console.error('GET /api/settings/schedule error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/** PUT /api/settings/schedule  – admin only */
router.put('/schedule', authenticateToken, async (req, res) => {
  try {
    // Only admins / superadmins may update the schedule
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const { defaultSchedule } = req.body;
    if (!defaultSchedule) {
      return res.status(400).json({ message: 'defaultSchedule is required' });
    }

    const settings = await SystemSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { defaultSchedule } },
      { upsert: true, new: true, runValidators: true }
    );

    res.json({ message: 'Schedule saved', defaultSchedule: settings.defaultSchedule });
  } catch (err) {
    console.error('PUT /api/settings/schedule error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/** GET /api/settings/special-dates  – public */
router.get('/special-dates', async (req, res) => {
  try {
    const settings = await SystemSettings.findOne({ key: 'global' }).lean();
    res.json({ specialDates: settings?.specialDates ?? [] });
  } catch (err) {
    console.error('GET /api/settings/special-dates error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

/** PUT /api/settings/special-dates  – admin only */
router.put('/special-dates', authenticateToken, async (req, res) => {
  try {
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Forbidden' });
    }
    const { specialDates } = req.body;
    if (!Array.isArray(specialDates)) {
      return res.status(400).json({ message: 'specialDates must be an array' });
    }
    const settings = await SystemSettings.findOneAndUpdate(
      { key: 'global' },
      { $set: { specialDates } },
      { upsert: true, new: true, runValidators: true }
    );
    res.json({ message: 'Special dates saved', specialDates: settings.specialDates });
  } catch (err) {
    console.error('PUT /api/settings/special-dates error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

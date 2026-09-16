const express = require('express');
const { authenticateToken } = require('./auth.routes');
const EndUser = require('../models/EndUser');
const ProcurementUser = require('../models/ProcurementUser');
const User = require('../models/User');

const router = express.Router();

function pickProfilePayload(userDoc) {
  if (!userDoc) return null;
  return {
    officeEmail: typeof userDoc.officeEmail === 'string' ? userDoc.officeEmail : '',
    contactNumber: typeof userDoc.contactNumber === 'string' ? userDoc.contactNumber : '',
    deptHead: typeof userDoc.deptHead === 'string' ? userDoc.deptHead : '',
    deptHeadDesignation: typeof userDoc.deptHeadDesignation === 'string' ? userDoc.deptHeadDesignation : '',
  };
}

async function loadCurrentUserModel(reqUser) {
  const role = String(reqUser?.role || '').trim().toLowerCase();
  const userId = String(reqUser?.userId || '').trim();
  if (!userId) return null;

  if (role === 'procurement') {
    const doc = await ProcurementUser.findById(userId);
    return doc ? { doc, kind: 'procurement' } : null;
  }

  if (role === 'viewer' || role === 'staff') {
    const doc = await EndUser.findById(userId);
    return doc ? { doc, kind: 'enduser' } : null;
  }

  // admin/superadmin/user
  const doc = await User.findById(userId);
  return doc ? { doc, kind: 'admin' } : null;
}

router.get('/', authenticateToken, async (req, res) => {
  try {
    const loaded = await loadCurrentUserModel(req.user);
    if (!loaded) return res.status(404).json({ message: 'User not found' });

    res.json({ profile: pickProfilePayload(loaded.doc) });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.patch('/', authenticateToken, async (req, res) => {
  try {
    const loaded = await loadCurrentUserModel(req.user);
    if (!loaded) return res.status(404).json({ message: 'User not found' });

    const { officeEmail, contactNumber, deptHead, deptHeadDesignation } = req.body || {};

    if (typeof officeEmail === 'string') loaded.doc.officeEmail = officeEmail.trim();
    if (typeof contactNumber === 'string') loaded.doc.contactNumber = contactNumber.trim();
    if (typeof deptHead === 'string') loaded.doc.deptHead = deptHead.trim();
    if (typeof deptHeadDesignation === 'string') loaded.doc.deptHeadDesignation = deptHeadDesignation.trim();

    loaded.doc.updatedAt = Date.now();
    await loaded.doc.save();

    res.json({ message: 'Profile updated successfully', profile: pickProfilePayload(loaded.doc) });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

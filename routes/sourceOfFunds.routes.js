const express = require('express');
const SourceOfFund = require('../models/SourceOfFund');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/source-of-funds - list source of funds
router.get('/', authenticateToken, async (req, res) => {
  try {
    const sourceOfFunds = await SourceOfFund.find({}).sort({ sourceOfFundId: 1 });
    res.json({ sourceOfFunds });
  } catch (error) {
    console.error('Get source of funds error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/source-of-funds - create source of fund
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'name is required.' });
    }

    const trimmedName = String(name).trim();
    const escaped = escapeRegex(trimmedName);
    const existing = await SourceOfFund.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } }).select('_id');
    if (existing) {
      return res.status(409).json({ message: 'Source of Fund already exists.' });
    }

    const last = await SourceOfFund.findOne({}).sort({ sourceOfFundId: -1 }).select('sourceOfFundId');
    const nextSourceOfFundId = (last && typeof last.sourceOfFundId === 'number' ? last.sourceOfFundId : 0) + 1;

    const sourceOfFund = new SourceOfFund({
      sourceOfFundId: nextSourceOfFundId,
      name: trimmedName,
      status: 'active',
    });

    await sourceOfFund.save();
    res.status(201).json({ message: 'Source of Fund created successfully', sourceOfFund });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Source of Fund already exists.' });
    }
    console.error('Create source of fund error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/source-of-funds/:sourceOfFundId - update fields
router.patch('/:sourceOfFundId', authenticateToken, async (req, res) => {
  try {
    const sourceOfFundId = Number(req.params.sourceOfFundId);
    if (!Number.isFinite(sourceOfFundId)) {
      return res.status(400).json({ message: 'Invalid sourceOfFundId' });
    }

    const { name, status } = req.body || {};
    const update = {};
    if (typeof name === 'string') update.name = name.trim();
    if (status === 'active' || status === 'archived') update.status = status;

    if (typeof update.name === 'string' && update.name) {
      const escaped = escapeRegex(update.name);
      const existing = await SourceOfFund.findOne({
        sourceOfFundId: { $ne: sourceOfFundId },
        name: { $regex: `^${escaped}$`, $options: 'i' },
      }).select('_id');
      if (existing) {
        return res.status(409).json({ message: 'Source of Fund already exists.' });
      }
    }

    const sourceOfFund = await SourceOfFund.findOneAndUpdate({ sourceOfFundId }, update, { new: true });
    if (!sourceOfFund) return res.status(404).json({ message: 'Source of Fund not found' });

    res.json({ message: 'Source of Fund updated successfully', sourceOfFund });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Source of Fund already exists.' });
    }
    console.error('Update source of fund error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/source-of-funds/:sourceOfFundId - delete
router.delete('/:sourceOfFundId', authenticateToken, async (req, res) => {
  try {
    const sourceOfFundId = Number(req.params.sourceOfFundId);
    if (!Number.isFinite(sourceOfFundId)) {
      return res.status(400).json({ message: 'Invalid sourceOfFundId' });
    }

    const deleted = await SourceOfFund.findOneAndDelete({ sourceOfFundId });
    if (!deleted) {
      return res.status(404).json({ message: 'Source of Fund not found' });
    }

    res.json({ message: 'Source of Fund deleted successfully' });
  } catch (error) {
    console.error('Delete source of fund error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

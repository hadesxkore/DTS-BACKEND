const express = require('express');
const Department = require('../models/Department');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// GET /api/departments - list departments
router.get('/', authenticateToken, async (req, res) => {
  try {
    const departments = await Department.find({}).sort({ departmentId: 1 });
    res.json({ departments });
  } catch (error) {
    console.error('Get departments error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/departments - create department
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description } = req.body || {};

    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'name is required.' });
    }

    const trimmedName = String(name).trim();
    const escaped = escapeRegex(trimmedName);
    const existing = await Department.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } }).select('_id');
    if (existing) {
      return res.status(409).json({ message: 'Department name already exists.' });
    }

    const last = await Department.findOne({}).sort({ departmentId: -1 }).select('departmentId');
    const nextDepartmentId = (last && typeof last.departmentId === 'number' ? last.departmentId : 0) + 1;

    const department = new Department({
      departmentId: nextDepartmentId,
      name: trimmedName,
      description: typeof description === 'string' ? description.trim() : '',
      status: 'active',
    });

    await department.save();
    res.status(201).json({ message: 'Department created successfully', department });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Department name already exists.' });
    }
    console.error('Create department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/departments/:departmentId - update department fields
router.patch('/:departmentId', authenticateToken, async (req, res) => {
  try {
    const departmentId = Number(req.params.departmentId);
    if (!Number.isFinite(departmentId)) {
      return res.status(400).json({ message: 'Invalid departmentId' });
    }

    const { name, description, status } = req.body || {};

    const update = {};
    if (typeof name === 'string') update.name = name.trim();
    if (typeof description === 'string') update.description = description.trim();
    if (status === 'active' || status === 'archived') update.status = status;

    if (typeof update.name === 'string' && update.name) {
      const escaped = escapeRegex(update.name);
      const existing = await Department.findOne({
        departmentId: { $ne: departmentId },
        name: { $regex: `^${escaped}$`, $options: 'i' },
      }).select('_id');
      if (existing) {
        return res.status(409).json({ message: 'Department name already exists.' });
      }
    }

    const department = await Department.findOneAndUpdate({ departmentId }, update, { new: true });
    if (!department) return res.status(404).json({ message: 'Department not found' });

    res.json({ message: 'Department updated successfully', department });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Department name already exists.' });
    }
    console.error('Update department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/departments/:departmentId - permanently delete a department
router.delete('/:departmentId', authenticateToken, async (req, res) => {
  try {
    const departmentId = Number(req.params.departmentId);
    if (!Number.isFinite(departmentId)) {
      return res.status(400).json({ message: 'Invalid departmentId' });
    }

    const deleted = await Department.findOneAndDelete({ departmentId });
    if (!deleted) {
      return res.status(404).json({ message: 'Department not found' });
    }

    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Delete department error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

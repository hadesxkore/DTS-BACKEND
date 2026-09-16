const express = require('express');
const Office = require('../models/Office');
const EndUser = require('../models/EndUser');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

// GET /api/offices - list offices
router.get('/', authenticateToken, async (req, res) => {
  try {
    let offices = await Office.find({}).sort({ officeId: 1 });

    if (!offices.length) {
      await Office.insertMany([
        {
          officeId: 1,
          name: 'PGO',
          description: 'PROVINCIAL GOVERNOR OFFICE',
          head: 'MYRNA B. ROMAN',
          headDesignation: '',
          type: 'operating',
          status: 'active',
          privileges: ['Approvals', 'All Documents', 'Reports'],
          tasks: [
            { taskId: 1, task: 'For Attachment of Barcode', duration: 'null hour(s)', status: 'archived' },
            { taskId: 2, task: 'For Signing / Approval', duration: '9 hour(s)', status: 'active' },
            { taskId: 3, task: 'For PO Signing', duration: '9 hour(s)', status: 'active' },
            { taskId: 4, task: 'For Signing of Checks & Voucher', duration: '9 hour(s)', status: 'active' },
            { taskId: 28, task: 'For Signing of Petty Cash Voucher', duration: '9 hour(s)', status: 'active' },
            { taskId: 31, task: 'Received', duration: '9 hour(s)', status: 'active' },
          ],
        },
        {
          officeId: 2,
          name: 'GSO',
          description: 'PROVINCIAL GENERAL SERVICES OFFICE',
          head: 'AILEEN C. SAGUN',
          headDesignation: '',
          type: 'operating',
          status: 'active',
          privileges: ['All Documents'],
          tasks: [],
        },
        {
          officeId: 3,
          name: 'BUDGET',
          description: 'Office of the Provincial Budget Officer',
          head: 'ALICIA R. MAGPANTAY',
          headDesignation: '',
          type: 'operating',
          status: 'active',
          privileges: ['Approvals', 'Reports'],
          tasks: [],
        },
      ]);

      offices = await Office.find({}).sort({ officeId: 1 });
    }
    res.json({ offices });
  } catch (error) {
    console.error('Get offices error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/offices - create office
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, head, headDesignation, type, email } = req.body || {};

    if (!name || !description || !head) {
      return res.status(400).json({ message: 'name, description, and head are required.' });
    }

    const last = await Office.findOne({}).sort({ officeId: -1 }).select('officeId');
    const nextOfficeId = (last && typeof last.officeId === 'number' ? last.officeId : 0) + 1;

    const office = new Office({
      officeId: nextOfficeId,
      name: String(name).trim(),
      description: String(description).trim(),
      email: typeof email === 'string' ? email.trim() : '',
      head: String(head).trim(),
      headDesignation: typeof headDesignation === 'string' ? headDesignation.trim() : '',
      type: type === 'viewing' ? 'viewing' : 'operating',
      status: 'active',
      privileges: [],
      tasks: [],
    });

    await office.save();
    res.status(201).json({ message: 'Office created successfully', office });
  } catch (error) {
    console.error('Create office error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offices/:officeId - update office fields
router.patch('/:officeId', authenticateToken, async (req, res) => {
  try {
    const officeId = Number(req.params.officeId);
    if (!Number.isFinite(officeId)) {
      return res.status(400).json({ message: 'Invalid officeId' });
    }

    const { name, description, head, headDesignation, type, status, privileges, tasks, email } = req.body || {};

    const existing = await Office.findOne({ officeId });
    if (!existing) return res.status(404).json({ message: 'Office not found' });

    const update = {};
    if (typeof name === 'string') update.name = name.trim();
    if (typeof description === 'string') update.description = description.trim();
    if (typeof email === 'string') update.email = email.trim();
    if (typeof head === 'string') update.head = head.trim();
    if (typeof headDesignation === 'string') update.headDesignation = headDesignation.trim();
    if (type === 'operating' || type === 'viewing') update.type = type;
    if (status === 'active' || status === 'archived') update.status = status;
    if (Array.isArray(privileges)) update.privileges = privileges.map((p) => String(p));
    if (Array.isArray(tasks)) {
      update.tasks = tasks
        .filter((t) => t && typeof t === 'object')
        .map((t) => ({
          taskId: Number(t.taskId),
          task: String(t.task || ''),
          duration: String(t.duration || ''),
          status: t.status === 'archived' ? 'archived' : 'active',
        }))
        .filter((t) => Number.isFinite(t.taskId) && t.task);
    }

    const office = await Office.findOneAndUpdate({ officeId }, update, { new: true });
    if (!office) return res.status(404).json({ message: 'Office not found' });

    if (typeof email === 'string') {
      const officeNameRaw = String(existing.name || '').trim();
      const escaped = officeNameRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const officeQuery = officeNameRaw ? { $regex: `^${escaped}$`, $options: 'i' } : null;
      if (officeQuery) {
        await EndUser.updateMany(
          { office: officeQuery },
          { $set: { officeEmail: String(email).trim(), updatedAt: Date.now() } }
        );
      }
    }

    res.json({ message: 'Office updated successfully', office });
  } catch (error) {
    console.error('Update office error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/offices/:officeId/tasks - add task
router.post('/:officeId/tasks', authenticateToken, async (req, res) => {
  try {
    const officeId = Number(req.params.officeId);
    if (!Number.isFinite(officeId)) {
      return res.status(400).json({ message: 'Invalid officeId' });
    }

    const { task, duration } = req.body || {};
    if (!task || !duration) {
      return res.status(400).json({ message: 'task and duration are required.' });
    }

    const office = await Office.findOne({ officeId });
    if (!office) return res.status(404).json({ message: 'Office not found' });

    const maxTaskId = (office.tasks || []).reduce((m, t) => Math.max(m, Number(t.taskId) || 0), 0);
    const nextTaskId = maxTaskId + 1;

    office.tasks.push({
      taskId: nextTaskId,
      task: String(task),
      duration: String(duration),
      status: 'active',
    });

    await office.save();
    res.status(201).json({ message: 'Task added successfully', office });
  } catch (error) {
    console.error('Add office task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/offices/:officeId/tasks/:taskId - toggle or update task
router.patch('/:officeId/tasks/:taskId', authenticateToken, async (req, res) => {
  try {
    const officeId = Number(req.params.officeId);
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(officeId) || !Number.isFinite(taskId)) {
      return res.status(400).json({ message: 'Invalid officeId/taskId' });
    }

    const { status, task, duration } = req.body || {};

    const office = await Office.findOne({ officeId });
    if (!office) return res.status(404).json({ message: 'Office not found' });

    const idx = (office.tasks || []).findIndex((t) => Number(t.taskId) === taskId);
    if (idx === -1) return res.status(404).json({ message: 'Task not found' });

    if (typeof task === 'string') office.tasks[idx].task = task;
    if (typeof duration === 'string') office.tasks[idx].duration = duration;
    if (status === 'active' || status === 'archived') office.tasks[idx].status = status;

    await office.save();
    res.json({ message: 'Task updated successfully', office });
  } catch (error) {
    console.error('Update office task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/offices/:officeId - permanently delete an office
router.delete('/:officeId', authenticateToken, async (req, res) => {
  try {
    const officeId = Number(req.params.officeId);
    if (!Number.isFinite(officeId)) {
      return res.status(400).json({ message: 'Invalid officeId' });
    }

    const deleted = await Office.findOneAndDelete({ officeId });
    if (!deleted) {
      return res.status(404).json({ message: 'Office not found' });
    }

    res.json({ message: 'Office deleted successfully' });
  } catch (error) {
    console.error('Delete office error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

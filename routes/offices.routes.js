const express = require('express');
const Office = require('../models/Office');
const EndUser = require('../models/EndUser');
const ProcurementUser = require('../models/ProcurementUser');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

const STANDARD_TRANSFER_TASKS = [
  { match: /budget/i, task: 'For PR number', duration: '1 hour' },
  { match: /budget/i, task: 'For OBR signing', duration: '1 hour' },
  { match: /budget/i, task: 'For PR / OBR signing', duration: '1 hour' },
  { match: /administrator|admin/i, task: 'For PR signing / approval', duration: '1 hour' },
  { match: /bids|bac/i, task: 'For canvassing / resolution signing', duration: '1 hour' },
  { match: /general\s*services|pgso|gso/i, task: 'For PO number', duration: '1 hour' },
  { match: /administrator|admin/i, task: 'For PO signing', duration: '1 hour' },
  { match: /general\s*services|pgso|gso/i, task: 'For supplier (signing) / inspection & delivery / voucher preparation / signing of end user', duration: '1 hour' },
  { match: /accountant|accounting/i, task: 'For voucher signing', duration: '1 hour' },
  { match: /treasurer|pto/i, task: 'For check preparation', duration: '1 hour' },
  { match: /treasurer|pto/i, task: 'For signing of checks & voucher', duration: '1 hour' },
  { match: /administrator|admin/i, task: 'For counter signing of checks', duration: '1 hour' },
  { match: /treasurer|pto/i, task: 'For check advice', duration: '1 hour' },
  { match: /treasurer|pto/i, task: 'For releasing of checks', duration: '1 hour' },
];

async function ensureStandardTransferTasks(offices) {
  let anyModified = false;
  for (const office of offices) {
    if (office.type === 'viewing') continue;
    const existingTaskNames = new Set((office.tasks || []).map(t => String(t.task || '').trim().toLowerCase()));
    const offName = `${office.name || ''} ${office.description || ''}`.toLowerCase();
    
    let maxId = (office.tasks || []).reduce((m, t) => Math.max(m, Number(t.taskId) || 0), 0);
    let officeModified = false;

    for (const std of STANDARD_TRANSFER_TASKS) {
      if (std.match.test(offName)) {
        if (!existingTaskNames.has(std.task.toLowerCase())) {
          maxId++;
          office.tasks.push({
            taskId: maxId,
            task: std.task,
            duration: std.duration,
            status: 'active',
          });
          existingTaskNames.add(std.task.toLowerCase());
          officeModified = true;
          anyModified = true;
        }
      }
    }
    if (officeModified) {
      await office.save();
    }
  }
  return anyModified;
}

// GET /api/offices - list offices
router.get('/', authenticateToken, async (req, res) => {
  try {
    let offices = await Office.find({}).sort({ officeId: 1 });
    const totalTasks = offices.reduce((sum, o) => sum + (o.tasks ? o.tasks.length : 0), 0);
    if (totalTasks === 0 && offices.length > 0) {
      await ensureStandardTransferTasks(offices);
      offices = await Office.find({}).sort({ officeId: 1 });
    }
    res.json({ offices });
  } catch (error) {
    console.error('Get offices error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/offices/seed-transfer-tasks - seed or populate standard transfer tasks across offices
router.post('/seed-transfer-tasks', authenticateToken, async (req, res) => {
  try {
    const offices = await Office.find({});
    await ensureStandardTransferTasks(offices);
    const updatedOffices = await Office.find({}).sort({ officeId: 1 });
    res.json({ message: 'Transfer tasks seeded successfully', offices: updatedOffices });
  } catch (error) {
    console.error('Seed transfer tasks error:', error);
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

// DELETE /api/offices/:officeId/tasks/:taskId - delete task
router.delete('/:officeId/tasks/:taskId', authenticateToken, async (req, res) => {
  try {
    const officeId = Number(req.params.officeId);
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(officeId) || !Number.isFinite(taskId)) {
      return res.status(400).json({ message: 'Invalid officeId/taskId' });
    }

    const office = await Office.findOne({ officeId });
    if (!office) return res.status(404).json({ message: 'Office not found' });

    const idx = (office.tasks || []).findIndex((t) => Number(t.taskId) === taskId);
    if (idx === -1) return res.status(404).json({ message: 'Task not found' });

    office.tasks.splice(idx, 1);
    await office.save();
    res.json({ message: 'Task deleted successfully', office });
  } catch (error) {
    console.error('Delete office task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/offices/:officeId - permanently delete an office & cascade delete associated user accounts
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

    // Delete all user accounts (EndUser & ProcurementUser) under this office
    const officeNameRaw = String(deleted.name || '').trim();
    if (officeNameRaw) {
      const escaped = officeNameRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const officeQuery = { $regex: `^${escaped}$`, $options: 'i' };
      await Promise.all([
        EndUser.deleteMany({ office: officeQuery }),
        ProcurementUser.deleteMany({ office: officeQuery }),
      ]);
    }

    res.json({ message: 'Office and associated user accounts deleted successfully' });
  } catch (error) {
    console.error('Delete office error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

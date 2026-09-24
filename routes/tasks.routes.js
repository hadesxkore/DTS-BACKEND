const express = require('express');
const Task = require('../models/Task');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

const DEFAULT_TASKS = [
  { task: "For PR number", duration: "1 hour" },
  { task: "For OBR signing", duration: "1 hour" },
  { task: "For PR / OBR signing", duration: "1 hour" },
  { task: "For PR signing / approval", duration: "1 hour" },
  { task: "For canvassing / resolution signing", duration: "1 hour" },
  { task: "For PO number", duration: "1 hour" },
  { task: "For PO signing", duration: "1 hour" },
  { task: "For supplier (signing) / inspection & delivery / voucher preparation / signing of end user", duration: "1 hour" },
  { task: "For voucher signing", duration: "1 hour" },
  { task: "For check preparation", duration: "1 hour" },
  { task: "For signing of checks & voucher", duration: "1 hour" },
  { task: "For counter signing of checks", duration: "1 hour" },
  { task: "For check advice", duration: "1 hour" },
  { task: "For releasing of checks", duration: "1 hour" },
];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function ensureDefaultTasks() {
  const count = await Task.countDocuments();
  if (count === 0) {
    let id = 1;
    const docs = DEFAULT_TASKS.map((t) => ({
      taskId: id++,
      task: t.task,
      duration: t.duration,
      status: 'active',
    }));
    await Task.insertMany(docs);
  }
}

// GET /api/tasks - list all tasks
router.get('/', authenticateToken, async (req, res) => {
  try {
    await ensureDefaultTasks();
    const tasks = await Task.find({}).sort({ taskId: 1 });
    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/tasks - create new task
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { task, duration } = req.body || {};
    if (!task || !String(task).trim()) {
      return res.status(400).json({ message: 'task is required.' });
    }

    const trimmedTask = String(task).trim();
    const escaped = escapeRegex(trimmedTask);
    const existing = await Task.findOne({ task: { $regex: `^${escaped}$`, $options: 'i' } }).select('_id');
    if (existing) {
      return res.status(409).json({ message: 'Task already exists.' });
    }

    const last = await Task.findOne({}).sort({ taskId: -1 }).select('taskId');
    const nextTaskId = (last && typeof last.taskId === 'number' ? last.taskId : 0) + 1;

    const newTask = new Task({
      taskId: nextTaskId,
      task: trimmedTask,
      duration: typeof duration === 'string' && duration.trim() ? duration.trim() : '1 hour',
      status: 'active',
    });

    await newTask.save();
    res.status(201).json({ message: 'Task created successfully', task: newTask });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Task already exists.' });
    }
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/tasks/:taskId - update task
router.patch('/:taskId', authenticateToken, async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: 'Invalid taskId' });
    }

    const { task, duration, status } = req.body || {};
    const update = {};
    if (typeof task === 'string') update.task = task.trim();
    if (typeof duration === 'string') update.duration = duration.trim();
    if (status === 'active' || status === 'archived') update.status = status;

    if (typeof update.task === 'string' && update.task) {
      const escaped = escapeRegex(update.task);
      const existing = await Task.findOne({
        taskId: { $ne: taskId },
        task: { $regex: `^${escaped}$`, $options: 'i' },
      }).select('_id');
      if (existing) {
        return res.status(409).json({ message: 'Task with this name already exists.' });
      }
    }

    const updatedTask = await Task.findOneAndUpdate({ taskId }, update, { new: true });
    if (!updatedTask) return res.status(404).json({ message: 'Task not found' });

    res.json({ message: 'Task updated successfully', task: updatedTask });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ message: 'Task with this name already exists.' });
    }
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/tasks/:taskId - delete task
router.delete('/:taskId', authenticateToken, async (req, res) => {
  try {
    const taskId = Number(req.params.taskId);
    if (!Number.isFinite(taskId)) {
      return res.status(400).json({ message: 'Invalid taskId' });
    }

    const deleted = await Task.findOneAndDelete({ taskId });
    if (!deleted) {
      return res.status(404).json({ message: 'Task not found' });
    }

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/tasks/seed - restore or seed default tasks
router.post('/seed', authenticateToken, async (req, res) => {
  try {
    const existing = await Task.find({});
    const existingNames = new Set(existing.map((t) => String(t.task || '').toLowerCase().trim()));
    let last = await Task.findOne({}).sort({ taskId: -1 }).select('taskId');
    let nextId = (last && typeof last.taskId === 'number' ? last.taskId : 0) + 1;

    const toInsert = [];
    for (const dt of DEFAULT_TASKS) {
      if (!existingNames.has(dt.task.toLowerCase().trim())) {
        toInsert.push({
          taskId: nextId++,
          task: dt.task,
          duration: dt.duration,
          status: 'active',
        });
      }
    }

    if (toInsert.length > 0) {
      await Task.insertMany(toInsert);
    }

    const tasks = await Task.find({}).sort({ taskId: 1 });
    res.json({ message: 'Default tasks seeded successfully', tasks });
  } catch (error) {
    console.error('Seed tasks error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

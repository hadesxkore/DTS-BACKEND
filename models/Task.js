const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    taskId: { type: Number, required: true, unique: true },
    task: { type: String, required: true, trim: true },
    duration: { type: String, default: '1 hour', trim: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

taskSchema.index({ task: 1 }, { unique: true });

module.exports = mongoose.model('Task', taskSchema);

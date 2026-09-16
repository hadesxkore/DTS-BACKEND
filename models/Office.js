const mongoose = require('mongoose');

const officeTaskSchema = new mongoose.Schema(
  {
    taskId: { type: Number, required: true },
    task: { type: String, required: true },
    duration: { type: String, default: '' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { _id: false }
);

const officeSchema = new mongoose.Schema(
  {
    officeId: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true },
    head: { type: String, required: true, trim: true },
    headDesignation: { type: String, default: '', trim: true },
    type: { type: String, enum: ['operating', 'viewing'], default: 'operating' },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    privileges: [{ type: String }],
    tasks: [officeTaskSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Office', officeSchema);

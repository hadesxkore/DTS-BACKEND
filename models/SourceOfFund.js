const mongoose = require('mongoose');

const sourceOfFundSchema = new mongoose.Schema(
  {
    sourceOfFundId: { type: Number, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

sourceOfFundSchema.index({ name: 1 }, { unique: true });

module.exports = mongoose.model('SourceOfFund', sourceOfFundSchema);

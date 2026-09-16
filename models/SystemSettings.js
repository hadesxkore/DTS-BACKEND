const mongoose = require('mongoose');

const dayScheduleSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  from: { type: String, default: '' },   // "HH:MM"
  to:   { type: String, default: '' },   // "HH:MM"
}, { _id: false });

const specialDateSchema = new mongoose.Schema({
  id:          { type: String, required: true },
  date:        { type: String, required: true }, // "MM-DD" (recurrent) or "YYYY-MM-DD" (non-recurrent)
  from:        { type: String, default: null },  // "HH:MM" or null (holiday)
  to:          { type: String, default: null },  // "HH:MM" or null (holiday)
  description: { type: String, default: '' },
  section:     { type: String, enum: ['recurrent', 'non-recurrent'], default: 'recurrent' },
}, { _id: false });

const systemSettingsSchema = new mongoose.Schema({
  // singleton key – we only ever have one document
  key: { type: String, default: 'global', unique: true },
  defaultSchedule: {
    monday:    { type: dayScheduleSchema, default: () => ({ enabled: true,  from: '08:00', to: '17:00' }) },
    tuesday:   { type: dayScheduleSchema, default: () => ({ enabled: true,  from: '08:00', to: '17:00' }) },
    wednesday: { type: dayScheduleSchema, default: () => ({ enabled: true,  from: '08:00', to: '17:00' }) },
    thursday:  { type: dayScheduleSchema, default: () => ({ enabled: true,  from: '08:00', to: '17:00' }) },
    friday:    { type: dayScheduleSchema, default: () => ({ enabled: true,  from: '08:00', to: '17:00' }) },
    saturday:  { type: dayScheduleSchema, default: () => ({ enabled: false, from: '',       to: ''      }) },
    sunday:    { type: dayScheduleSchema, default: () => ({ enabled: false, from: '',       to: ''      }) },
  },
  specialDates: { type: [specialDateSchema], default: [] },
}, { timestamps: true });

module.exports = mongoose.model('SystemSettings', systemSettingsSchema);


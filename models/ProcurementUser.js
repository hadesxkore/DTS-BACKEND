const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const procurementUserSchema = new mongoose.Schema({
  office: {
    type: String,
    required: [true, 'Office is required'],
    trim: true
  },
  officeEmail: {
    type: String,
    default: '',
    trim: true
  },
  contactNumber: {
    type: String,
    default: '',
    trim: true
  },
  deptHead: {
    type: String,
    default: '',
    trim: true
  },
  deptHeadDesignation: {
    type: String,
    default: '',
    trim: true
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  middleName: {
    type: String,
    default: '',
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  fullName: {
    type: String,
    required: true
  },
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters']
  },
  type: {
    type: String,
    enum: ['viewer', 'staff'],
    default: 'viewer'
  },
  status: {
    type: String,
    enum: ['active', 'archived'],
    default: 'active'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

procurementUserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

procurementUserSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('ProcurementUser', procurementUserSchema);

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const seedAdmin = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dts_db';
    
    // Safety check: Prevent running seed accidentally in production
    if (process.env.NODE_ENV === 'production' && !process.env.FORCE_SEED) {
      console.warn('⚠️ Seed script skipped: Running in production environment.');
      process.exit(0);
    }

    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB:', mongoUri);

    const username = process.env.ADMIN_USERNAME || 'Admin';
    const password = process.env.ADMIN_PASSWORD || 'pgoadmin';

    let user = await User.findOne({ username: { $regex: `^${username}$`, $options: 'i' } });

    if (user) {
      user.password = password;
      user.role = 'superadmin';
      user.isActive = true;
      user.updatedAt = Date.now();
      await user.save();
      console.log(`Updated existing user "${user.username}" with password "${password}" and role "superadmin".`);
    } else {
      user = new User({
        username,
        password,
        role: 'superadmin',
        isActive: true,
      });
      await user.save();
      console.log(`Created new superadmin user "${username}" with password "${password}".`);
    }

    await mongoose.disconnect();
    console.log('Done.');
  } catch (error) {
    console.error('Error seeding admin user:', error);
    process.exit(1);
  }
};

seedAdmin();

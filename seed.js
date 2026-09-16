const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('./models/User');

// Load environment variables
dotenv.config();

const seedSuperAdmin = async () => {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('MongoDB Connected:', mongoose.connection.host);

    // Check if admin already exists
    const existingAdmin = await User.findOne({ username: 'Admin' });

    if (existingAdmin) {
      console.log('Admin user already exists!');
      console.log('Username:', existingAdmin.username);
      console.log('Role:', existingAdmin.role);

      // Update password if needed
      existingAdmin.password = 'pgoadmin';
      await existingAdmin.save();
      console.log('Password updated to: pgoadmin');
    } else {
      // Create superadmin user
      const superAdmin = new User({
        username: 'Admin',
        password: 'pgoadmin',
        role: 'superadmin',
        isActive: true
      });

      await superAdmin.save();
      console.log('=================================');
      console.log('SuperAdmin created successfully!');
      console.log('=================================');
      console.log('Username: Admin');
      console.log('Password: pgoadmin');
      console.log('Role: superadmin');
      console.log('=================================');
    }

    // Close connection
    await mongoose.connection.close();
    console.log('Database connection closed.');
    process.exit(0);

  } catch (error) {
    console.error('Error seeding superadmin:', error.message);
    process.exit(1);
  }
};

// Run the seed function
seedSuperAdmin();

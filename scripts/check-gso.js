require('dotenv').config();
const mongoose = require('mongoose');
const Document = require('./models/Document');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/document-tracking')
    .then(async () => {
        const docs = await Document.find({ status: 'pending-gso' });
        docs.forEach(d => {
            const logs = Array.isArray(d.logs) ? d.logs : [];
            console.log('---');
            console.log('Tracking:', d.trackingNo, '| Status:', d.status);
            logs.forEach((l, i) => console.log(`  log[${i}]: label=${JSON.stringify(l.label)} | byOffice=${JSON.stringify(l.byOffice)} | color=${JSON.stringify(l.color)}`));
        });

        await mongoose.disconnect();
    })
    .catch(e => console.error(e));

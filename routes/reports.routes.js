const express = require('express');
const { authenticateToken } = require('./auth.routes');
const Document = require('../models/Document');
const Office = require('../models/Office');

const router = express.Router();

function parseDur(s) {
  if (!s) return 0;
  const match = s.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(day|days|hour|hours|hr|hrs|min|mins|minute|minutes|sec|secs|second|seconds)$/);
  if (!match) return 0;
  const v = parseFloat(match[1]);
  const u = match[2];
  if (u.startsWith('day')) return v * 24 * 3600000;
  if (u.startsWith('hour') || u === 'hr' || u === 'hrs') return v * 3600000;
  if (u.startsWith('min')) return v * 60000;
  return v * 1000;
}

const isMovementLog = (lbl) => {
  const l = (lbl || '').toLowerCase();
  return l.startsWith('received') ||
         l.startsWith('transferred') ||
         l.startsWith('approved') ||
         l.startsWith('completed') ||
         l.includes('returned') ||
         l.startsWith('discontinued');
};

router.get('/performance-summary', authenticateToken, async (req, res) => {
  try {
    const { from, to, office } = req.query;

    if (!from || !to) {
      return res.status(400).json({ message: 'From and To dates are required.' });
    }

    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    const officesData = await Office.find({});
    
    let targetOffices = officesData;
    if (office && office !== 'All') {
      const search = office.trim().toLowerCase();
      targetOffices = officesData.filter(o => (o.name || '').toLowerCase() === search);
    }

    // Prepare 4 weekly buckets for the 1-month summary
    const buckets = [];
    for (let i = 3; i >= 0; i--) {
      const e = new Date(toDate.getTime() - i * 7 * 24 * 3600000);
      const s = new Date(e.getTime() - 6 * 24 * 3600000);
      s.setHours(0,0,0,0);
      buckets.push({
        start: s,
        end: e,
        label: `${s.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} - ${e.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        within: 0,
        exceeded: 0,
        received: 0,
        exceededDurationMs: 0
      });
    }

    // We'll need all documents for stats
    // A document might have been received in an office between 'from' and 'to'
    const docs = await Document.find({
      'logs.createdAt': { $gte: fromDate, $lte: toDate }
    }).lean();

        const officeMap = {};
    for (const off of targetOffices) {
      const offName = (off.name || '').toUpperCase();
      const taskMap = {};
      (off.tasks || []).forEach(t => {
        taskMap[(t.task || '').trim().toLowerCase()] = parseDur(t.duration);
      });
      const officeBuckets = JSON.parse(JSON.stringify(buckets));
      officeBuckets.forEach((b, i) => {
        b.start = new Date(buckets[i].start);
        b.end = new Date(buckets[i].end);
      });
      officeMap[offName] = {
        off,
        offName,
        taskMap,
        taskStats: {},
        totalReceivedAll: 0,
        totalTransferredAll: 0,
        officeBuckets,
        exceededDocs: []
      };
    }

    // Single pass over documents O(D * L) instead of O(O * D * L * B)
    for (const doc of docs) {
      if (!Array.isArray(doc.logs)) continue;
      const logs = doc.logs;
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        const lByOffice = (log.byOffice || '').toUpperCase();
        const targetObj = officeMap[lByOffice];
        if (!targetObj) continue;

        const lbl = (log.label || '').toLowerCase();
        if (lbl.startsWith('received')) {
          const receivedAt = new Date(log.createdAt);
          let endTime = Date.now();
          let transferLog = null;
          for (let j = i + 1; j < logs.length; j++) {
            if (isMovementLog(logs[j].label)) {
              endTime = new Date(logs[j].createdAt).getTime();
              if (logs[j].label.toLowerCase().startsWith('transferred') && (logs[j].byOffice || '').toUpperCase() === targetObj.offName) {
                transferLog = logs[j];
              }
              break;
            }
          }

          let taskName = '';
          const m1 = log.label.match(/received\s*(?:for\s*)?(.*)$/i);
          if (m1?.[1]) {
            taskName = m1[1].trim();
          } else {
            const m2 = log.label.match(/\(([^)]+)\)\s*$/);
            if (m2?.[1]) taskName = m2[1].trim();
          }
          if (!taskName) taskName = 'General';

          const allowedDur = targetObj.taskMap[taskName.toLowerCase()] || 0;
          const actualDur = endTime - receivedAt.getTime();
          const isExceeded = allowedDur > 0 && actualDur > allowedDur;
          const excDurMs = isExceeded ? (actualDur - allowedDur) : 0;

          if (receivedAt >= fromDate && receivedAt <= toDate) {
            targetObj.totalReceivedAll++;
            if (transferLog) targetObj.totalTransferredAll++;

            if (!targetObj.taskStats[taskName]) {
              targetObj.taskStats[taskName] = { received: 0, exceeded: 0, within: 0, exceededMs: 0 };
            }
            targetObj.taskStats[taskName].received++;
            if (isExceeded) {
              targetObj.taskStats[taskName].exceeded++;
              targetObj.taskStats[taskName].exceededMs += excDurMs;
              targetObj.exceededDocs.push({
                dateReceived: receivedAt.toISOString().split('T')[0],
                dateTransferred: transferLog ? new Date(transferLog.createdAt).toISOString().split('T')[0] : '',
                trackingNumber: doc.trackingNo,
                description: doc.purpose || '',
                transaction: 'Ongoing',
                exceededDurationHrs: (excDurMs / 3600000).toFixed(2)
              });
            } else {
              targetObj.taskStats[taskName].within++;
            }
          }

          for (const b of targetObj.officeBuckets) {
            if (receivedAt >= b.start && receivedAt <= b.end) {
              b.received++;
              if (isExceeded) {
                b.exceeded++;
                b.exceededDurationMs += excDurMs;
              } else {
                b.within++;
              }
            }
          }
        }
      }
    }

    const reports = Object.values(officeMap).map(targetObj => {
      const tasksArray = Object.keys(targetObj.taskStats).map(tName => {
        const s = targetObj.taskStats[tName];
        return {
          taskName: tName,
          totalReceived: s.received,
          completedWithinSLA: s.within,
          completedExceededSLA: s.exceeded,
          totalExceededMs: s.exceededMs
        };
      });

      return {
        officeName: targetObj.offName,
        totalReceived: targetObj.totalReceivedAll,
        totalTransferred: targetObj.totalTransferredAll,
        exceededDocumentsCount: targetObj.exceededDocs.length,
        exceededDocuments: targetObj.exceededDocs,
        tasks: tasksArray,
        monthlyBuckets: targetObj.officeBuckets.map(b => ({
          label: b.label,
          received: b.received,
          within: b.within,
          exceeded: b.exceeded,
          exceededDurationHrs: (b.exceededDurationMs / 3600000).toFixed(2)
        }))
      };
    });

    res.json({ reports });
  } catch (err) {
    console.error('Performance Summary Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/end-user-summary', authenticateToken, async (req, res) => {
  try {
    const { from, to, office } = req.query;
    
    // Build query for documents
    let query = {};
    
    // Filter by date range if provided
    if (from && to) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      
      query['createdAt'] = { $gte: fromDate, $lte: toDate };
    }
    
    // Get documents based on query
    const docs = await Document.find(query).lean();
    
    // Get all offices to ensure we show all of them
    const offices = await Office.find({}).lean();
    
    // Helper function to infer current location from logs
    const inferCurrentLocation = (statusRaw, officeRaw, logs) => {
      const s = String(statusRaw || '').trim().toLowerCase();
      if (s === 'in-budget') return 'BUDGET';
      if (s === 'in-pto') return 'PTO';
      if (s === 'pending-bac' || s.includes('bac')) return 'BAC';
      if (s === 'pending-gso' || s.includes('gso')) return 'GSO';
      if (s === 'ready-transfer') return 'PROCUREMENT';
      if (s === 'returned') return 'RETURNED';
      if (s === 'completed' || s === 'approved') return 'COMPLETED';

      // Scan logs for last "Transferred to OFFICE" entry
      const rawLogs = Array.isArray(logs) ? logs : [];
      const prefix = 'transferred to';
      for (let i = rawLogs.length - 1; i >= 0; i--) {
        const label = String(rawLogs[i]?.label || '').trim().toLowerCase();
        if (label.startsWith(prefix)) {
          const after = label.slice(prefix.length).trim();
          const match = after.match(/^([^(:]+)/);
          const dest = String(match ? match[1] : after).trim().toUpperCase();
          if (dest) return dest;
        }
        // Legacy: "Approved: Transferred to OFFICE (...)"
        const legacy = label.match(/approved[:\s]+transferred\s+to\s+([^(:]+)/i);
        if (legacy) {
          const dest = String(legacy[1]).trim().toUpperCase();
          if (dest) return dest;
        }
      }

      // Final fallback: the requestor's office
      return String(officeRaw || '').toUpperCase();
    };
    
    // Initialize summary per office
    const officeSummary = {};
    
    offices.forEach(officeDoc => {
      const officeName = officeDoc.name || 'Unknown';
      officeSummary[officeName] = {
        office: officeName,
        validation: 0,
        ongoing: 0,
        returnedInTransit: 0,
        returnedReceived: 0,
        discontinuedOverall: 0,
        completedOverall: 0,
        documents: []
      };
    });
    
    // Filter out pre-validation documents without transfer logs
    const prevalidationStatuses = new Set([
      'pending',
      'pending-gso',
      'pending-bac',
      'ready-transfer',
      'for-validation',
      'pre-validation',
      'for-revision',
    ]);

    const hasTransferredLog = (doc) => {
      const logs = Array.isArray(doc?.logs) ? doc.logs : [];
      return logs.some((l) => String(l?.label || '').trim().toLowerCase().includes('transferred to'));
    };

    // Process each document
    docs.forEach(doc => {
      const status = (doc.status || '').toLowerCase();
      
      // Skip pre-validation documents without transfer logs
      if (prevalidationStatuses.has(status) && !hasTransferredLog(doc)) {
        return;
      }
      
      const requestorOffice = doc.office || 'Unknown'; // This is the requestor's office
      
      // Initialize office if not exists
      if (!officeSummary[requestorOffice]) {
        officeSummary[requestorOffice] = {
          office: requestorOffice,
          validation: 0,
          ongoing: 0,
          returnedInTransit: 0,
          returnedReceived: 0,
          discontinuedOverall: 0,
          completedOverall: 0,
          documents: []
        };
      }
      
      const summary = officeSummary[requestorOffice];
      
      // Get current location from logs
      const currentLocation = inferCurrentLocation(doc.status, doc.office, doc.logs);
      const isWithRequestor = currentLocation === requestorOffice.toUpperCase();
      
      // Add document details
      const docInfo = {
        trackingNo: doc.trackingNo || '',
        prNo: doc.prNo || '',
        obrNo: doc.obrNo || '',
        purpose: doc.purpose || '',
        fund: doc.fund || '',
        amount: doc.amount || '',
        status: doc.status || '',
        currentLocation: currentLocation,
        isWithRequestor: isWithRequestor,
        dateCreated: doc.createdAt
      };
      
      summary.documents.push(docInfo);
      
      // Count by status
      if (status === 'pre-validation' || status === 'validation' || status === 'for-validation') {
        summary.validation++;
      } else if (status === 'ongoing' || status === 'in-progress' || status === 'pending' || status === 'approved' || status === 'in-budget' || status === 'in-pto' || status === 'pending-bac' || status === 'pending-gso' || status === 'ready-transfer') {
        summary.ongoing++;
      } else if (status === 'returned') {
        // Check if document is still in transit or received back
        const isBackToRequestor = currentLocation === requestorOffice.toUpperCase();
        if (isBackToRequestor) {
          summary.returnedReceived++;
        } else {
          summary.returnedInTransit++;
        }
      } else if (status === 'discontinued' || status === 'cancelled' || status === 'canceled') {
        summary.discontinuedOverall++;
      } else if (status === 'completed') {
        summary.completedOverall++;
      }
    });
    
    // Convert to array and filter by office if specified
    let summaryArray = Object.values(officeSummary);
    
    if (office && office !== 'All') {
      summaryArray = summaryArray.filter(s => 
        s.office.toUpperCase() === office.toUpperCase()
      );
    }
    
    // Sort by office name
    summaryArray.sort((a, b) => a.office.localeCompare(b.office));
    
    res.json({ summary: summaryArray });
  } catch (err) {
    console.error('End User Summary Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/requests', authenticateToken, async (req, res) => {
  try {
    const { type, currentLocation, sourceOfFund, status, limit, orderBy, requestor, from, to } = req.query;

    // Build query
    let query = {};
    
    // Filter by date range if provided
    if (from && to) {
      const fromDate = new Date(from);
      fromDate.setHours(0, 0, 0, 0);
      const toDate = new Date(to);
      toDate.setHours(23, 59, 59, 999);
      
      query['createdAt'] = { $gte: fromDate, $lte: toDate };
    }

    // Get documents based on query
    let docs = await Document.find(query).lean();

    // Filter by type (PR/OBR)
    if (type && type !== 'All') {
      const typeLower = type.toLowerCase();
      if (typeLower === 'regular') {
        docs = docs.filter(doc => doc.prEnabled !== false && doc.obrEnabled !== false);
      } else if (typeLower === 'for bidding') {
        docs = docs.filter(doc => doc.prEnabled !== false);
      } else if (typeLower === 'canvass') {
        docs = docs.filter(doc => doc.obrEnabled !== false);
      }
    }

    // Helper function to infer current location
    const inferCurrentLocation = (statusRaw, officeRaw, logs) => {
      const s = String(statusRaw || '').trim().toLowerCase();
      if (s === 'in-budget') return 'BUDGET';
      if (s === 'in-pto') return 'PTO';
      if (s === 'pending-bac' || s.includes('bac')) return 'BAC';
      if (s === 'pending-gso' || s.includes('gso')) return 'GSO';
      if (s === 'ready-transfer') return 'PROCUREMENT';
      if (s === 'returned') return 'RETURNED';
      if (s === 'completed' || s === 'approved') return 'COMPLETED';

      const rawLogs = Array.isArray(logs) ? logs : [];
      const prefix = 'transferred to';
      for (let i = rawLogs.length - 1; i >= 0; i--) {
        const label = String(rawLogs[i]?.label || '').trim().toLowerCase();
        if (label.startsWith(prefix)) {
          const after = label.slice(prefix.length).trim();
          const match = after.match(/^([^(:]+)/);
          const dest = String(match ? match[1] : after).trim().toUpperCase();
          if (dest) return dest;
        }
      }
      return String(officeRaw || '').toUpperCase();
    };

    // Filter by current location
    if (currentLocation && currentLocation !== 'All') {
      docs = docs.filter(doc => {
        const location = inferCurrentLocation(doc.status, doc.office, doc.logs);
        return location === currentLocation.toUpperCase();
      });
    }

    // Filter by source of fund
    if (sourceOfFund && sourceOfFund !== 'All') {
      docs = docs.filter(doc => {
        const fund = String(doc.fund || '').trim().toLowerCase();
        const filterFund = sourceOfFund.toLowerCase();
        return fund === filterFund || fund.includes(filterFund);
      });
    }

    // Filter by status
    if (status && status !== 'All') {
      const statusLower = status.toLowerCase();
      docs = docs.filter(doc => {
        const docStatus = String(doc.status || '').toLowerCase();
        if (statusLower === 'ongoing') {
          return docStatus === 'ongoing' || docStatus === 'in-progress' || docStatus === 'pending' || 
                 docStatus === 'approved' || docStatus === 'in-budget' || docStatus === 'in-pto' ||
                 docStatus === 'pending-bac' || docStatus === 'pending-gso' || docStatus === 'ready-transfer';
        }
        if (statusLower === 'complete') return docStatus === 'completed';
        if (statusLower === 'discontinued') return docStatus === 'discontinued' || docStatus === 'cancelled';
        if (statusLower === 'on hold') return docStatus === 'on-hold' || docStatus === 'for-revision';
        return true;
      });
    }

    // Filter by requestor
    if (requestor && requestor !== 'All') {
      docs = docs.filter(doc => {
        const docOffice = String(doc.office || '').trim().toUpperCase();
        return docOffice === requestor.toUpperCase();
      });
    }

    // Sort
    const sortOrder = orderBy === 'Descending Order' ? -1 : 1;
    docs.sort((a, b) => {
      const aTime = new Date(a.createdAt || 0).getTime();
      const bTime = new Date(b.createdAt || 0).getTime();
      return sortOrder * (aTime - bTime);
    });

    // Apply limit
    const limitNum = parseInt(limit) || 0;
    if (limitNum > 0) {
      docs = docs.slice(0, limitNum);
    }

    // Transform to report format
    const requests = docs.map(doc => {
      const location = inferCurrentLocation(doc.status, doc.office, doc.logs);
      
      return {
        referenceId: doc._id,
        trackingNumber: doc.trackingNo || '',
        currentLocation: location,
        prNumber: doc.prNo || '',
        obrNumber: doc.obrNo || '',
        description: doc.purpose || '',
        requestor: doc.office || '',
        sourceOfFund: doc.fund || '',
        amount: doc.amount || '',
        status: doc.status || '',
        dateRequested: doc.createdAt || ''
      };
    });

    res.json({ requests });
  } catch (err) {
    console.error('Requests Report Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/transaction', authenticateToken, async (req, res) => {
  try {
    const { trackingNo, from, to, office, transaction, processedBy, limit, orderBy } = req.query;

    if (!from || !to) {
      return res.status(400).json({ message: 'From and To dates are required.' });
    }

    const fromDate = new Date(from);
    fromDate.setHours(0, 0, 0, 0);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Build query
    const query = {
      'logs.createdAt': { $gte: fromDate, $lte: toDate }
    };

    // Filter by tracking number
    if (trackingNo && trackingNo !== 'All') {
      query.trackingNo = trackingNo;
    }

    // Fetch documents
    let docs = await Document.find(query).lean();

    // Filter by office
    if (office && office !== 'All') {
      docs = docs.filter(doc => {
        return doc.logs?.some(log => 
          (log.byOffice || '').toUpperCase() === office.toUpperCase()
        );
      });
    }

    // Filter by transaction status
    if (transaction && transaction !== 'All') {
      const txLower = transaction.toLowerCase();
      docs = docs.filter(doc => {
        const status = (doc.status || '').toLowerCase();
        if (txLower === 'ongoing') return status === 'ongoing' || status === 'in-progress';
        if (txLower === 'completed') return status === 'completed';
        if (txLower === 'returned') return status === 'returned';
        return true;
      });
    }

    // Filter by processed by (role)
    if (processedBy && processedBy !== 'All') {
      const pbLower = processedBy.toLowerCase();
      docs = docs.filter(doc => {
        return doc.logs?.some(log => {
          const byRole = (log.byRole || '').toLowerCase();
          if (pbLower === 'system admin') return byRole === 'admin';
          if (pbLower === 'procurement') return byRole === 'procurement';
          if (pbLower === 'end user') return byRole === 'end-user' || byRole === 'enduser';
          return true;
        });
      });
    }

    // Sort
    const sortOrder = orderBy === 'Descending Order' ? -1 : 1;
    docs.sort((a, b) => {
      const aTime = a.logs?.[0]?.createdAt || 0;
      const bTime = b.logs?.[0]?.createdAt || 0;
      return sortOrder * (new Date(aTime) - new Date(bTime));
    });

    // Apply limit
    const limitNum = parseInt(limit) || 0;
    if (limitNum > 0) {
      docs = docs.slice(0, limitNum);
    }

    // Transform to report format
    const transactions = docs.map(doc => {
      const firstLog = doc.logs?.[0] || {};
      const lastLog = doc.logs?.[doc.logs.length - 1] || {};
      
      return {
        referenceId: doc._id,
        trackingNumber: doc.trackingNo || '',
        prNumber: doc.prNo || '',
        obrNumber: doc.obrNo || '',
        description: doc.purpose || '',
        remarks: doc.remarks || '',
        officeName: doc.office || '', // Requestor's office (who created the PR)
        createdBy: doc.createdBy || '', // User who created the document
        timestamp: lastLog.createdAt || '',
        processedBy: lastLog.byUser || '',
        transaction: lastLog.label || ''
      };
    });

    res.json({ transactions });
  } catch (err) {
    console.error('Transaction Report Error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

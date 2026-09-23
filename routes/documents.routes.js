const express = require('express');
const mongoose = require('mongoose');
const Document = require('../models/Document');
const Office = require('../models/Office');
const User = require('../models/User');
const EndUser = require('../models/EndUser');
const ProcurementUser = require('../models/ProcurementUser');
const { authenticateToken } = require('./auth.routes');

const router = express.Router();

// GET /api/documents/stats - Dashboard statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const offices = await Office.find({});
    const transferTasksByOffice = {};
    offices.forEach(o => {
      const name = String(o.name || '').toUpperCase();
      transferTasksByOffice[name] = Array.isArray(o.tasks) ? o.tasks : [];
    });

    const documents = await Document.find({}).select('status office logs').lean();

    let ongoing = 0;
    let accomplished = 0;
    let discontinued = 0;
    let exceeded = 0;

    const officeStats = {};

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

    const prevalidationStatuses = new Set([
      'pending',
      'pending-gso',
      'pending-bac',
      'ready-transfer',
      'for-validation',
      'pre-validation',
      'for-revision',
    ]);

    function hasTransferredLog(doc) {
      if (!Array.isArray(doc.logs)) return false;
      return doc.logs.some(l => String(l?.label || '').toLowerCase().includes('transferred to'));
    }

    documents.forEach((doc) => {
      const status = String(doc.status || '').toLowerCase();

      // Skip draft/pre-validation documents from dashboard stats
      if (prevalidationStatuses.has(status) && !hasTransferredLog(doc)) {
        return;
      }

      const office = String(doc.office || 'Unknown').trim();

      const isCompleted = status === 'completed' || status === 'accomplished';
      const isDiscontinued = status === 'discontinued' || status === 'cancelled' || status === 'closed';

      if (!officeStats[office]) {
        officeStats[office] = {
          inTransit: 0,
          onProcess: 0,
          ongoing: 0,
          accomplished: 0,
          discontinued: 0,
          exceeded: 0
        };
      }

      if (isCompleted) {
        accomplished++;
        officeStats[office].accomplished++;
      } else if (isDiscontinued) {
        discontinued++;
        officeStats[office].discontinued++;
      } else {
        ongoing++;
        officeStats[office].ongoing++;

        if (status.includes('transfer') || status.includes('return')) {
          officeStats[office].inTransit++;
        } else {
          officeStats[office].onProcess++;
        }

        // Deadline check
        const logs = Array.isArray(doc.logs) ? [...doc.logs].reverse() : [];
        const latestMovementLog = logs.find(l => {
          const lbl = String(l?.label || '').toLowerCase();
          return lbl.startsWith('received') ||
            lbl.startsWith('transferred') ||
            lbl.startsWith('approved') ||
            lbl.startsWith('completed') ||
            lbl.includes('returned') ||
            lbl.startsWith('discontinued');
        });

        if (latestMovementLog && String(latestMovementLog.label || '').toLowerCase().startsWith('received')) {
          const off = String(latestMovementLog.byOffice || '').toUpperCase();
          const lbl = String(latestMovementLog.label || '');
          const taskName = (() => {
            const m1 = lbl.match(/received\s*(?:for\s*)?(.*)$/i);
            if (m1?.[1]) return m1[1].trim();
            const m2 = lbl.match(/\(([^)]+)\)\s*$/);
            return m2?.[1] ? m2[1].trim() : '';
          })();

          if (off && taskName) {
            const task = (transferTasksByOffice[off] || []).find(t => String(t?.task || '').trim() === taskName);
            if (task?.duration) {
              const ms = parseDur(task.duration);
              const start = new Date(latestMovementLog.createdAt).getTime();
              if (ms > 0 && Number.isFinite(start)) {
                if (Date.now() > (start + ms)) {
                  exceeded++;
                  officeStats[office].exceeded++;
                }
              }
            }
          }
        }
      }
    });

    const officeSummary = Object.entries(officeStats).map(([name, stats]) => ({
      name,
      inTransit: stats.inTransit,
      onProcess: stats.onProcess,
      ongoing: stats.ongoing,
      accomplished: stats.accomplished,
      discontinued: stats.discontinued,
      exceeded: stats.exceeded,
    })).sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      ongoing,
      accomplished,
      discontinued,
      exceeded,
      officeSummary,
    });
  } catch (error) {
    console.error('Get stats error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

async function loadCurrentUserOffice(reqUser) {
  const role = String(reqUser?.role || '').trim().toLowerCase();
  const userId = String(reqUser?.userId || '').trim();
  if (!userId) return '';

  if (role === 'procurement') {
    const doc = await ProcurementUser.findById(userId).select('office');
    return doc?.office ? String(doc.office).trim() : '';
  }

  if (role === 'viewer' || role === 'staff') {
    const doc = await EndUser.findById(userId).select('office');
    return doc?.office ? String(doc.office).trim() : '';
  }

  const doc = await User.findById(userId).select('office role');
  return doc?.office ? String(doc.office).trim() : '';
}

async function loadOfficePrivilegesByOfficeName(officeName) {
  const name = String(officeName || '').trim();
  if (!name) return [];

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const office = await Office.findOne({ name: { $regex: `^${escaped}$`, $options: 'i' } }).select('privileges');
  return Array.isArray(office?.privileges) ? office.privileges.map((p) => String(p).trim()) : [];
}

function hasPrivilege(privileges, requiredPrivilege) {
  const req = String(requiredPrivilege || '').trim().toLowerCase();
  if (!req) return true;
  const set = new Set(
    (Array.isArray(privileges) ? privileges : []).map((p) => String(p).trim().toLowerCase())
  );
  return set.has(req);
}

function inferStatusFromLogs(doc) {
  const logs = Array.isArray(doc?.logs) ? doc.logs : [];
  const transferPrefix = 'transferred to';

  for (let i = logs.length - 1; i >= 0; i -= 1) {
    const labelLower = String(logs[i]?.label || '').trim().toLowerCase();
    if (!labelLower) continue;
    if (!labelLower.startsWith(transferPrefix)) continue;

    const afterPrefix = labelLower.slice(transferPrefix.length).trim();
    const officeMatch = afterPrefix.match(/^([^(:]+)/);
    const office = String(officeMatch ? officeMatch[1] : afterPrefix)
      .trim()
      .toUpperCase();

    if (!office) continue;
    if (office === 'GSO') return 'pending-gso';
    if (office === 'BAC') return 'pending-bac';
    if (office === 'BUDGET') return 'in-budget';
    if (office === 'PTO') return 'in-pto';
    if (office.includes('END USER')) return 'returned';
  }

  const current = String(doc?.status || '').trim();
  return current || 'pending-gso';
}

// GET /api/documents - List documents (optionally filter by status)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, createdBy, office } = req.query;
    const query = {};

    if (typeof status === 'string' && status.trim()) {
      query.status = status.trim();
    }

    if (typeof createdBy === 'string' && createdBy.trim()) {
      query.createdBy = createdBy.trim();
    }

    if (typeof office === 'string' && office.trim()) {
      const escaped = office.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.office = { $regex: `^${escaped}$`, $options: 'i' };
    }

    const docs = await Document.find(query).sort({ createdAt: -1 });
    res.json({ documents: docs });
  } catch (error) {
    console.error('Get documents error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/documents/:id - Get single document by ID or tracking number
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    let doc = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      doc = await Document.findById(id);
    }
    if (!doc) {
      doc = await Document.findOne({ trackingNo: String(id).trim() });
    }
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }
    res.json({ document: doc });
  } catch (error) {
    console.error('Get single document error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/documents - Create document
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      trackingNo,
      createdBy,
      office,
      fund,
      section,
      fpp,
      department,
      contactNumber,
      responsibilityCenter,
      accountCode,
      obrParticulars,
      email,
      requestedByName,
      requestedByDesignation,
      cashAvailabilityName,
      cashAvailabilityDesignation,
      approvedByName,
      approvedByDesignation,
      certifiedAName,
      certifiedAPosition,
      certifiedBName,
      certifiedBPosition,
      prItems,
      purpose,
      notes,
      amount,
      driveLink,
      prEnabled,
      obrEnabled,
      prNo,
      obrNo,
      status,
    } = req.body;

    if (!trackingNo || !createdBy || !purpose) {
      return res.status(400).json({ message: 'trackingNo, createdBy, and purpose are required.' });
    }

    const existing = await Document.findOne({ trackingNo: String(trackingNo).trim() });
    if (existing) {
      return res.status(400).json({ message: 'Tracking number already exists.' });
    }

    let author = String(createdBy || '').trim();
    if (!author || author.toLowerCase() === 'admin') {
      author = 'System Administrator';
    }

    const finalOffice = typeof office === 'string' && office.trim() ? office.trim() : (typeof department === 'string' ? department.trim() : '');
    const finalDepartment = typeof department === 'string' && department.trim() ? department.trim() : (typeof office === 'string' ? office.trim() : '');

    const doc = new Document({
      trackingNo: String(trackingNo).trim(),
      createdBy: author,
      office: finalOffice,
      fund: typeof fund === 'string' ? fund.trim() : '',
      section: typeof section === 'string' && section.trim() ? section.trim() : 'N/A',
      fpp: typeof fpp === 'string' ? fpp.trim() : '',
      department: finalDepartment,
      contactNumber: typeof contactNumber === 'string' && contactNumber.trim().toLowerCase() === 'admin' ? 'System Administrator' : (typeof contactNumber === 'string' ? contactNumber.trim() : author),
      responsibilityCenter: typeof responsibilityCenter === 'string' ? responsibilityCenter.trim() : '',
      accountCode: typeof accountCode === 'string' ? accountCode.trim() : '',
      email: typeof email === 'string' ? email.trim() : '',
      requestedByName: typeof requestedByName === 'string' ? requestedByName.trim() : '',
      requestedByDesignation: typeof requestedByDesignation === 'string' ? requestedByDesignation.trim() : '',
      cashAvailabilityName:
        typeof cashAvailabilityName === 'string' && cashAvailabilityName.trim()
          ? cashAvailabilityName.trim()
          : 'ALICIA R. MAGPANTAY',
      cashAvailabilityDesignation:
        typeof cashAvailabilityDesignation === 'string' && cashAvailabilityDesignation.trim()
          ? cashAvailabilityDesignation.trim()
          : 'Provincial Treasurer',
      approvedByName:
        typeof approvedByName === 'string' && approvedByName.trim()
          ? approvedByName.trim()
          : 'JOSE ENRIQUE S. GARCIA III',
      approvedByDesignation:
        typeof approvedByDesignation === 'string' && approvedByDesignation.trim()
          ? approvedByDesignation.trim()
          : 'Provincial Governor',
      certifiedAName: typeof certifiedAName === 'string' ? certifiedAName.trim() : '',
      certifiedAPosition: typeof certifiedAPosition === 'string' ? certifiedAPosition.trim() : '',
      certifiedBName:
        typeof certifiedBName === 'string' && certifiedBName.trim()
          ? certifiedBName.trim()
          : 'EDUARDO D. BANZON',
      certifiedBPosition:
        typeof certifiedBPosition === 'string' && certifiedBPosition.trim()
          ? certifiedBPosition.trim()
          : 'Provincial Budget Officer',
      prItems: Array.isArray(prItems) ? prItems : [],
      purpose: String(purpose).trim(),
      notes: typeof notes === 'string' ? notes : '',
      amount: typeof amount === 'string' ? amount.trim() : String(amount || '').trim(),
      driveLink: typeof driveLink === 'string' && driveLink.trim() ? driveLink.trim() : 'N/A',
      prEnabled: typeof prEnabled === 'boolean' ? prEnabled : true,
      obrEnabled: typeof obrEnabled === 'boolean' ? obrEnabled : true,
      prNo: typeof prNo === 'string' ? prNo.trim() : String(prNo || '').trim(),
      obrNo: typeof obrNo === 'string' ? obrNo.trim() : String(obrNo || '').trim(),
      status: typeof status === 'string' && status.trim() ? status.trim() : 'pending-gso',
      logs: [{ label: 'Submitted', color: 'bg-sky-500', byOffice: '', byUser: String(createdBy).trim() }],
      updatedAt: Date.now(),
    });

    await doc.save();

    // Emit real-time event for new document (single broadcast to prevent duplicate client triggers)
    if (global.io) {
      global.io.emit('document:created', { document: doc });

      // Targeted notification to GSO / Reviewers that a new document was submitted (For Review)
      const trackingNo = String(doc.trackingNo || '').trim();
      const docCreatedBy = String(doc.createdBy || '').trim();
      const docOffice = String(doc.office || '').trim();
      const purpose = String(doc.purpose || '').trim();

      const notifTitle = `📄 For Review: #${trackingNo}`;
      const notifMessage = `New request submitted by ${docCreatedBy}${docOffice ? ` (${docOffice})` : ''}${purpose ? ` • ${purpose}` : ''}`;

      const forReviewPayload = {
        type: 'NEW_REQUEST_FOR_REVIEW',
        title: notifTitle,
        message: notifMessage,
        documentId: String(doc._id),
        trackingNo,
        createdBy: docCreatedBy,
        byUser: docCreatedBy,
        byOffice: docOffice,
        timestamp: new Date().toISOString(),
        document: doc,
      };

      const gsoRooms = [
        'office:GSO',
        'office:OFFICE OF THE PROVINCIAL GENERAL SERVICES',
        'office:GENERAL SERVICES OFFICE',
        'role:gso',
        'role:procurement',
        'role:admin',
        'role:superadmin',
      ];

      for (const room of gsoRooms) {
        global.io.to(room).emit('notification:office', forReviewPayload);
      }
    }

    res.status(201).json({
      message: 'Document created successfully',
      document: doc,
    });
  } catch (error) {
    console.error('Create document error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/documents/:id - Update document fields, status, and/or append logs
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const role = String(req.user?.role || '').trim().toLowerCase();
    const isAdminRole = role === 'admin' || role === 'superadmin' || role === 'user';
    const canDeleteLogs = role === 'admin' || role === 'superadmin';
    const isEndUserRole = role === 'viewer' || role === 'staff';

    const currentDoc = await Document.findById(id).select('createdBy office status');
    if (!currentDoc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    let isDocumentOwner = false;
    if (!isAdminRole) {
      let currentUserName = '';
      let currentUserOffice = '';

      if (isEndUserRole) {
        const endUser = await EndUser.findById(req.user?.userId).select('fullName username office');
        currentUserName = String(endUser?.fullName || endUser?.username || '').trim();
        currentUserOffice = String(endUser?.office || '').trim();
      } else if (role === 'procurement') {
        const procUser = await ProcurementUser.findById(req.user?.userId).select('fullName username office');
        currentUserName = String(procUser?.fullName || procUser?.username || '').trim();
        currentUserOffice = String(procUser?.office || '').trim();
      } else {
        const user = await User.findById(req.user?.userId).select('fullName username office');
        currentUserName = String(user?.fullName || user?.username || '').trim();
        currentUserOffice = String(user?.office || '').trim();
      }

      const createdBy = String(currentDoc.createdBy || '').trim();
      const sameCreator = Boolean(currentUserName && createdBy && currentUserName.toLowerCase() === createdBy.toLowerCase());
      const docOffice = String(currentDoc.office || '').trim();
      const sameOffice = Boolean(
        currentUserOffice &&
        docOffice &&
        (currentUserOffice.toLowerCase() === docOffice.toLowerCase() ||
          currentUserOffice.toLowerCase().includes(docOffice.toLowerCase()) ||
          docOffice.toLowerCase().includes(currentUserOffice.toLowerCase()))
      );
      isDocumentOwner = sameCreator || sameOffice;
    }

    if (isEndUserRole && !isDocumentOwner) {
      return res.status(403).json({ message: 'Forbidden: You can only update your own requests' });
    }

    let officePrivileges = [];
    let officeName = '';
    if (!isAdminRole) {
      officeName = await loadCurrentUserOffice(req.user);
      officePrivileges = await loadOfficePrivilegesByOfficeName(officeName);
    }

    const {
      status,
      addLog,
      fund,
      office,
      section,
      fpp,
      department,
      contactNumber,
      responsibilityCenter,
      accountCode,
      obrParticulars,
      email,
      requestedByName,
      requestedByDesignation,
      cashAvailabilityName,
      cashAvailabilityDesignation,
      approvedByName,
      approvedByDesignation,
      certifiedAName,
      certifiedAPosition,
      certifiedBName,
      certifiedBPosition,
      preparedByName,
      prItems,
      prDate,
      driveLink,
      purpose,
      notes,
      amount,
      supplierAmount,
      supplier,
      supplierAddress,
      tin,
      poNo,
      poDate,
      modeOfProcurement,
      placeOfDelivery,
      dateOfDelivery,
      deliveryTerm,
      paymentTerm,
      conformeSupplierName,
      conformeDate,
      sanggunianResolutionNo,
      secretaryName,
      secretaryDate,
      poItems,
      prNo,
      obrNo,
      prEnabled,
      obrEnabled,
      removeLastLog,
      cancelTransfer,
      returnToApprovals,
      returnRemarks,
      requestReturnToApprovals,
      returnReason,
      clearReturnRequest,
      subDocuments,
      gsoRoutingSlip,
    } = req.body || {};

    const requiredPrivileges = new Set();
    if (typeof fund === 'string') requiredPrivileges.add('Update Source of Fund');
    if (typeof amount === 'string') requiredPrivileges.add('Update Amount');
    if (typeof supplierAmount === 'string') requiredPrivileges.add('Update Supplier');
    if (typeof supplier === 'string') requiredPrivileges.add('Update Supplier');
    if (typeof prNo === 'string') requiredPrivileges.add('Update PR');
    if (typeof obrNo === 'string') requiredPrivileges.add('Update CAFOA');
    if (Array.isArray(prItems) || typeof prEnabled === 'boolean') requiredPrivileges.add('Update PR');
    if (typeof notes === 'string') requiredPrivileges.add('BAC Notes');
    if (!isAdminRole && typeof office === 'string') {
      return res.status(403).json({ message: 'Forbidden: Only admin can change office requestor' });
    }
    // Adding logs alone is allowed (used by review logs UI). Privileges are enforced on state changes
    // such as status transitions below.

    if (typeof status === 'string' && status.trim()) {
      const s = status.trim().toLowerCase();

      let currentStatusLower = String(currentDoc.status || '').trim().toLowerCase();

      if (s === 'completed') requiredPrivileges.add('Complete Request');
      const isApprovalStateChange = s === 'approved' || s === 'ready-transfer' || s === 'pending-bac' || s === 'returned';
      const isEndUserRevisionReturn =
        isEndUserRole &&
        currentStatusLower === 'for-revision' &&
        (s === 'pending' || s === 'pending-gso' || s === 'pending-bac' || s === 'in-budget' || s === 'in-pto');

      if (isApprovalStateChange && !isEndUserRevisionReturn) requiredPrivileges.add('Approvals');
    }

    if (!isAdminRole) {
      const officeLower = String(officeName || '').trim().toLowerCase();
      const isGsoOrBac = officeLower.includes('gso') || officeLower.includes('bac') || officeLower.includes('general services') || officeLower.includes('bids') || officeLower.includes('pgso');

      for (const p of requiredPrivileges) {
        if (isDocumentOwner) {
          const key = String(p).trim().toLowerCase();
          if (key !== 'approvals' && key !== 'complete request') continue;
        }
        if (role === 'procurement' && String(p).trim().toLowerCase() === 'approvals') {
          continue;
        }
        // Procurement / GSO / BAC users are allowed to edit supplier & PR items for PO Preparation
        if ((role === 'procurement' || isGsoOrBac) && (String(p).toLowerCase() === 'update supplier' || String(p).toLowerCase() === 'update pr')) {
          continue;
        }
        if (!hasPrivilege(officePrivileges, p)) {
          return res.status(403).json({ message: `Forbidden: Missing privilege '${p}'` });
        }
      }
    }

    const update = { updatedAt: Date.now() };

    if (typeof status === 'string' && status.trim()) update.status = status.trim();
    if (typeof fund === 'string') update.fund = fund.trim();
    if (isAdminRole && typeof office === 'string') update.office = office.trim();
    if (typeof section === 'string') update.section = section.trim() ? section.trim() : 'N/A';
    if (typeof fpp === 'string') update.fpp = fpp.trim();
    if (typeof department === 'string') update.department = department.trim();
    if (typeof contactNumber === 'string') update.contactNumber = contactNumber.trim();
    if (typeof responsibilityCenter === 'string') update.responsibilityCenter = responsibilityCenter.trim();
    if (typeof accountCode === 'string') update.accountCode = accountCode.trim();
    if (typeof obrParticulars === 'string') update.obrParticulars = obrParticulars.trim();
    if (typeof email === 'string') update.email = email.trim();
    if (typeof requestedByName === 'string') update.requestedByName = requestedByName.trim();
    if (typeof requestedByDesignation === 'string') update.requestedByDesignation = requestedByDesignation.trim();
    if (typeof cashAvailabilityName === 'string') update.cashAvailabilityName = cashAvailabilityName.trim();
    if (typeof cashAvailabilityDesignation === 'string') update.cashAvailabilityDesignation = cashAvailabilityDesignation.trim();
    if (typeof approvedByName === 'string') update.approvedByName = approvedByName.trim();
    if (typeof approvedByDesignation === 'string') update.approvedByDesignation = approvedByDesignation.trim();
    if (typeof certifiedAName === 'string') update.certifiedAName = certifiedAName.trim();
    if (typeof certifiedAPosition === 'string') update.certifiedAPosition = certifiedAPosition.trim();
    if (typeof certifiedBName === 'string') update.certifiedBName = certifiedBName.trim();
    if (typeof certifiedBPosition === 'string') update.certifiedBPosition = certifiedBPosition.trim();
    if (typeof preparedByName === 'string') update.preparedByName = preparedByName.trim();
    if (Array.isArray(prItems)) update.prItems = prItems;
    if (typeof prDate === 'string') update.prDate = prDate.trim();
    if (typeof driveLink === 'string') update.driveLink = driveLink.trim() ? driveLink.trim() : 'N/A';
    if (typeof purpose === 'string' && purpose.trim()) update.purpose = purpose.trim();
    if (typeof notes === 'string') update.notes = notes;
    if (typeof amount === 'string') update.amount = amount.trim();
    if (typeof supplierAmount === 'string') update.supplierAmount = supplierAmount.trim();
    if (typeof supplier === 'string') update.supplier = supplier.trim();
    if (typeof supplierAddress === 'string') update.supplierAddress = supplierAddress.trim();
    if (typeof tin === 'string') update.tin = tin.trim();
    if (typeof poNo === 'string') update.poNo = poNo.trim();
    if (typeof poDate === 'string') update.poDate = poDate.trim();
    if (typeof modeOfProcurement === 'string') update.modeOfProcurement = modeOfProcurement.trim();
    if (typeof placeOfDelivery === 'string') update.placeOfDelivery = placeOfDelivery.trim();
    if (typeof dateOfDelivery === 'string') update.dateOfDelivery = dateOfDelivery.trim();
    if (typeof deliveryTerm === 'string') update.deliveryTerm = deliveryTerm.trim();
    if (typeof paymentTerm === 'string') update.paymentTerm = paymentTerm.trim();
    if (typeof conformeSupplierName === 'string') update.conformeSupplierName = conformeSupplierName.trim();
    if (typeof conformeDate === 'string') update.conformeDate = conformeDate.trim();
    if (typeof sanggunianResolutionNo === 'string') update.sanggunianResolutionNo = sanggunianResolutionNo.trim();
    if (typeof secretaryName === 'string') update.secretaryName = secretaryName.trim();
    if (typeof secretaryDate === 'string') update.secretaryDate = secretaryDate.trim();
    if (Array.isArray(poItems)) update.poItems = poItems;
    if (typeof prNo === 'string') update.prNo = prNo.trim();
    if (typeof obrNo === 'string') update.obrNo = obrNo.trim();
    if (typeof prEnabled === 'boolean') update.prEnabled = prEnabled;
    if (typeof obrEnabled === 'boolean') update.obrEnabled = obrEnabled;
    if (Array.isArray(subDocuments)) update.subDocuments = subDocuments;
    if (typeof gsoRoutingSlip === 'string') update.gsoRoutingSlip = gsoRoutingSlip.trim();

    const doc = await Document.findByIdAndUpdate(id, update, { new: true });
    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    if (removeLastLog) {
      if (!canDeleteLogs) {
        return res.status(403).json({ message: 'Forbidden: Only admin can delete logs' });
      }
      if (Array.isArray(doc.logs) && doc.logs.length > 1) {
        const lastLog = doc.logs[doc.logs.length - 1];
        const lastLabel = String(lastLog?.label || '').trim().toLowerCase();
        if (lastLabel.startsWith('transferred to')) {
          return res.status(400).json({ message: 'Cannot delete transfer logs' });
        }
        doc.logs.pop();
        doc.status = inferStatusFromLogs(doc);
        doc.updatedAt = Date.now();
        await doc.save();
      }
    }

    if (cancelTransfer) {
      if (Array.isArray(doc.logs) && doc.logs.length > 0) {
        const lastLog = doc.logs[doc.logs.length - 1];
        const lastLabel = String(lastLog?.label || '').trim().toLowerCase();
        const lastByOffice = String(lastLog?.byOffice || '').trim().toLowerCase();

        let actionOfficeLower = '';
        if (!isAdminRole) {
          const userOffice = await loadCurrentUserOffice(req.user);
          actionOfficeLower = String(userOffice).trim().toLowerCase();
        }

        if (lastLabel.startsWith('transferred ')) {
          if (isAdminRole || (actionOfficeLower && lastByOffice === actionOfficeLower)) {
            doc.logs.pop();
            if (!update.status) {
              doc.status = inferStatusFromLogs(doc);
            }
            doc.updatedAt = Date.now();
            await doc.save();
          } else {
            return res.status(403).json({ message: 'Forbidden: Cannot cancel transfer initiated by another office' });
          }
        } else {
          return res.status(400).json({ message: 'Last action was not a transfer, cannot cancel' });
        }
      }
    }

    if (requestReturnToApprovals) {
      doc.returnToApprovalsRequested = true;
      doc.returnToApprovalsReason = typeof returnReason === 'string' ? returnReason.trim() : '';

      const userLabel = String(req.user?.fullName || req.user?.username || 'End User').trim();
      const userOffice = String(currentDoc.office || req.user?.office || '').trim();
      const reasonText = doc.returnToApprovalsReason ? `: ${doc.returnToApprovalsReason}` : '';

      doc.logs.push({
        label: `Requested Return to Approvals${reasonText}`,
        color: 'bg-amber-600',
        byOffice: userOffice,
        byUser: userLabel,
        createdAt: Date.now(),
      });
      doc.updatedAt = Date.now();
      await doc.save();

      if (global.io) {
        const notifData = {
          type: 'RETURN_TO_APPROVALS_REQUEST',
          title: 'Return to Approvals Requested',
          message: `${userLabel} (${userOffice}) requested return to approvals for tracking #${doc.trackingNo}`,
          documentId: doc._id,
          trackingNo: doc.trackingNo,
          office: userOffice,
          requestedBy: userLabel,
          reason: doc.returnToApprovalsReason,
          timestamp: new Date().toISOString(),
        };
        global.io.emit('document:return_requested', notifData);
        global.io.emit('notification:admin', notifData);
      }
    }

    if (clearReturnRequest) {
      if (!isAdminRole) {
        return res.status(403).json({ message: 'Forbidden: Only admin can dismiss return requests' });
      }
      doc.returnToApprovalsRequested = false;
      doc.returnToApprovalsReason = '';
      doc.updatedAt = Date.now();
      await doc.save();
    }

    if (returnToApprovals) {
      if (!isAdminRole) {
        return res.status(403).json({ message: 'Forbidden: Only admin can return documents to approvals' });
      }
      if (Array.isArray(doc.logs)) {
        doc.logs = doc.logs.filter((l) => {
          const lbl = String(l?.label || '').trim().toLowerCase();
          return !lbl.includes('transferred to') && !lbl.startsWith('received');
        });
      }
      if (Array.isArray(doc.subDocuments)) {
        doc.subDocuments.forEach((sub) => {
          if (Array.isArray(sub.logs)) {
            sub.logs = sub.logs.filter((l) => {
              const lbl = String(l?.label || '').trim().toLowerCase();
              return !lbl.includes('transferred to') && !lbl.startsWith('received');
            });
          }
          sub.status = 'pending-gso';
        });
      }

      doc.status = 'pending-gso';
      doc.returnToApprovalsRequested = false;
      doc.returnToApprovalsReason = '';

      const adminUserName = String(req.user?.fullName || req.user?.username || 'Admin').trim();
      const returnLogLabel = typeof returnRemarks === 'string' && returnRemarks.trim()
        ? `Returned to Approvals: ${returnRemarks.trim()}`
        : 'Returned to Approvals';

      doc.logs.push({
        label: returnLogLabel,
        color: 'bg-amber-600',
        byOffice: 'ADMIN',
        byUser: adminUserName,
        createdAt: Date.now(),
      });
      doc.updatedAt = Date.now();
      await doc.save();
    }

    if (addLog && typeof addLog === 'object') {
      const label = typeof addLog.label === 'string' ? addLog.label.trim() : '';
      const color = typeof addLog.color === 'string' && addLog.color.trim() ? addLog.color.trim() : 'bg-sky-500';
      const byOffice = typeof addLog.byOffice === 'string' ? addLog.byOffice.trim() : '';
      const byUser = typeof addLog.byUser === 'string' ? addLog.byUser.trim() : '';
      if (label) {
        doc.logs.push({ label, color, byOffice, byUser, createdAt: Date.now() });
        doc.updatedAt = Date.now();
        await doc.save();
      }
    }

    // Emit real-time event for document update
    if (global.io) {
      const eventData = {
        document: doc,
        changes: Object.keys(update),
        updatedBy: req.user?.userId,
        timestamp: new Date().toISOString()
      };

      // Silent data-refresh broadcast to all clients (no toast shown from this)
      global.io.emit('document:updated', eventData);

      // ── Targeted toast notification to document creator only ──────────────
      const docCreatedBy = String(doc.createdBy || '').trim();
      const docOffice    = String(doc.office    || '').trim();
      const trackingNo   = String(doc.trackingNo || '').trim();

      // ── Determine Who Performed the Current Action ───────────────────────
      const currentRole = String(req.user?.role || '').trim().toLowerCase();
      const currentUsername = String(req.user?.username || '').trim();
      const currentFullName = String(req.user?.fullName || '').trim();
      const reqActorName = currentFullName || currentUsername || 'User';

      const hasNewLog = Boolean(addLog && typeof addLog === 'object' && addLog.label);
      const logByUser = hasNewLog && typeof addLog.byUser === 'string' ? addLog.byUser.trim() : '';
      const logByOffice = hasNewLog && typeof addLog.byOffice === 'string' ? addLog.byOffice.trim() : '';

      const lastLog = Array.isArray(doc.logs) && doc.logs.length > 0
        ? doc.logs[doc.logs.length - 1]
        : null;
      const lastLabel = String(lastLog?.label || '').trim().toLowerCase();

      const isReturnedLog = hasNewLog && lastLabel.startsWith('returned');
      const isApprovedLog = hasNewLog && (lastLabel.startsWith('approved') || lastLabel.startsWith('completed'));
      const isRoutingSlip = typeof gsoRoutingSlip === 'string' && gsoRoutingSlip.trim().length > 0;
      const isReviewLog   = hasNewLog && (
        lastLabel.startsWith('remarks') ||
        lastLabel.includes('review') ||
        lastLabel.startsWith('transferred to') ||
        lastLabel.includes('reply')
      );

      const isCurrentRequestProcurementOrAdmin =
        currentRole === 'procurement' ||
        currentRole === 'admin' ||
        currentRole === 'superadmin' ||
        logByOffice.toUpperCase().includes('GSO') ||
        logByOffice.toUpperCase().includes('GENERAL SERVICES') ||
        logByOffice.toUpperCase().includes('BAC') ||
        logByOffice.toUpperCase().includes('BUDGET') ||
        logByOffice.toUpperCase().includes('PTO');

      const isCurrentRequestEndUser =
        currentRole === 'viewer' ||
        currentRole === 'staff' ||
        (!isCurrentRequestProcurementOrAdmin && (
          (docCreatedBy && currentUsername.toLowerCase() === docCreatedBy.toLowerCase()) ||
          (docCreatedBy && logByUser.toLowerCase() === docCreatedBy.toLowerCase())
        ));

      // ── 1. Notify Document Creator if GSO / Procurement / Admin acted ──────
      const shouldNotifyCreator = docCreatedBy &&
        !isCurrentRequestEndUser &&
        (isReturnedLog || isApprovedLog || isRoutingSlip || isReviewLog);

      if (shouldNotifyCreator) {
        let notifTitle = '🔔 Document Update';
        let notifMessage = `#${trackingNo}`;

        if (isReturnedLog) {
          notifTitle = `↩️ Document Returned: #${trackingNo}`;
          const remarkPart = lastLog?.label?.includes(':')
            ? lastLog.label.slice(lastLog.label.indexOf(':') + 1).trim()
            : '';
          notifMessage = remarkPart
            ? `Returned by ${logByUser || logByOffice || reqActorName}: ${remarkPart}`
            : `Your document was returned by ${logByUser || logByOffice || reqActorName}`;
        } else if (isApprovedLog) {
          notifTitle = `✅ Document Approved: #${trackingNo}`;
          const remarkPart = lastLog?.label?.includes(':')
            ? lastLog.label.slice(lastLog.label.indexOf(':') + 1).trim()
            : '';
          notifMessage = remarkPart
            ? `Approved by ${logByUser || logByOffice || reqActorName}: ${remarkPart}`
            : `Your document was approved by ${logByUser || logByOffice || reqActorName}`;
        } else if (isRoutingSlip) {
          notifTitle = `📋 Routing Slip Assigned: #${trackingNo}`;
          notifMessage = `Routing slip category set to "${gsoRoutingSlip.trim()}" by GSO`;
        } else if (isReviewLog) {
          notifTitle = `📝 Review Log Added: #${trackingNo}`;
          const remarkPart = lastLog?.label?.includes(':')
            ? lastLog.label.slice(lastLog.label.indexOf(':') + 1).trim()
            : lastLog?.label || '';
          notifMessage = remarkPart
            ? `${remarkPart} — by ${logByUser || logByOffice || reqActorName}`
            : `Review log added by ${logByUser || logByOffice || reqActorName}`;
        }

        const notifPayload = {
          type: 'DOCUMENT_ACTION',
          title: notifTitle,
          message: notifMessage,
          documentId: String(doc._id),
          trackingNo,
          createdBy: docCreatedBy,
          byUser: logByUser || reqActorName,
          byOffice: logByOffice || 'GSO',
          timestamp: new Date().toISOString(),
          document: doc,
        };

        // Send to creator's personal room
        global.io.to(`user:${docCreatedBy}`).emit('notification:user', notifPayload);

        // Also send to creator's office room
        if (docOffice) {
          global.io.to(`office:${docOffice}`).emit('notification:office', notifPayload);
        }
      }

      // ── 2. Notify GSO / Reviewer if End-User replied in Review Logs ────────
      const isReplyFromEndUser = isReviewLog && isCurrentRequestEndUser;

      if (isReplyFromEndUser) {
        // Find the previous reviewer who commented/returned this document
        let targetReviewerUser = '';
        let targetReviewerOffice = '';

        const logs = Array.isArray(doc.logs) ? doc.logs : [];
        for (let i = logs.length - 2; i >= 0; i--) {
          const l = logs[i];
          const off = String(l?.byOffice || '').trim().toUpperCase();
          const usr = String(l?.byUser || '').trim();
          if (
            off.includes('GSO') ||
            off.includes('GENERAL SERVICES') ||
            off.includes('BAC') ||
            off.includes('PROCUREMENT')
          ) {
            targetReviewerUser = usr;
            targetReviewerOffice = off;
            break;
          }
        }

        const remarkPart = lastLog?.label?.includes(':')
          ? lastLog.label.slice(lastLog.label.indexOf(':') + 1).trim()
          : lastLog?.label || '';

        const replyPayload = {
          type: 'REVIEW_REPLY',
          title: `💬 End-User Replied: #${trackingNo}`,
          message: `${logByUser || reqActorName} replied: "${remarkPart}"`,
          documentId: String(doc._id),
          trackingNo,
          createdBy: docCreatedBy,
          byUser: logByUser || reqActorName,
          byOffice: logByOffice || docOffice,
          timestamp: new Date().toISOString(),
          document: doc,
        };

        // Send directly to the reviewer who previously handled the document
        if (targetReviewerUser) {
          global.io.to(`user:${targetReviewerUser}`).emit('notification:user', replyPayload);
        }

        // Send to GSO / Procurement office rooms
        const targetOffices = new Set([
          'GSO',
          'OFFICE OF THE PROVINCIAL GENERAL SERVICES',
          'GENERAL SERVICES OFFICE',
          targetReviewerOffice
        ].filter(Boolean));

        for (const off of targetOffices) {
          global.io.to(`office:${off}`).emit('notification:office', replyPayload);
        }
      }

      // ── 3. Notify Destination Office and Document Creator on Transfer ─────
      const isTransferLog = hasNewLog && (lastLabel.startsWith('transferred to') || lastLabel.includes('transferred to'));

      if (isTransferLog) {
        const match = lastLabel.match(/transferred\s+to\s+([^(:\n]+)/i);
        const destOffice = match ? match[1].trim().toUpperCase() : 'RECEIVING OFFICE';

        const taskMatch = lastLabel.match(/\(([^)]+)\)/) || lastLabel.match(/:\s*(.+)$/);
        const taskText = taskMatch ? taskMatch[1].trim() : '';

        const senderInfo = logByUser || reqActorName;
        const senderOfficeInfo = docOffice || logByOffice;

        // 3A. Alert to Destination Office
        const incomingPayload = {
          type: 'DOCUMENT_TRANSFERRED',
          title: `📤 Incoming Document: #${trackingNo}`,
          message: `Document transferred to ${destOffice} by ${senderInfo}${senderOfficeInfo ? ` (${senderOfficeInfo})` : ''}${taskText ? ` • ${taskText}` : ''}`,
          documentId: String(doc._id),
          trackingNo,
          createdBy: docCreatedBy,
          destOffice,
          byUser: senderInfo,
          byOffice: senderOfficeInfo,
          timestamp: new Date().toISOString(),
          document: doc,
        };

        const destRooms = new Set([
          `office:${destOffice}`,
          destOffice.includes('BUDGET') ? 'office:BUDGET' : '',
          destOffice.includes('BUDGET') ? 'office:PROVINCIAL BUDGET OFFICE' : '',
          destOffice.includes('BUDGET') ? 'office:OFFICE OF THE PROVINCIAL BUDGET OFFICER' : '',
          destOffice.includes('PTO') || destOffice.includes('TREASURER') ? 'office:PTO' : '',
          destOffice.includes('PTO') || destOffice.includes('TREASURER') ? 'office:PROVINCIAL TREASURERS OFFICE' : '',
          destOffice.includes('PTO') || destOffice.includes('TREASURER') ? "office:PROVINCIAL TREASURER'S OFFICE" : '',
          destOffice.includes('PTO') || destOffice.includes('TREASURER') ? 'office:OFFICE OF THE PROVINCIAL TREASURER' : '',
          destOffice.includes('GSO') || destOffice.includes('GENERAL SERVICES') ? 'office:GSO' : '',
          destOffice.includes('GSO') || destOffice.includes('GENERAL SERVICES') ? 'office:OFFICE OF THE PROVINCIAL GENERAL SERVICES' : '',
          destOffice.includes('GSO') || destOffice.includes('GENERAL SERVICES') ? 'office:GENERAL SERVICES OFFICE' : '',
          destOffice.includes('BAC') || destOffice.includes('BIDS') ? 'office:BAC' : '',
          destOffice.includes('BAC') || destOffice.includes('BIDS') ? 'office:BIDS AND AWARDS COMMITTEE' : '',
          destOffice.includes('ACCOUNTING') ? 'office:ACCOUNTING' : '',
          destOffice.includes('ACCOUNTING') ? 'office:PROVINCIAL ACCOUNTING OFFICE' : '',
          `role:${destOffice.toLowerCase()}`,
        ].filter(Boolean));

        for (const room of destRooms) {
          global.io.to(room).emit('notification:office', incomingPayload);
        }

        // 3B. Alert to Document Creator (if transferred by procurement / other office)
        const isTransferredBySomeoneElse = docCreatedBy &&
          senderInfo.toLowerCase() !== docCreatedBy.toLowerCase();

        if (isTransferredBySomeoneElse) {
          const creatorPayload = {
            type: 'DOCUMENT_TRANSFERRED',
            title: `📤 Document In Transit: #${trackingNo}`,
            message: `Your document #${trackingNo} was transferred to ${destOffice} by ${senderInfo}${taskText ? ` (${taskText})` : ''}`,
            documentId: String(doc._id),
            trackingNo,
            createdBy: docCreatedBy,
            destOffice,
            byUser: senderInfo,
            byOffice: senderOfficeInfo,
            timestamp: new Date().toISOString(),
            document: doc,
          };

          global.io.to(`user:${docCreatedBy}`).emit('notification:user', creatorPayload);
          if (docOffice) {
            global.io.to(`office:${docOffice}`).emit('notification:office', creatorPayload);
          }
        }
      }
    }

    res.json({ message: 'Document updated successfully', document: doc });
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/documents/:id - Delete document (Admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const role = String(req.user?.role || '').trim().toLowerCase();
    const isAdminRole = role === 'admin' || role === 'superadmin' || role === 'user';

    if (!isAdminRole) {
      return res.status(403).json({ message: 'Forbidden: Admin access required to delete documents' });
    }

    let doc = null;
    if (mongoose.Types.ObjectId.isValid(id)) {
      doc = await Document.findByIdAndDelete(id);
    } else {
      doc = await Document.findOneAndDelete({ trackingNo: String(id).trim() });
    }

    if (!doc) {
      return res.status(404).json({ message: 'Document not found' });
    }

    // Emit real-time event for deleted document
    if (global.io) {
      global.io.emit('document:deleted', {
        documentId: String(doc._id),
        trackingNo: doc.trackingNo,
      });
    }

    res.json({ message: 'Document deleted successfully', documentId: String(doc._id), trackingNo: doc.trackingNo });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;



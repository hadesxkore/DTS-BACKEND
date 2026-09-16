const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  trackingNo: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  createdBy: {
    type: String,
    required: true,
    trim: true,
  },
  office: {
    type: String,
    default: '',
    trim: true,
  },
  fund: {
    type: String,
    default: '',
    trim: true,
  },
  gsoRoutingSlip: {
    type: String,
    default: '',
    trim: true,
  },
  section: {
    type: String,
    default: 'N/A',
    trim: true,
  },
  fpp: {
    type: String,
    default: '',
    trim: true,
  },
  department: {
    type: String,
    default: '',
    trim: true,
  },
  contactNumber: {
    type: String,
    default: '',
    trim: true,
  },
  responsibilityCenter: {
    type: String,
    default: '',
    trim: true,
  },
  accountCode: {
    type: String,
    default: '',
    trim: true,
  },
  obrParticulars: {
    type: String,
    default: '',
    trim: true,
  },
  email: {
    type: String,
    default: '',
    trim: true,
  },
  requestedByName: {
    type: String,
    default: '',
    trim: true,
  },
  requestedByDesignation: {
    type: String,
    default: '',
    trim: true,
  },
  cashAvailabilityName: {
    type: String,
    default: 'ALICIA R. MAGPANTAY',
    trim: true,
  },
  cashAvailabilityDesignation: {
    type: String,
    default: 'Provincial Treasurer',
    trim: true,
  },
  approvedByName: {
    type: String,
    default: 'JOSE ENRIQUE S. GARCIA III',
    trim: true,
  },
  approvedByDesignation: {
    type: String,
    default: 'Provincial Governor',
    trim: true,
  },
  certifiedAName: {
    type: String,
    default: '',
    trim: true,
  },
  certifiedAPosition: {
    type: String,
    default: '',
    trim: true,
  },
  certifiedBName: {
    type: String,
    default: 'EDUARDO D. BANZON',
    trim: true,
  },
  certifiedBPosition: {
    type: String,
    default: 'Provincial Budget Officer',
    trim: true,
  },
  preparedByName: {
    type: String,
    default: '',
    trim: true,
  },
  prItems: [
    {
      itemNo: { type: String, default: '' },
      unit: { type: String, default: '' },
      description: { type: String, default: '' },
      quantity: { type: String, default: '' },
      unitCost: { type: String, default: '' },
      totalCost: { type: String, default: '' },
    },
  ],
  prDate: {
    type: String,
    default: '',
    trim: true,
  },
  purpose: {
    type: String,
    required: true,
    trim: true,
  },
  notes: {
    type: String,
    default: '',
  },
  amount: {
    type: String,
    default: '',
    trim: true,
  },
  supplierAmount: {
    type: String,
    default: '',
    trim: true,
  },
  supplier: {
    type: String,
    default: '',
    trim: true,
  },
  supplierAddress: {
    type: String,
    default: '',
    trim: true,
  },
  tin: {
    type: String,
    default: '',
    trim: true,
  },
  poNo: {
    type: String,
    default: '',
    trim: true,
  },
  poDate: {
    type: String,
    default: '',
    trim: true,
  },
  modeOfProcurement: {
    type: String,
    default: '',
    trim: true,
  },
  placeOfDelivery: {
    type: String,
    default: '',
    trim: true,
  },
  dateOfDelivery: {
    type: String,
    default: '',
    trim: true,
  },
  deliveryTerm: {
    type: String,
    default: '',
    trim: true,
  },
  paymentTerm: {
    type: String,
    default: '',
    trim: true,
  },
  conformeSupplierName: {
    type: String,
    default: '',
    trim: true,
  },
  conformeDate: {
    type: String,
    default: '',
    trim: true,
  },
  sanggunianResolutionNo: {
    type: String,
    default: '',
    trim: true,
  },
  secretaryName: {
    type: String,
    default: '',
    trim: true,
  },
  secretaryDate: {
    type: String,
    default: '',
    trim: true,
  },
  poItems: [
    {
      stockPropertyNo: { type: String, default: '' },
      unit: { type: String, default: '' },
      description: { type: String, default: '' },
      quantity: { type: String, default: '' },
      unitCost: { type: String, default: '' },
      amount: { type: String, default: '' },
    },
  ],
  driveLink: {
    type: String,
    default: 'N/A',
    trim: true,
  },
  prEnabled: {
    type: Boolean,
    default: true,
  },
  obrEnabled: {
    type: Boolean,
    default: true,
  },
  prNo: {
    type: String,
    default: '',
    trim: true,
  },
  obrNo: {
    type: String,
    default: '',
    trim: true,
  },
  status: {
    type: String,
    enum: [
      'pending',
      'pending-gso',
      'pending-bac',
      'ready-transfer',
      'in-budget',
      'in-pto',
      'for-validation',
      'pre-validation',
      'for-revision',
      'ongoing',
      'approved',
      'reprocessed',
      'completed',
      'returned',
      'discontinued',
      'cancelled',
      'canceled',
    ],
    default: 'pending',
  },
  returnToApprovalsRequested: {
    type: Boolean,
    default: false,
  },
  returnToApprovalsReason: {
    type: String,
    default: '',
    trim: true,
  },
  logs: [
    {
      label: { type: String, default: '' },
      color: { type: String, default: 'bg-sky-500' },
      byOffice: { type: String, default: '' },
      byUser: { type: String, default: '' },
      createdAt: { type: Date, default: Date.now },
    },
  ],
  subDocuments: [
    {
      trackingNo: { type: String, trim: true },
      purpose: { type: String, trim: true },
      amount: { type: String, trim: true },
      supplier: { type: String, trim: true },
      status: { type: String, default: 'returned' },
      logs: [
        {
          label: { type: String, default: '' },
          color: { type: String, default: 'bg-sky-500' },
          byOffice: { type: String, default: '' },
          byUser: { type: String, default: '' },
          createdAt: { type: Date, default: Date.now },
        },
      ],
    },
  ],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

documentSchema.index({ status: 1, office: 1, createdAt: -1 });
documentSchema.index({ createdBy: 1, createdAt: -1 });
documentSchema.index({ office: 1, createdAt: -1 });
documentSchema.index({ trackingNo: 1 });

module.exports = mongoose.model('Document', documentSchema);

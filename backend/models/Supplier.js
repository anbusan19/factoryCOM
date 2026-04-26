import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  contactName: { type: String, default: '' },
  email: { type: String, default: '' },
  phone: { type: String, default: '' },
  category: {
    type: String,
    enum: ['Raw Material', 'Components', 'Tools', 'Services', 'Packaging'],
    default: 'Raw Material',
  },
  rating: { type: Number, min: 1, max: 5, default: 3 },
  address: { type: String, default: '' },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

supplierSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

export default mongoose.model('Supplier', supplierSchema);

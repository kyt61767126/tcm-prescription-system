const mongoose = require('mongoose');

const prescriptionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    patientName: {
        type: String,
        required: true,
        trim: true
    },
    patientAge: {
        type: String,
        default: ''
    },
    patientGender: {
        type: String,
        default: ''
    },
    patientPhone: {
        type: String,
        default: ''
    },
    patientAddress: {
        type: String,
        default: ''
    },
    prescriptionNo: {
        type: String,
        default: ''
    },
    date: {
        type: String,
        default: ''
    },
    medicines: [{
        name: String,
        dosage: String,
        usage: String,
        price: String,
        quantity: String
    }],
    totalPrice: {
        type: String,
        default: ''
    },
    diagnosis: {
        type: String,
        default: ''
    },
    tongue: {
        type: String,
        default: ''
    },
    pulse: {
        type: String,
        default: ''
    },
    symptoms: {
        type: String,
        default: ''
    },
    formula: {
        type: String,
        default: ''
    },
    decoction: {
        type: String,
        default: ''
    },
    usage: {
        type: String,
        default: ''
    },
    notes: {
        type: String,
        default: ''
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

prescriptionSchema.index({ userId: 1, createdAt: -1 });

prescriptionSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Prescription', prescriptionSchema);

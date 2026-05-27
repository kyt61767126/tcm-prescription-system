const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true
    },
    clinicName: {
        type: String,
        default: ''
    },
    clinicDoctor: {
        type: String,
        default: ''
    },
    defaultRegFee: {
        type: String,
        default: '50'
    },
    defaultDose: {
        type: String,
        default: '7'
    },
    autoStartEnabled: {
        type: Boolean,
        default: false
    },
    prescriptionPrefix: {
        type: String,
        default: ''
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

settingsSchema.pre('save', function(next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('Settings', settingsSchema);

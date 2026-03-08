const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        minlength: [2, 'Name must be at least 2 characters']
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true,
        match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address']
    },
    password: {
        type: String,
        // Password is ONLY required if user is NOT signing in with Google
        required: function () {
            return !this.googleId;
        },
        minlength: [6, 'Password must be at least 6 characters']
    },
    googleId: {
        type: String,
        // sparse: true allows multiple documents to have null/undefined without
        // triggering the "duplicate key" error from the unique index
        unique: true,
        sparse: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
});

// Hash password before saving (only if password was modified and it exists)
// NOTE: With async middleware in Mongoose, do NOT use the next() callback.
// Mongoose handles async hooks by waiting for the Promise to resolve/reject.
// Use 'return' to skip and 'throw error' to fail — NOT next().
userSchema.pre('save', async function () {
    // Skip if password wasn't modified or if no password (Google user)
    if (!this.isModified('password') || !this.password) {
        return; // Just return — Mongoose will continue automatically
    }

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        // No next() needed — the resolved Promise tells Mongoose to continue
    } catch (error) {
        throw error; // Throw error — Mongoose catches this and aborts the save
    }
});

// Method to compare password during login
userSchema.methods.matchPassword = async function (enteredPassword) {
    // If user signed up via Google and has no password, reject manual login
    if (!this.password) return false;
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
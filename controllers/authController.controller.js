const User = require('../models/User.model');
const jwt = require('jsonwebtoken');

const register = async (req, res) => {
    const { name, email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });
        user = new User({ name, email, password });
        await user.save();
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, user: { id: user._id, name, email } });
    } catch (err) {
        console.log("error", err)
        res.status(500).json({ msg: 'Server error', error: err });
    }
};

const login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user || !(await user.matchPassword(password))) {
            return res.status(401).json({ msg: 'Invalid credentials' });
        }
        const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.json({ token, user: { id: user._id, name: user.name, email } });
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
};

module.exports = { register, login };
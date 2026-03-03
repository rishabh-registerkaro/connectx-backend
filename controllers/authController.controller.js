const User = require('../models/User.model');
const jwt = require('jsonwebtoken');

const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 3600000
}

const register = async (req, res) => {
    const { name, email, password } = req.body;
    try {
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });
        user = new User({ name, email, password });


        await user.save();
        const token = jwt.sign({ id: user._id, name: user.name, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

        res.cookie('token', token, cookieOptions);
        res.json({ token, user: { id: user._id, name: user.name, email: user.email } });
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
        const token = jwt.sign({ id: user._id, name: user.name, email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        // set the cookie

        res.cookie('token', token, cookieOptions);
        res.json({ token, user: { id: user._id, name: user.name, email } });
    } catch (err) {
        res.status(500).json({ msg: 'Server error' });
    }
};

// Add logout functions to clear the cookie
const logout = (req, res) => {
    res.clearCookie('token');
    res.status(200).json({
        msg: "Logged Out Successfully"
    });
}

module.exports = { register, login, logout };
const express = require('express');
const { register, login, logout } = require('../controllers/authController.controller');
const protect = require('../middlewares/authMiddleware');
const router = express.Router();
const User = require('../models/User.model');

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);


router.get('/me', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        res.json(user);
    } catch (error) {
        res.status(500).json({ msg: "Server Error" })
    }
})

module.exports = router;
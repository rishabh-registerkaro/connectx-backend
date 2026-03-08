const User = require('../models/User.model');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library')

// Initialize Google Oauth with your ClientId
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)


const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
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
    res.clearCookie('token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'None' : 'Lax',
    });
    res.status(200).json({
        msg: "Logged Out Successfully"
    });
}

// NEW: Google Sign-In / Sign-up

const googleAuth = async (req, res) => {
    const { token } = req.body; // this is the google credentials token from the token

    if (!token) {
        return res.status(400).json({ msg: "Google Token is required", succcess: false });
    }

    try {
        // Step 1 Verify the token is genuinely from google
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID
        })

        // Step 2: Extract user info from the verified token
        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;

        if (!email || !name) {
            return res.status(400).json({ msg: 'Count not retrieve user from Google' })
        }

        // Step 3: Check if this user already exists in the database
        let user = await User.findOne({ email });

        if (!user) {
            // singup flow: User doesn't exist, create a new acccount
            user = new User({
                name, email, googleId // no password fields - the schema allows this
            });

            await user.save();
            console.log(`✅ New User created via Google: ${email}`);
        } else if (!user.googleId) {
            // Account linking: User has email/password but no googleId -
            // This links their Google account to their existing account
            user.googleId = googleId;
            await user.save();
            console.log(`✅ Existing user linked to Google: ${email}`);
        }
        else {
            // ── LOGIN FLOW: User already exists with Google ──
            console.log(`✅ Existing Google user logged in: ${email}`);
        }

        // step 4: Generate JWT - exactly the same as normal login
        const jwtToken = jwt.sign({
            id: user._id, name: user.name, email: user.email
        }, process.env.JWT_SECRET, { expiresIn: `1h` });
        // Step 5: Set cookie and respond — exactly the same as your normal login
        res.cookie('token', jwtToken, cookieOptions);

        res.status(200).json({
            token: jwtToken,
            user: { id: user._id, name: user.name, email: user.email }
        })

    } catch (error) {
        console.error(`Google Auth Error: ${error.message}`);
        res.status(401).json({
            msg: 'Invalid or expired Google token'
        })
    }
}

module.exports = { register, login, logout, googleAuth };
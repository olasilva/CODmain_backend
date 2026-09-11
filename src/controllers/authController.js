// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const supabaseService = require('../services/supabaseService');
const { signToken } = require('../middleware/auth'); // ← single source of truth

/**
 * Get public user data (exclude sensitive fields)
 */
function publicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name || user.fullName,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    avatar_url: user.avatar_url,
    createdAt: user.created_at || user.createdAt,
  };
}

/**
 * Register new user
 */
async function register(req, res) {
  try {
    console.log('📝 Registration attempt:', req.body);

    const { fullName, email, phone, password, role = 'student' } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        error: 'Full name, email, and password are required',
      });
    }

    if (!['student', 'staff', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid account role' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await supabaseService.getUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({
        error: 'An account with this email already exists.',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await supabaseService.createUser({
      full_name: fullName.trim(),
      email: normalizedEmail,
      phone: phone || '',
      role: role,
      password_hash: passwordHash,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    const token = signToken(user);

    console.log('✅ User registered:', user.email);

    res.status(201).json({
      user: publicUser(user),
      token,
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({
      error: 'Registration failed. Please try again.',
      details: error.message,
    });
  }
}

/**
 * Regular login
 */
async function login(req, res) {
  try {
    console.log('🔑 Login attempt:', req.body.email);

    const { email, password, role = 'student' } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await supabaseService.getUserByEmail(normalizedEmail);

    if (!user) {
      console.log('❌ User not found:', normalizedEmail);
      return res.status(401).json({ error: 'Invalid email, password, or account type.' });
    }

    console.log('✅ User found:', user.email);

    if (user.role !== role) {
      console.log('❌ Role mismatch:', user.role, '!=', role);
      return res.status(401).json({
        error: `Invalid credentials for ${role} account.`,
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      console.log('❌ Invalid password for:', user.email);
      return res.status(401).json({ error: 'Invalid email, password, or account type.' });
    }

    await supabaseService.update('users', user.id, {
      last_login: new Date().toISOString(),
    });

    const token = signToken(user);

    console.log('✅ Login successful:', user.email);

    res.json({
      user: publicUser(user),
      token,
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      error: 'Login failed. Please try again.',
      details: error.message,
    });
  }
}

/**
 * Google Login (ID Token Flow - used by @react-oauth/google frontend)
 */
async function googleLogin(req, res) {
  try {
    const { token, role = 'student' } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Google token is required' });
    }

    let ticket;
    try {
      const { OAuth2Client } = require('google-auth-library');
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      ticket = await client.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
    } catch (error) {
      console.error('Google token verification error:', error);
      return res.status(401).json({ error: 'Invalid Google token' });
    }

    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId, email_verified } = payload;

    if (!email) {
      return res.status(400).json({ error: 'Email not provided by Google' });
    }

    const normalizedEmail = email.toLowerCase();

    let user = await supabaseService.getUserByEmail(normalizedEmail);

    if (!user) {
      const newUser = await supabaseService.createUser({
        full_name: name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        role: role || 'student',
        password_hash: await bcrypt.hash(Math.random().toString(36), 10),
        avatar_url: picture || null,
        is_active: true,
        email_verified: email_verified || false,
        google_id: googleId,
        created_at: new Date().toISOString(),
      });
      user = newUser;
    } else {
      await supabaseService.update('users', user.id, {
        avatar_url: picture || user.avatar_url,
        google_id: googleId || user.google_id,
        email_verified: email_verified || user.email_verified,
        last_login: new Date().toISOString(),
      });

      user = await supabaseService.getUserById(user.id);
    }

    if (role && user.role !== role) {
      return res.status(401).json({
        error: `You are registered as ${user.role}, not ${role}. Please sign in as ${user.role}.`,
      });
    }

    const jwtToken = signToken(user);

    res.json({
      user: publicUser(user),
      token: jwtToken,
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({
      error: 'Google login failed. Please try again.',
      details: error.message,
    });
  }
}

/**
 * Google OAuth Callback (Redirect Flow - used by Passport)
 */
async function googleCallback(req, res) {
  try {
    const user = req.user;

    if (!user) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }

    const token = signToken(user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/oauth-callback?token=${token}`);
  } catch (error) {
    console.error('Google Callback Error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?error=oauth_failed`);
  }
}

/**
 * Get current user profile
 */
async function getProfile(req, res) {
  try {
    const userId = req.user.id;
    const user = await supabaseService.getUserById(userId);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: publicUser(user) });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
}

/**
 * Update user profile
 */
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const updates = req.body;

    delete updates.id;
    delete updates.password_hash;
    delete updates.created_at;
    delete updates.role;
    delete updates.email;

    const updatedUser = await supabaseService.update('users', userId, updates);

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: publicUser(updatedUser),
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
}

/**
 * Change password
 */
async function changePassword(req, res) {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: 'New password must be at least 6 characters' });
    }

    const user = await supabaseService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await supabaseService.update('users', userId, {
      password_hash: newPasswordHash,
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
}

/**
 * Logout
 */
async function logout(req, res) {
  res.json({ message: 'Logged out successfully' });
}

module.exports = {
  register,
  login,
  googleLogin,
  googleCallback,
  getProfile,
  updateProfile,
  changePassword,
  logout,
  publicUser,
};
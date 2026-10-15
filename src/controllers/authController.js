// src/controllers/authController.js
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const supabaseService = require('../services/supabaseService');
const { supabaseAdmin } = require('../config/supabase');
const { signToken } = require('../middleware/auth'); // single source of truth
const { sendMail } = require('../services/emailService');

const PASSWORD_RESET_RESPONSE =
  'If an account exists for that email, a password reset link has been sent.';

async function getLatestAdmissionStatus(userId) {
  const { data: students, error: studentError } = await supabaseAdmin
    .from('students')
    .select('id')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (studentError) throw studentError;
  const student = students?.[0];
  if (!student) return null;

  const { data: admissions, error: admissionError } = await supabaseAdmin
    .from('admissions')
    .select('status')
    .eq('student_id', student.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (admissionError) throw admissionError;
  return admissions?.[0]?.status || null;
}

/**
 * Get public user data (exclude sensitive fields)
 */
function publicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name || user.fullName,
    username: user.username || null,
    email: user.email || null,
    phone: user.phone || '',
    role: user.role,
    avatar_url: user.avatar_url,
    createdAt: user.created_at || user.createdAt,
  };
}

// ============================================================
// Register new user — STUDENTS ONLY (username-first)
// ============================================================
async function register(req, res) {
  try {
    console.log('📝 Registration attempt:', req.body);

    const {
      fullName,
      username,
      phone,
      password,
      role = 'student',
      email, // optional, still accepted for back-compat
    } = req.body;

    if (!fullName || !username || !password) {
      return res.status(400).json({
        error: 'Full name, username, and password are required',
      });
    }

    // 🔒 Block staff/admin self-registration
    if (role && role !== 'student') {
      return res.status(403).json({
        error: 'Staff and admin accounts are created by the administrator.',
      });
    }

    // Slugify + validate username
    const normalizedUsername = String(username)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '');

    if (normalizedUsername.length < 3 || normalizedUsername.length > 40) {
      return res.status(400).json({
        error: 'Username must be 3–40 characters (a-z, 0-9, dash).',
      });
    }

    const existing = await supabaseService.getUserByUsername(normalizedUsername);
    if (existing) {
      return res.status(409).json({
        error: 'That username is already taken. Please choose another.',
      });
    }

    // If an email was supplied, verify it isn't taken
    let normalizedEmail = null;
    if (email && String(email).trim()) {
      normalizedEmail = String(email).trim().toLowerCase();
      const byEmail = await supabaseService.getUserByEmail(normalizedEmail);
      if (byEmail) {
        return res.status(409).json({
          error: 'An account with this email already exists.',
        });
      }
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await supabaseService.createUser({
      full_name: fullName.trim(),
      username: normalizedUsername,
      email: normalizedEmail, // may be null
      phone: phone || '',
      role: 'student', // 👈 always student, regardless of what was sent
      password_hash: passwordHash,
      is_active: true,
      created_at: new Date().toISOString(),
    });

    const token = signToken(user);

    console.log('✅ User registered:', user.username || user.email);

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

// ============================================================
// Regular login (accepts username OR email as `identifier`)
// ============================================================
async function login(req, res) {
  try {
    const {
      identifier, // preferred: username OR email
      email, // back-compat
      password,
      role = 'student',
    } = req.body;

    const raw = identifier || email;

    console.log('🔑 Login attempt:', raw);

    if (!raw || !password) {
      return res
        .status(400)
        .json({ error: 'Username (or email) and password are required' });
    }

    const user = await supabaseService.getUserByIdentifier(raw);

    if (!user) {
      console.log('❌ User not found:', raw);
      return res
        .status(401)
        .json({ error: 'Invalid username, password, or account type.' });
    }

    console.log('✅ User found:', user.username || user.email);

    if (user.role !== role) {
      console.log('❌ Role mismatch:', user.role, '!=', role);
      return res.status(401).json({
        error: `Invalid credentials for ${role} account.`,
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      console.log('❌ Invalid password for:', user.username || user.email);
      return res
        .status(401)
        .json({ error: 'Invalid username, password, or account type.' });
    }

    const admissionStatus =
      user.role === 'student'
        ? await getLatestAdmissionStatus(user.id)
        : null;

    if (user.role === 'student' && admissionStatus?.toLowerCase() !== 'approved') {
      return res.status(403).json({
        error: 'Admission is in progress. Your transfer is awaiting admin approval.',
        code: 'ADMISSION_PENDING',
      });
    }

    await supabaseService.update('users', user.id, {
      last_login: new Date().toISOString(),
    });

    const token = signToken(user);
    const userData = publicUser(user);

    console.log('✅ Login successful:', userData.username || userData.email);

    res.json({
      user: userData,
      token,
      message: `Welcome, ${userData.fullName || userData.username || userData.email}`,
      admissionStatus,
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      error: 'Login failed. Please try again.',
      details: error.message,
    });
  }
}

// ============================================================
// Google Login (ID Token Flow)
// ============================================================
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

    // 🔒 Only allow Google sign-up for students
    if (!user && role !== 'student') {
      return res.status(403).json({
        error: 'Staff and admin accounts are created by the administrator.',
      });
    }

    if (!user) {
      const newUser = await supabaseService.createUser({
        full_name: name || normalizedEmail.split('@')[0],
        email: normalizedEmail,
        role: 'student',
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

    const admissionStatus =
      user.role === 'student'
        ? await getLatestAdmissionStatus(user.id)
        : null;

    if (user.role === 'student' && admissionStatus?.toLowerCase() !== 'approved') {
      return res.status(403).json({
        error: 'Admission is in progress. Your transfer is awaiting admin approval.',
        code: 'ADMISSION_PENDING',
      });
    }

    const jwtToken = signToken(user);

    const userData = publicUser(user);
    res.json({
      user: userData,
      token: jwtToken,
      message: `Welcome, ${userData.fullName || userData.username || userData.email}`,
      admissionStatus,
    });
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({
      error: 'Google login failed. Please try again.',
      details: error.message,
    });
  }
}

// ============================================================
// Google OAuth Callback (Passport redirect flow)
// ============================================================
async function googleCallback(req, res) {
  try {
    const user = req.user;

    if (!user) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=oauth_failed`);
    }

    const admissionStatus =
      user.role === 'student'
        ? await getLatestAdmissionStatus(user.id)
        : null;

    if (user.role === 'student' && admissionStatus?.toLowerCase() !== 'approved') {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}/login?error=admission_pending`);
    }

    const token = signToken(user);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const welcomeName = encodeURIComponent(
      user.full_name || user.username || user.email
    );
    res.redirect(
      `${frontendUrl}/oauth-callback?token=${token}&welcome=${welcomeName}`
    );
  } catch (error) {
    console.error('Google Callback Error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/login?error=oauth_failed`);
  }
}

// ============================================================
// Get current user profile
// ============================================================
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

// ============================================================
// Update user profile
// ============================================================
async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const updates = { ...req.body };

    // Strip fields users must not change themselves
    delete updates.id;
    delete updates.password_hash;
    delete updates.created_at;
    delete updates.updated_at;
    delete updates.role;
    delete updates.is_active;
    delete updates.email_verified;
    delete updates.google_id;
    delete updates.last_login;

    // Username changes must go through the same slugify + uniqueness rules
    if (updates.username !== undefined) {
      const normalizedUsername = String(updates.username)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');

      if (normalizedUsername.length < 3 || normalizedUsername.length > 40) {
        return res.status(400).json({
          error: 'Username must be 3–40 characters (a-z, 0-9, dash).',
        });
      }

      const existing = await supabaseService.getUserByUsername(normalizedUsername);
      if (existing && existing.id !== userId) {
        return res.status(409).json({
          error: 'That username is already taken. Please choose another.',
        });
      }

      updates.username = normalizedUsername;
    }

    // Email changes must be unique and normalized
    if (updates.email !== undefined) {
      const raw = String(updates.email || '').trim().toLowerCase();
      if (!raw) {
        delete updates.email; // don't allow clearing email via profile update
      } else {
        const byEmail = await supabaseService.getUserByEmail(raw);
        if (byEmail && byEmail.id !== userId) {
          return res.status(409).json({
            error: 'An account with this email already exists.',
          });
        }
        updates.email = raw;
        // Force re-verification if you support it
        updates.email_verified = false;
      }
    }

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

// ============================================================
// Change password
// ============================================================
async function changePassword(req, res) {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: 'Current password and new password are required',
      });
    }

    if (newPassword.length < 8 || newPassword.length > 128) {
      return res.status(400).json({
        error: 'New password must be between 8 and 128 characters',
      });
    }

    const user = await supabaseService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isValidPassword = await bcrypt.compare(
      currentPassword,
      user.password_hash
    );
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

// ============================================================
// Request a one-time password reset link
// Accepts either `identifier` (username OR email) or `email`.
// Always responds with the same generic message.
// ============================================================
async function requestPasswordReset(req, res) {
  const rawIdentifier = String(
    req.body?.identifier || req.body?.email || ''
  ).trim();

  if (!rawIdentifier) {
    return res.status(400).json({ error: 'Username or email is required' });
  }

  try {
    // Resolve to a user record
    const user = await supabaseService.getUserByIdentifier(rawIdentifier);

    // Only proceed if we found a user AND they have an email on file
    if (user && user.email) {
      const email = user.email.trim().toLowerCase();

      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const now = new Date().toISOString();

      const { error: expireError } = await supabaseAdmin
        .from('password_reset_tokens')
        .update({ used_at: now })
        .eq('user_email', email)
        .is('used_at', null);
      if (expireError) throw expireError;

      const { error: insertError } = await supabaseAdmin
        .from('password_reset_tokens')
        .insert({
          user_email: email,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
      if (insertError) throw insertError;

      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173')
        .split(',')[0]
        .trim()
        .replace(/\/$/, '');
      const resetUrl = `${frontendUrl}/reset-password?token=${token}`;

      const emailInfo = await sendMail({
        to: email,
        subject: 'Reset your Clan of David account password',
        text: `We received a request to reset your password. Use this link within 30 minutes: ${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
        html: `<p>We received a request to reset your password.</p><p><a href="${resetUrl}">Choose a new password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>`,
      });

      if (!emailInfo) {
        console.warn('Password reset email could not be sent for account:', email);
      }
    }

    return res.json({ success: true, message: PASSWORD_RESET_RESPONSE });
  } catch (error) {
    console.error('Password reset request error:', error.message);
    return res
      .status(500)
      .json({ error: 'Unable to process password reset request' });
  }
}

// ============================================================
// Consume a reset token and set the new password
// ============================================================
async function resetPassword(req, res) {
  const { token, newPassword } = req.body || {};
  if (typeof token !== 'string' || !token || typeof newPassword !== 'string') {
    return res
      .status(400)
      .json({ error: 'Reset token and new password are required' });
  }
  if (newPassword.length < 8 || newPassword.length > 128) {
    return res
      .status(400)
      .json({ error: 'Password must be between 8 and 128 characters' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const passwordHash = await bcrypt.hash(newPassword, 12);

    const { data: reset, error } = await supabaseAdmin.rpc(
      'reset_password_with_token',
      {
        p_token_hash: tokenHash,
        p_password_hash: passwordHash,
      }
    );

    if (error) throw error;

    if (!reset) {
      return res.status(400).json({
        error: 'This password reset link is invalid, expired, or already used.',
      });
    }

    return res.json({
      success: true,
      message: 'Password updated. You can now log in.',
    });
  } catch (error) {
    console.error('Password reset error:', error.message);
    return res.status(500).json({ error: 'Unable to reset password' });
  }
}

// ============================================================
// Logout
// ============================================================
async function logout(req, res) {
  res.json({ message: 'Logged out successfully' });
}

// ============================================================
// Generate a strong but easy-to-read temporary password
// ============================================================
function generateTemporaryPassword(length = 12) {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(length);
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars[bytes[i] % chars.length];
  }
  return pass;
}

// ============================================================
// Admin-only: create a staff account and email credentials
// POST /api/auth/staff
// ============================================================
async function createStaff(req, res) {
  try {
    // Guard: only admins
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { fullName, email, phone, department } = req.body;

    if (!fullName || !email) {
      return res
        .status(400)
        .json({ error: 'Full name and email are required' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const existing = await supabaseService.getUserByEmail(normalizedEmail);
    if (existing) {
      return res
        .status(409)
        .json({ error: 'An account with this email already exists.' });
    }

    // Generate + hash the password
    const plainPassword = generateTemporaryPassword(12);
    const passwordHash = await bcrypt.hash(plainPassword, 12);

    // Create the staff user
    const user = await supabaseService.createUser({
      full_name: fullName.trim(),
      email: normalizedEmail,
      phone: phone || '',
      role: 'staff',
      password_hash: passwordHash,
      is_active: true,
      must_change_password: true, // optional flag — add the column if you want to enforce
      department: department || null,
      created_at: new Date().toISOString(),
    });

    // Email the credentials
    try {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const loginUrl = `${frontendUrl}/login?role=staff&email=${encodeURIComponent(
        normalizedEmail
      )}`;

      await sendMail({
        to: normalizedEmail,
        subject: 'Your Clan of David Academy Staff Account',
        html: `
          <!DOCTYPE html>
          <html>
            <body style="margin:0;padding:0;background:#F5F9FF;font-family:Arial,sans-serif;">
              <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;">
                <tr>
                  <td align="center">
                    <table width="560" cellpadding="0" cellspacing="0"
                      style="background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,0.06);overflow:hidden;">
                      <tr>
                        <td style="background:linear-gradient(135deg,#1A73E8 0%,#FF2E96 100%);padding:28px;text-align:center;">
                          <h1 style="margin:0;color:#fff;font-size:20px;">Clan of David Art &amp; Music Academy</h1>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:28px;">
                          <h2 style="margin:0 0 12px;color:#1e293b;">Welcome aboard, ${fullName}!</h2>
                          <p style="color:#334155;font-size:15px;line-height:1.6;">
                            An administrator has created a staff account for you. Use the credentials below to sign in.
                          </p>
                          <div style="background:#F5F9FF;border:1px solid #BFDBFE;border-radius:10px;padding:16px;margin:20px 0;">
                            <p style="margin:0 0 8px;font-size:14px;"><strong>Email:</strong> ${normalizedEmail}</p>
                            <p style="margin:0;font-size:14px;"><strong>Temporary password:</strong>
                              <code style="background:#EFF6FF;padding:2px 6px;border-radius:4px;font-size:14px;">${plainPassword}</code>
                            </p>
                          </div>
                          <p style="color:#dc2626;font-size:13px;font-weight:600;">
                            ⚠️ For security, please change your password immediately after your first login.
                          </p>
                          <p style="text-align:center;margin:28px 0 8px;">
                            <a href="${loginUrl}"
                              style="background:linear-gradient(135deg,#1A73E8 0%,#FF2E96 100%);color:#fff;text-decoration:none;padding:13px 34px;border-radius:999px;font-weight:700;font-size:15px;">
                              Log in to your account →
                            </a>
                          </p>
                          <p style="color:#64748b;font-size:12px;text-align:center;">
                            Or copy this link:<br>
                            <a href="${loginUrl}" style="color:#1A73E8;word-break:break-all;">${loginUrl}</a>
                          </p>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:20px;text-align:center;border-top:1px solid #E2E8F0;">
                          <p style="margin:0;color:#94a3b8;font-size:12px;">
                            Clan of David Art &amp; Music Academy · Abuja, Nigeria
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </body>
          </html>
        `,
      });
    } catch (emailErr) {
      console.warn('⚠️ Staff credentials email failed:', emailErr.message);
      // Continue — admin still gets the password in the response
    }

    // Return the temporary password to the admin (shown ONCE)
    return res.status(201).json({
      success: true,
      message: 'Staff account created and credentials emailed.',
      user: publicUser(user),
      temporaryPassword: plainPassword,
    });
  } catch (error) {
    console.error('❌ createStaff error:', error);
    return res.status(500).json({
      error: 'Failed to create staff account',
      details: error.message,
    });
  }
}

// ============================================================
// Exports
// ============================================================
module.exports = {
  register,
  login,
  googleLogin,
  googleCallback,
  getProfile,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
  logout,
  createStaff,
  publicUser,
};
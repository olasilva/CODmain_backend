// src/controllers/uploadController.js
const { supabaseAdmin } = require('../config/supabase');

// ============================================================
// POST /api/upload/avatar  (authenticated)
// Uploads the current user's avatar and updates their profile.
// Expects multipart/form-data with field name "file".
// ============================================================
async function uploadAvatar(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // express-fileupload puts files in req.files
    const file = req.files?.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Support express-fileupload's array format (if multiple)
    const uploaded = Array.isArray(file) ? file[0] : file;

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(uploaded.mimetype)) {
      return res.status(400).json({
        error: 'Invalid file type. Use JPG, PNG, or WEBP.',
      });
    }

    if (uploaded.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large. Max 5 MB.' });
    }

    const ext = (uploaded.name.split('.').pop() || 'jpg').toLowerCase();
    const filename = `${userId}-${Date.now()}.${ext}`;

    // Upload to Supabase Storage bucket "avatars"
    const { error: upErr } = await supabaseAdmin.storage
      .from('avatars')
      .upload(filename, uploaded.data, {
        contentType: uploaded.mimetype,
        upsert: true,
      });

    if (upErr) throw upErr;

    // Build the public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(filename);

    const avatarUrl = urlData.publicUrl;

    // Persist on the user row
    const { error: dbErr } = await supabaseAdmin
      .from('users')
      .update({
        avatar_url: avatarUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId);

    if (dbErr) throw dbErr;

    res.json({ success: true, avatar_url: avatarUrl });
  } catch (error) {
    console.error('❌ uploadAvatar error:', error.message);
    res.status(500).json({
      error: 'Failed to upload avatar',
      details: error.message,
    });
  }
}

// ============================================================
// POST /api/upload/avatar-public  (public — for registration)
// Same as above but takes userId from body instead of the JWT.
// ============================================================
async function uploadAvatarPublic(req, res) {
  try {
    const userId = req.body?.userId;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const file = req.files?.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploaded = Array.isArray(file) ? file[0] : file;

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(uploaded.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    if (uploaded.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 5 MB)' });
    }

    const ext = (uploaded.name.split('.').pop() || 'jpg').toLowerCase();
    const filename = `${userId}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from('avatars')
      .upload(filename, uploaded.data, {
        contentType: uploaded.mimetype,
        upsert: true,
      });

    if (upErr) throw upErr;

    const { data: urlData } = supabaseAdmin.storage
      .from('avatars')
      .getPublicUrl(filename);

    const avatarUrl = urlData.publicUrl;

    const { error: dbErr } = await supabaseAdmin
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', userId);

    if (dbErr) throw dbErr;

    res.json({ success: true, avatar_url: avatarUrl });
  } catch (error) {
    console.error('❌ uploadAvatarPublic error:', error.message);
    res.status(500).json({
      error: 'Failed to upload avatar',
      details: error.message,
    });
  }
}

// ============================================================
// POST /api/upload/blog-cover  (admin only)
// Accepts a single image and returns its public URL.
// ============================================================
async function uploadBlogCover(req, res) {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const file = req.files?.file;
    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploaded = Array.isArray(file) ? file[0] : file;

    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowed.includes(uploaded.mimetype)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }

    if (uploaded.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'File too large (max 5 MB)' });
    }

    const ext = (uploaded.name.split('.').pop() || 'jpg').toLowerCase();
    const filename = `cover-${Date.now()}-${Math.floor(
      Math.random() * 10000
    )}.${ext}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from('blog')
      .upload(filename, uploaded.data, {
        contentType: uploaded.mimetype,
        upsert: false,
      });
    if (upErr) throw upErr;

    const { data: urlData } = supabaseAdmin.storage
      .from('blog')
      .getPublicUrl(filename);

    res.json({ success: true, url: urlData.publicUrl });
  } catch (error) {
    console.error('❌ uploadBlogCover error:', error.message);
    res.status(500).json({
      error: 'Failed to upload cover',
      details: error.message,
    });
  }
}

module.exports = {
  uploadAvatar,
  uploadAvatarPublic,
  uploadBlogCover,
};
// src/controllers/messageController.js
const { supabaseAdmin } = require('../config/supabase');

// ============================================================
// GET /api/student/messages
// ============================================================
async function getMessages(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // 1. Fetch all messages involving this user
    const { data: messages, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .or(`recipient_id.eq.${userId},sender_id.eq.${userId}`)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // 2. Collect every user_id we need to look up
    const otherUserIds = new Set();
    (messages || []).forEach((m) => {
      if (m.sender_id && m.sender_id !== userId) otherUserIds.add(m.sender_id);
      if (m.recipient_id && m.recipient_id !== userId) otherUserIds.add(m.recipient_id);
    });

    // 3. Look up those users in bulk
    let userMap = {};
    if (otherUserIds.size > 0) {
      const { data: users } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, role, avatar_url')
        .in('id', [...otherUserIds]);

      (users || []).forEach((u) => {
        userMap[u.id] = u;
      });
    }

    // 4. Enrich messages with sender / recipient info
    const enriched = (messages || []).map((m) => {
      const sender = m.sender_id === userId
        ? { id: userId, full_name: 'You', role: 'self' }
        : userMap[m.sender_id] || null;

      const recipient = m.recipient_id === userId
        ? { id: userId, full_name: 'You', role: 'self' }
        : userMap[m.recipient_id] || null;

      return {
        id: m.id,
        body: m.body,
        subject: m.subject,
        is_read: m.is_read,
        created_at: m.created_at,
        sender_id: m.sender_id,
        recipient_id: m.recipient_id,
        student_id: m.student_id,
        sender,
        recipient,
        // Frontend uses this to decide left vs right bubble
        is_own: m.sender_id === userId,
      };
    });

    res.json({ success: true, messages: enriched });
  } catch (error) {
    console.error('❌ Get messages error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch messages',
      details: error.message,
    });
  }
}

// ============================================================
// POST /api/student/messages
// ============================================================
async function sendMessage(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { recipient_id, recipientId, subject, body, content } = req.body || {};
    const recipient = recipient_id || recipientId || null;
    const messageBody = (body || content || '').trim();

    if (!messageBody) {
      return res.status(400).json({ error: 'Message body is required' });
    }

    let finalRecipient = recipient;
    if (!finalRecipient) {
      const { data: adminRows } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('role', 'admin')
        .limit(1);
      finalRecipient = adminRows?.[0]?.id || null;
    }

    if (!finalRecipient) {
      return res
        .status(400)
        .json({ error: 'No recipient available. Please specify recipient_id.' });
    }

    // Try to find the student row for this user
    const { data: sRows } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);
    const studentId = sRows?.[0]?.id || null;

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert([
        {
          sender_id: userId,
          recipient_id: finalRecipient,
          student_id: studentId,
          subject: subject || null,
          body: messageBody,
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ success: true, message: data });
  } catch (error) {
    console.error('❌ Send message error:', error.message);
    res.status(500).json({
      error: 'Failed to send message',
      details: error.message,
    });
  }
}

// ============================================================
// PUT /api/student/messages/:messageId/read
// ============================================================
async function markAsRead(req, res) {
  try {
    const userId = req.user?.id;
    const { messageId } = req.params;

    const { data: rows, error: fErr } = await supabaseAdmin
      .from('messages')
      .select('id, recipient_id')
      .eq('id', messageId)
      .limit(1);
    if (fErr) throw fErr;

    const msg = rows?.[0];
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.recipient_id !== userId) {
      return res.status(403).json({ error: 'Not your message' });
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .update({ is_read: true })
      .eq('id', messageId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, message: data });
  } catch (error) {
    console.error('❌ Mark message read error:', error.message);
    res.status(500).json({
      error: 'Failed to mark message as read',
      details: error.message,
    });
  }
}

// ============================================================
// GET /api/student/messages/unread-count
// ============================================================
async function getUnreadCount(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { count, error } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', userId)
      .eq('is_read', false);

    if (error) throw error;

    res.json({ success: true, unread: count || 0 });
  } catch (error) {
    console.error('❌ Get unread count error:', error.message);
    res.status(500).json({
      error: 'Failed to fetch unread count',
      details: error.message,
    });
  }
}

module.exports = {
  getMessages,
  sendMessage,
  markAsRead,
  getUnreadCount,
};
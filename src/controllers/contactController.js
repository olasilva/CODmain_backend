// src/controllers/contactController.js
const { supabaseAdmin } = require('../config/supabase');
const { sendMail } = require('../services/emailService');

const FRONTEND_URL = process.env.FRONTEND_URL?.split(',')[0] || 'http://localhost:5173';

// Shared branded wrapper for emails
function emailShell(title, bodyHtml) {
  return `
    <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;background:#ffffff;">
      <div style="text-align:center;margin-bottom:20px;">
        <h1 style="color:#1A73E8;margin:0;font-size:20px;">Clan of David</h1>
        <p style="color:#94a3b8;font-size:12px;margin:4px 0 0;">Art &amp; Music Academy</p>
      </div>
      <h2 style="color:#1A73E8;margin:0 0 12px;font-size:18px;">${title}</h2>
      ${bodyHtml}
      <p style="color:#94a3b8;font-size:12px;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px;">
        — Clan of David Art &amp; Music Academy<br/>
        <a href="${FRONTEND_URL}" style="color:#1A73E8;">${FRONTEND_URL}</a>
      </p>
    </div>
  `;
}

class ContactController {
  // ═══════════════════════════════════════════════════════════
  // PUBLIC — submit contact form
  // POST /api/contact
  // ═══════════════════════════════════════════════════════════
  async submitMessage(req, res) {
    try {
      const { name, email, phone, subject, message } = req.body || {};

      if (!name || !email || !message) {
        return res
          .status(400)
          .json({ error: 'Name, email, and message are required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }

      const clean = {
        name: String(name).trim(),
        email: String(email).trim().toLowerCase(),
        phone: phone ? String(phone).trim() : null,
        subject: subject ? String(subject).trim() : null,
        message: String(message).trim(),
      };

      // 1. Save to Supabase
      const { data, error } = await supabaseAdmin
        .from('contact_messages')
        .insert([clean])
        .select()
        .single();

      if (error) throw error;

      // 2. Auto-reply to the person who submitted the form
      try {
        const firstName = clean.name.split(' ')[0] || 'there';
        await sendMail({
          to: clean.email,
          subject: '✅ We received your message — Clan of David Academy',
          text:
            `Hello ${firstName},\n\n` +
            `Thank you for reaching out to Clan of David Art and Music Academy.\n\n` +
            `We've received your message and will get back to you shortly.\n\n` +
            `For your records, here's what you sent us:\n` +
            `"${clean.message}"\n\n` +
            `— Clan of David Art and Music Academy`,
          html: emailShell(
            'We received your message',
            `
              <p style="color:#334155;">Hello ${firstName},</p>
              <p style="color:#334155;">
                Thank you for reaching out to <strong>Clan of David Art and Music Academy</strong>.
                We've received your message and will get back to you as soon as possible — usually within 1–2 business days.
              </p>
              <div style="background:#F5F9FF;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:16px 0;">
                <p style="margin:0 0 8px;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">
                  Your message
                </p>
                ${clean.subject ? `<p style="margin:0 0 6px;color:#475569;"><strong>Subject:</strong> ${clean.subject}</p>` : ''}
                <p style="margin:0;color:#334155;white-space:pre-wrap;">${clean.message}</p>
              </div>
              <p style="color:#334155;">
                If you'd like to reach us sooner, feel free to reply directly to this email.
              </p>
              <p style="color:#334155;">Warm regards,<br/>The Clan of David Team</p>
            `
          ),
        });
      } catch (mailErr) {
        console.warn('⚠️ Auto-reply email failed:', mailErr.message);
      }

      // 3. Notify every admin that a new message arrived
      try {
        const { data: admins } = await supabaseAdmin
          .from('users')
          .select('email')
          .eq('role', 'admin');

        const recipientEmails = (admins || []).map((a) => a.email).filter(Boolean);

        if (recipientEmails.length) {
          const adminHtml = emailShell(
            'New contact message',
            `
              <p style="color:#334155;"><strong>From:</strong> ${clean.name} &lt;${clean.email}&gt;</p>
              ${clean.phone ? `<p style="color:#334155;"><strong>Phone:</strong> ${clean.phone}</p>` : ''}
              ${clean.subject ? `<p style="color:#334155;"><strong>Subject:</strong> ${clean.subject}</p>` : ''}
              <div style="background:#F5F9FF;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:16px 0;white-space:pre-wrap;color:#334155;">
                ${clean.message.replace(/[<>]/g, '')}
              </div>
              <p style="color:#94a3b8;font-size:12px;">
                Reply from the admin dashboard: <a href="${FRONTEND_URL}/admin/messages" style="color:#1A73E8;">${FRONTEND_URL}/admin/messages</a>
              </p>
            `
          );

          await Promise.allSettled(
            recipientEmails.map((to) =>
              sendMail({
                to,
                subject: `📬 New contact: ${clean.subject || clean.name}`,
                text: `From ${clean.name} <${clean.email}>\n\n${clean.message}`,
                html: adminHtml,
              })
            )
          );
        }
      } catch (mailErr) {
        console.warn('⚠️ Admin notify failed:', mailErr.message);
      }

      return res.status(201).json({
        success: true,
        message: 'Message received. We will get back to you shortly.',
        id: data.id,
      });
    } catch (err) {
      console.error('❌ submitMessage error:', err.message);
      return res
        .status(500)
        .json({ error: 'Failed to send message', details: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN — list all messages
  // GET /api/admin/contact-messages
  // ═══════════════════════════════════════════════════════════
  async listMessages(req, res) {
    try {
      const { unread } = req.query;
      let query = supabaseAdmin
        .from('contact_messages')
        .select('*')
        .order('created_at', { ascending: false });

      if (unread === 'true') query = query.eq('is_read', false);

      const { data, error } = await query;
      if (error) throw error;

      const all = data || [];
      const unreadCount = all.filter((m) => !m.is_read).length;

      return res.json({
        success: true,
        messages: all,
        total: all.length,
        unreadCount,
      });
    } catch (err) {
      console.error('❌ listMessages error:', err.message);
      return res
        .status(500)
        .json({ error: 'Failed to fetch messages', details: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN — mark as read
  // PUT /api/admin/contact-messages/:id/read
  // ═══════════════════════════════════════════════════════════
  async markRead(req, res) {
    try {
      const { id } = req.params;
      const { data, error } = await supabaseAdmin
        .from('contact_messages')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, message: data });
    } catch (err) {
      console.error('❌ markRead error:', err.message);
      return res
        .status(500)
        .json({ error: 'Failed to mark as read', details: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN — reply to message
  // POST /api/admin/contact-messages/:id/reply
  // Body: { replyText, markRead? }
  // ═══════════════════════════════════════════════════════════
  async replyToMessage(req, res) {
    try {
      const { id } = req.params;
      const { replyText, markRead = true } = req.body || {};

      if (!replyText || !String(replyText).trim()) {
        return res.status(400).json({ error: 'Reply text is required' });
      }

      // Load the original message
      const { data: original, error: fetchErr } = await supabaseAdmin
        .from('contact_messages')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchErr || !original) {
        return res.status(404).json({ error: 'Message not found' });
      }

      const replyBody = String(replyText).trim();
      const admin = req.user || {};

      // Send the reply email to the person who contacted us
      let emailed = false;
      try {
        await sendMail({
          to: original.email,
          subject: `Re: ${original.subject || 'Your message to Clan of David'}`,
          text:
            `Hello ${original.name},\n\n${replyBody}\n\n` +
            `— Clan of David Art and Music Academy`,
          html: emailShell(
            'Re: Your message to Clan of David',
            `
              <p style="color:#334155;">Hello ${original.name},</p>
              <div style="background:#F5F9FF;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:16px 0;white-space:pre-wrap;color:#334155;">
                ${replyBody.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
              </div>
              <p style="color:#94a3b8;font-size:12px;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:20px;">
                <strong>Your original message:</strong><br/>
                ${String(original.message).replace(/</g, '&lt;').replace(/>/g, '&gt;')}
              </p>
            `
          ),
        });
        emailed = true;
      } catch (mailErr) {
        console.warn('⚠️ Reply email failed:', mailErr.message);
      }

      // Update the message row: record the reply + mark read
      const updates = {
        admin_reply: replyBody,
        admin_reply_at: new Date().toISOString(),
        admin_reply_by: admin.email || admin.id || null,
      };
      if (markRead) {
        updates.is_read = true;
        updates.read_at = new Date().toISOString();
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('contact_messages')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (updateErr) throw updateErr;

      return res.json({
        success: true,
        emailed,
        message: updated,
      });
    } catch (err) {
      console.error('❌ replyToMessage error:', err.message);
      return res
        .status(500)
        .json({ error: 'Failed to send reply', details: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ADMIN — delete
  // DELETE /api/admin/contact-messages/:id
  // ═══════════════════════════════════════════════════════════
  async deleteMessage(req, res) {
    try {
      const { id } = req.params;
      const { error } = await supabaseAdmin
        .from('contact_messages')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return res.json({ success: true });
    } catch (err) {
      console.error('❌ deleteMessage error:', err.message);
      return res
        .status(500)
        .json({ error: 'Failed to delete message', details: err.message });
    }
  }
}

module.exports = new ContactController();
// src/controllers/notificationController.js
const { supabaseAdmin } = require('../config/supabase');

class NotificationController {
  // ============================================================
  // Internal helpers — STUDENT notifications
  // ============================================================

  async pushNotification({
    studentId,
    title,
    message,
    type = 'info',
    link = null,
  }) {
    if (!studentId || !title || !message) {
      throw new Error('pushNotification requires studentId, title, and message');
    }

    const { data, error } = await supabaseAdmin
      .from('notifications')
      .insert([{ student_id: studentId, title, message, type, link }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async pushMany(notifications = []) {
    if (!notifications.length) return { succeeded: 0, failed: 0 };

    const results = await Promise.allSettled(
      notifications.map((n) => this.pushNotification(n))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    if (failed) {
      const errors = results
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason?.message || String(r.reason));
      console.warn(`pushMany: ${failed}/${results.length} failed`, errors);
    }

    return { succeeded, failed };
  }

  // ============================================================
  // Internal helpers — STAFF notifications
  // ============================================================

  async pushStaffNotification({
    staffId,
    title,
    message,
    type = 'general',
    link = null,
    meta = {},
  }) {
    if (!staffId || !title || !message) {
      throw new Error('pushStaffNotification needs staffId, title, message');
    }

    const { data, error } = await supabaseAdmin
      .from('staff_notifications')
      .insert([{ staff_id: staffId, title, message, type, link, meta }])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async pushStaffMany(notifications = []) {
    if (!notifications.length) return { succeeded: 0, failed: 0 };

    const results = await Promise.allSettled(
      notifications.map((n) => this.pushStaffNotification(n))
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - succeeded;

    if (failed) {
      const errors = results
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason?.message || String(r.reason));
      console.warn(`pushStaffMany: ${failed}/${results.length} failed`, errors);
    }

    return { succeeded, failed };
  }

  // ============================================================
  // STUDENT route handlers
  // ============================================================

  // GET /api/student/notifications
  async getNotifications(req, res) {
    try {
      const userId = req.user.id;

      const { data: student, error: studentError } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (studentError || !student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: notifications, error } = await supabaseAdmin
        .from('notifications')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.json(notifications || []);
    } catch (error) {
      console.error('Get notifications error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  }

  // PUT /api/student/notifications/:notificationId/read
  async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;

      const { data: notification, error } = await supabaseAdmin
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId)
        .select()
        .single();

      if (error) throw error;

      return res.json({
        message: 'Notification marked as read',
        notification,
      });
    } catch (error) {
      console.error('Mark as read error:', error.message);
      return res
        .status(500)
        .json({ error: 'Failed to mark notification as read' });
    }
  }

  // PUT /api/student/notifications/read-all
  async markAllAsRead(req, res) {
    try {
      const userId = req.user.id;

      const { data: student, error: studentError } = await supabaseAdmin
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (studentError || !student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { error } = await supabaseAdmin
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('student_id', student.id)
        .eq('is_read', false);

      if (error) throw error;

      return res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Mark all as read error:', error.message);
      return res.status(500).json({ error: 'Failed to mark all as read' });
    }
  }

  // POST /api/admin/notifications
  // Body: { studentId, title, message, type?, link? }
  async createNotification(req, res) {
    try {
      const { studentId, title, message, type, link } = req.body;

      if (!studentId || !title || !message) {
        return res.status(400).json({
          error: 'studentId, title, and message are required',
        });
      }

      const notification = await this.pushNotification({
        studentId,
        title,
        message,
        type: type || 'info',
        link: link || null,
      });

      return res.status(201).json({
        message: 'Notification created successfully',
        notification,
      });
    } catch (error) {
      console.error('Create notification error:', error.message);
      return res.status(500).json({ error: 'Failed to create notification' });
    }
  }

  // ============================================================
  // STAFF route handlers
  // ============================================================

  // GET /api/staff/notifications
  async getStaffNotifications(req, res) {
    try {
      const staffId = req.user.id;

      const { data, error } = await supabaseAdmin
        .from('staff_notifications')
        .select('*')
        .eq('staff_id', staffId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const list = data || [];
      const unreadCount = list.filter((n) => !n.is_read).length;

      return res.json({ success: true, notifications: list, unreadCount });
    } catch (error) {
      console.error('getStaffNotifications error:', error.message);
      return res
        .status(500)
        .json({ error: 'Failed to fetch notifications' });
    }
  }

  // PUT /api/staff/notifications/:id/read
  async markStaffNotificationRead(req, res) {
    try {
      const { id } = req.params;

      const { data, error } = await supabaseAdmin
        .from('staff_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id)
        .eq('staff_id', req.user.id)
        .select()
        .single();

      if (error) throw error;
      return res.json({ success: true, notification: data });
    } catch (error) {
      console.error('markStaffNotificationRead error:', error.message);
      return res
        .status(500)
        .json({ error: 'Failed to mark as read' });
    }
  }

  // PUT /api/staff/notifications/read-all
  async markAllStaffNotificationsRead(req, res) {
    try {
      const { error } = await supabaseAdmin
        .from('staff_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('staff_id', req.user.id)
        .eq('is_read', false);

      if (error) throw error;
      return res.json({ success: true });
    } catch (error) {
      console.error('markAllStaffNotificationsRead error:', error.message);
      return res
        .status(500)
        .json({ error: 'Failed to mark all as read' });
    }
  }
}

module.exports = new NotificationController();
// src/controllers/notificationController.js
const supabaseService = require('../services/supabaseService');

class NotificationController {
  // ============================================================
  // Internal helpers (callable from other controllers)
  // ============================================================

  /**
   * Insert one notification row into Supabase.
   * Throws on error so callers can catch.
   */
  async pushNotification({ studentId, title, message, type = 'info', link = null }) {
    if (!studentId || !title || !message) {
      throw new Error('pushNotification requires studentId, title, and message');
    }

    const { data, error } = await supabaseService.client
      .from('notifications')
      .insert([
        {
          student_id: studentId,
          title,
          message,
          type,
          link,
        },
      ])
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Insert many notifications. Never throws — logs failures and
   * returns a summary so the caller can decide what to do.
   */
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
  // Route handlers
  // ============================================================

  // GET /api/student/notifications
  async getNotifications(req, res) {
    try {
      const userId = req.user.id;

      const { data: student, error: studentError } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (studentError || !student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: notifications, error } = await supabaseService.client
        .from('notifications')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return res.json(notifications || []);
    } catch (error) {
      console.error('Get notifications error:', error);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  }

  // PUT /api/student/notifications/:notificationId/read
  async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;

      const { data: notification, error } = await supabaseService.client
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('id', notificationId)
        .select()
        .single();

      if (error) throw error;

      return res.json({
        message: 'Notification marked as read',
        notification,
      });
    } catch (error) {
      console.error('Mark as read error:', error);
      return res
        .status(500)
        .json({ error: 'Failed to mark notification as read' });
    }
  }

  // PUT /api/student/notifications/read-all
  async markAllAsRead(req, res) {
    try {
      const userId = req.user.id;

      const { data: student, error: studentError } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (studentError || !student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { error } = await supabaseService.client
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString(),
        })
        .eq('student_id', student.id)
        .eq('is_read', false);

      if (error) throw error;

      return res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Mark all as read error:', error);
      return res.status(500).json({ error: 'Failed to mark all as read' });
    }
  }

  // POST /api/admin/notifications   (or wherever you mount it)
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
      console.error('Create notification error:', error);
      return res.status(500).json({ error: 'Failed to create notification' });
    }
  }
}

module.exports = new NotificationController();
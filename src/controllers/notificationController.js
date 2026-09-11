const supabaseService = require('../services/supabaseService');

class NotificationController {
  // Get student notifications
  async getNotifications(req, res) {
    try {
      const userId = req.user.id;
      
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: notifications, error } = await supabaseService.client
        .from('notifications')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json(notifications);
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  }

  // Mark notification as read
  async markAsRead(req, res) {
    try {
      const { notificationId } = req.params;
      
      const { data: notification, error } = await supabaseService.client
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', notificationId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: 'Notification marked as read',
        notification
      });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  }

  // Mark all as read
  async markAllAsRead(req, res) {
    try {
      const userId = req.user.id;
      
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      await supabaseService.client
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('student_id', student.id)
        .eq('is_read', false);

      res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Mark all as read error:', error);
      res.status(500).json({ error: 'Failed to mark all as read' });
    }
  }

  // Create notification (admin/staff)
  async createNotification(req, res) {
    try {
      const { studentId, title, message, type, link } = req.body;

      const { data: notification, error } = await supabaseService.client
        .from('notifications')
        .insert([{
          student_id: studentId,
          title,
          message,
          type: type || 'info',
          link: link || null
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: 'Notification created successfully',
        notification
      });
    } catch (error) {
      console.error('Create notification error:', error);
      res.status(500).json({ error: 'Failed to create notification' });
    }
  }
}

module.exports = new NotificationController();
const supabaseService = require('../services/supabaseService');

class MessageController {
  // Get student messages
  async getMessages(req, res) {
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

      const { data: messages, error } = await supabaseService.client
        .from('student_messages')
        .select(`
          *,
          sender:sender_id (full_name, email, avatar_url)
        `)
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json(messages);
    } catch (error) {
      console.error('Get messages error:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  }

  // Send message
  async sendMessage(req, res) {
    try {
      const userId = req.user.id;
      const { studentId, subject, message, category, priority } = req.body;

      const { data: newMessage, error } = await supabaseService.client
        .from('student_messages')
        .insert([{
          student_id: studentId,
          sender_id: userId,
          subject,
          message,
          category: category || 'general',
          priority: priority || 'normal'
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: 'Message sent successfully',
        data: newMessage
      });
    } catch (error) {
      console.error('Send message error:', error);
      res.status(500).json({ error: 'Failed to send message' });
    }
  }

  // Mark message as read
  async markAsRead(req, res) {
    try {
      const { messageId } = req.params;
      
      const { data: message, error } = await supabaseService.client
        .from('student_messages')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', messageId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: 'Message marked as read',
        data: message
      });
    } catch (error) {
      console.error('Mark as read error:', error);
      res.status(500).json({ error: 'Failed to mark message as read' });
    }
  }

  // Get unread count
  async getUnreadCount(req, res) {
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

      const { count, error } = await supabaseService.client
        .from('student_messages')
        .select('*', { count: 'exact', head: true })
        .eq('student_id', student.id)
        .eq('is_read', false);

      if (error) throw error;

      res.json({ unread_count: count });
    } catch (error) {
      console.error('Get unread count error:', error);
      res.status(500).json({ error: 'Failed to get unread count' });
    }
  }
}

module.exports = new MessageController();
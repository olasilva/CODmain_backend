const supabaseService = require('../services/supabaseService');

class AdminController {
  // Get all students with pagination
  async getStudents(req, res) {
    try {
      const { page = 1, limit = 20, search = '' } = req.query;
      const offset = (page - 1) * limit;

      let query = supabaseService.client
        .from('students')
        .select(`
          *,
          user:user_id (full_name, email, phone, avatar_url),
          enrollments:enrollments (programme:programme_id (title, code), status)
        `, { count: 'exact' });

      if (search) {
        query = query.or(`student_id.ilike.%${search}%,user.full_name.ilike.%${search}%,user.email.ilike.%${search}%`);
      }

      const { data: students, error, count } = await query
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        data: students,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      });
    } catch (error) {
      console.error('Get students error:', error);
      res.status(500).json({ error: 'Failed to fetch students' });
    }
  }

  // Get student details
  async getStudentDetails(req, res) {
    try {
      const { studentId } = req.params;

      const { data: student, error } = await supabaseService.client
        .from('students')
        .select(`
          *,
          user:user_id (*),
          enrollments:enrollments (
            *,
            programme:programme_id (*),
            class:class_id (*)
          ),
          payments:payments (*),
          results:results (*)
        `)
        .eq('id', studentId)
        .single();

      if (error) throw error;

      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      // Remove password hash
      if (student.user) {
        delete student.user.password_hash;
      }

      res.json(student);
    } catch (error) {
      console.error('Get student details error:', error);
      res.status(500).json({ error: 'Failed to fetch student details' });
    }
  }

  // Update student
  async updateStudent(req, res) {
    try {
      const { studentId } = req.params;
      const updates = req.body;

      // Remove sensitive fields
      delete updates.id;
      delete updates.created_at;

      const { data: student, error } = await supabaseService.client
        .from('students')
        .update(updates)
        .eq('id', studentId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: 'Student updated successfully',
        student
      });
    } catch (error) {
      console.error('Update student error:', error);
      res.status(500).json({ error: 'Failed to update student' });
    }
  }

  // Delete student
  async deleteStudent(req, res) {
    try {
      const { studentId } = req.params;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('user_id')
        .eq('id', studentId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      // Delete student (cascade will handle related data)
      await supabaseService.client
        .from('students')
        .delete()
        .eq('id', studentId);

      // Delete user
      await supabaseService.client
        .from('users')
        .delete()
        .eq('id', student.user_id);

      res.json({ message: 'Student deleted successfully' });
    } catch (error) {
      console.error('Delete student error:', error);
      res.status(500).json({ error: 'Failed to delete student' });
    }
  }

  // Get all programmes
  async getProgrammes(req, res) {
    try {
      const { data: programmes, error } = await supabaseService.client
        .from('programmes')
        .select('*, enrollments:enrollments(count)')
        .order('title');

      if (error) throw error;

      res.json(programmes);
    } catch (error) {
      console.error('Get programmes error:', error);
      res.status(500).json({ error: 'Failed to fetch programmes' });
    }
  }

  // Create programme
  async createProgramme(req, res) {
    try {
      const data = req.body;

      const { data: programme, error } = await supabaseService.client
        .from('programmes')
        .insert([data])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: 'Programme created successfully',
        programme
      });
    } catch (error) {
      console.error('Create programme error:', error);
      res.status(500).json({ error: 'Failed to create programme' });
    }
  }

  // Update programme
  async updateProgramme(req, res) {
    try {
      const { programmeId } = req.params;
      const updates = req.body;

      delete updates.id;
      delete updates.created_at;

      const { data: programme, error } = await supabaseService.client
        .from('programmes')
        .update(updates)
        .eq('id', programmeId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: 'Programme updated successfully',
        programme
      });
    } catch (error) {
      console.error('Update programme error:', error);
      res.status(500).json({ error: 'Failed to update programme' });
    }
  }

  // Delete programme
  async deleteProgramme(req, res) {
    try {
      const { programmeId } = req.params;

      await supabaseService.client
        .from('programmes')
        .delete()
        .eq('id', programmeId);

      res.json({ message: 'Programme deleted successfully' });
    } catch (error) {
      console.error('Delete programme error:', error);
      res.status(500).json({ error: 'Failed to delete programme' });
    }
  }

  // Get dashboard statistics
  async getStats(req, res) {
    try {
      // Total students
      const { count: totalStudents } = await supabaseService.client
        .from('students')
        .select('*', { count: 'exact', head: true });

      // Total programmes
      const { count: totalProgrammes } = await supabaseService.client
        .from('programmes')
        .select('*', { count: 'exact', head: true });

      // Total staff
      const { count: totalStaff } = await supabaseService.client
        .from('staff')
        .select('*', { count: 'exact', head: true });

      // Recent enrollments
      const { data: recentEnrollments } = await supabaseService.client
        .from('enrollments')
        .select(`
          *,
          student:student_id (user:user_id (full_name)),
          programme:programme_id (title)
        `)
        .order('created_at', { ascending: false })
        .limit(5);

      // Revenue stats
      const { data: revenueData } = await supabaseService.client
        .from('payments')
        .select('amount, status')
        .eq('status', 'completed');

      const totalRevenue = revenueData?.reduce((sum, p) => sum + p.amount, 0) || 0;

      // Pending admissions
      const { count: pendingAdmissions } = await supabaseService.client
        .from('admissions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      res.json({
        stats: {
          totalStudents,
          totalProgrammes,
          totalStaff,
          totalRevenue,
          pendingAdmissions
        },
        recentEnrollments: recentEnrollments || []
      });
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({ error: 'Failed to fetch statistics' });
    }
  }
}

module.exports = new AdminController();
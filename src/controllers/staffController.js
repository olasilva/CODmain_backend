const supabaseService = require('../services/supabaseService');

class StaffController {
  // Get all staff (admin only)
  async getAllStaff(req, res) {
    try {
      const { page = 1, limit = 20, search = '' } = req.query;
      const offset = (page - 1) * limit;

      let query = supabaseService.client
        .from('staff')
        .select(`
          *,
          user:user_id (full_name, email, phone, avatar_url)
        `, { count: 'exact' });

      if (search) {
        query = query.or(`staff_id.ilike.%${search}%,user.full_name.ilike.%${search}%,user.email.ilike.%${search}%`);
      }

      const { data: staff, error, count } = await query
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json({
        data: staff,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: count,
          pages: Math.ceil(count / limit)
        }
      });
    } catch (error) {
      console.error('Get staff error:', error);
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  }

  // Get staff by ID
  async getStaffById(req, res) {
    try {
      const { staffId } = req.params;

      const { data: staff, error } = await supabaseService.client
        .from('staff')
        .select(`
          *,
          user:user_id (*)
        `)
        .eq('id', staffId)
        .single();

      if (error) throw error;

      if (!staff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      // Remove sensitive data
      if (staff.user) {
        delete staff.user.password_hash;
      }

      res.json(staff);
    } catch (error) {
      console.error('Get staff error:', error);
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  }

  // Create staff (admin only)
  async createStaff(req, res) {
    try {
      const { userData, staffData } = req.body;

      // Create user
      const { data: user, error: userError } = await supabaseService.client
        .from('users')
        .insert([{
          ...userData,
          role: 'staff'
        }])
        .select()
        .single();

      if (userError) throw userError;

      // Create staff
      const { data: staff, error: staffError } = await supabaseService.client
        .from('staff')
        .insert([{
          ...staffData,
          user_id: user.id
        }])
        .select()
        .single();

      if (staffError) throw staffError;

      res.status(201).json({
        message: 'Staff created successfully',
        staff
      });
    } catch (error) {
      console.error('Create staff error:', error);
      res.status(500).json({ error: 'Failed to create staff' });
    }
  }

  // Update staff
  async updateStaff(req, res) {
    try {
      const { staffId } = req.params;
      const updates = req.body;

      delete updates.id;
      delete updates.created_at;

      const { data: staff, error } = await supabaseService.client
        .from('staff')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('id', staffId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: 'Staff updated successfully',
        staff
      });
    } catch (error) {
      console.error('Update staff error:', error);
      res.status(500).json({ error: 'Failed to update staff' });
    }
  }

  // Delete staff
  async deleteStaff(req, res) {
    try {
      const { staffId } = req.params;

      const { data: staff } = await supabaseService.client
        .from('staff')
        .select('user_id')
        .eq('id', staffId)
        .single();

      if (!staff) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      // Delete staff
      await supabaseService.client
        .from('staff')
        .delete()
        .eq('id', staffId);

      // Delete user
      await supabaseService.client
        .from('users')
        .delete()
        .eq('id', staff.user_id);

      res.json({ message: 'Staff deleted successfully' });
    } catch (error) {
      console.error('Delete staff error:', error);
      res.status(500).json({ error: 'Failed to delete staff' });
    }
  }

  // Get staff statistics
  async getStats(req, res) {
    try {
      const { count: totalStaff } = await supabaseService.client
        .from('staff')
        .select('*', { count: 'exact', head: true });

      const { count: teachingStaff } = await supabaseService.client
        .from('staff')
        .select('*', { count: 'exact', head: true })
        .eq('is_teaching', true);

      const { data: departmentStats } = await supabaseService.client
        .from('staff')
        .select('department, count')
        .group('department');

      res.json({
        totalStaff,
        teachingStaff,
        departmentStats
      });
    } catch (error) {
      console.error('Get staff stats error:', error);
      res.status(500).json({ error: 'Failed to fetch staff statistics' });
    }
  }
}

module.exports = new StaffController();
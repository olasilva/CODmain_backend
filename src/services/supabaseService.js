// src/services/supabaseService.js
const { supabaseAdmin } = require('../config/supabase');

class SupabaseService {
  constructor() {
    this.admin = supabaseAdmin;
  }

  // ============ USER METHODS ============

  async getUserByEmail(email) {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('email', email)
        .limit(1);

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('getUserByEmail error:', error);
      throw error;
    }
  }

  async getUserById(id) {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', id)
        .limit(1);

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('getUserById error:', error);
      throw error;
    }
  }

  async createUser(userData) {
    try {
      const { data, error } = await supabaseAdmin
        .from('users')
        .insert([userData])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('createUser error:', error);
      throw error;
    }
  }

  async update(table, id, updates) {
    try {
      const updateData = {
        ...updates,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from(table)
        .update(updateData)
        .eq('id', id)
        .select();

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error(`update ${table} error:`, error);
      return null;
    }
  }

  async getAll(table, filters = {}) {
    try {
      let query = supabaseAdmin.from(table).select('*');

      Object.keys(filters).forEach((key) => {
        query = query.eq(key, filters[key]);
      });

      const { data, error } = await query;

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error(`getAll ${table} error:`, error);
      throw error;
    }
  }

  async getById(table, id) {
    try {
      const { data, error } = await supabaseAdmin
        .from(table)
        .select('*')
        .eq('id', id)
        .limit(1);

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error(`getById ${table} error:`, error);
      throw error;
    }
  }

  async create(table, itemData) {
    try {
      const { data, error } = await supabaseAdmin
        .from(table)
        .insert([itemData])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error(`create ${table} error:`, error);
      throw error;
    }
  }

  async delete(table, id) {
    try {
      const { data, error } = await supabaseAdmin
        .from(table)
        .delete()
        .eq('id', id)
        .select();

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error(`delete ${table} error:`, error);
      throw error;
    }
  }

  // ============ STUDENT METHODS ============

  /**
   * ⚠️ CRITICAL
   * Uses admin client (bypasses RLS) + .limit(1) instead of .single().
   *
   * - .single() throws when 2+ rows match, which was silently caught and
   *   misreported as "Student record not found", causing duplicate inserts.
   * - anon client returns zero rows because RLS needs auth.uid() which is
   *   null under custom JWT auth.
   */
  async getStudentByUserId(userId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('students')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('getStudentByUserId error:', error);
      throw error;
    }
  }

  async createStudent(studentData) {
    try {
      const { data, error } = await supabaseAdmin
        .from('students')
        .insert([studentData])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('createStudent error:', error);
      throw error;
    }
  }

  // ============ PROGRAMME METHODS ============

  async getProgrammes(activeOnly = true) {
    try {
      let query = supabaseAdmin.from('programmes').select('*');

      if (activeOnly) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query.order('title');

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('getProgrammes error:', error);
      throw error;
    }
  }

  async getProgrammeById(id) {
    try {
      const { data, error } = await supabaseAdmin
        .from('programmes')
        .select('*')
        .eq('id', id)
        .limit(1);

      if (error) throw error;
      return data && data.length > 0 ? data[0] : null;
    } catch (error) {
      console.error('getProgrammeById error:', error);
      throw error;
    }
  }

  // ============ ADMISSION METHODS ============

  async getAdmissionsWithProgrammes(studentId) {
    try {
      const { data, error } = await supabaseAdmin
        .from('admissions')
        .select(`
          *,
          programme:programme_id (*)
        `)
        .eq('student_id', studentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('getAdmissionsWithProgrammes error:', error);
      throw error;
    }
  }

  async createAdmission(admissionData) {
    try {
      const { data, error } = await supabaseAdmin
        .from('admissions')
        .insert([admissionData])
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('createAdmission error:', error);
      throw error;
    }
  }
}

module.exports = new SupabaseService();
// src/controllers/adminController.js
const { supabaseAdmin } = require('../config/supabase');

class AdminController {
  // ============================================================
  // GET /api/admin/students?page=1&limit=20&search=
  // ============================================================
  async getStudents(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const search = (req.query.search || '').trim().toLowerCase();
      const offset = (page - 1) * limit;

      const { data: rows, error, count } = await supabaseAdmin
        .from('students')
        .select(
          `
          id,
          user_id,
          student_id,
          full_name,
          status,
          academic_year,
          created_at,
          user:users ( id, email, phone, role, avatar_url )
        `,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      let students = rows || [];

      if (search) {
        students = students.filter((s) => {
          const name = (s.full_name || '').toLowerCase();
          const email = (s.user?.email || '').toLowerCase();
          const code = (s.student_id || '').toLowerCase();
          return name.includes(search) || email.includes(search) || code.includes(search);
        });
      }

      const data = students.map((s) => ({
        id: s.id,
        user_id: s.user_id,
        student_id: s.student_id,
        fullName: s.full_name,
        email: s.user?.email || null,
        phone: s.user?.phone || null,
        avatar_url: s.user?.avatar_url || null,
        status: s.status,
        academic_year: s.academic_year,
        created_at: s.created_at,
      }));

      res.json({
        success: true,
        students: data,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (error) {
      console.error('❌ Get students error:', error.message);
      res.status(500).json({ error: 'Failed to fetch students', details: error.message });
    }
  }

  // ============================================================
  // GET /api/admin/students/:studentId
  // ============================================================
  async getStudentDetails(req, res) {
    try {
      const { studentId } = req.params;

      const { data: rows, error } = await supabaseAdmin
        .from('students')
        .select('*, user:users (*)')
        .eq('id', studentId)
        .limit(1);
      if (error) throw error;

      const student = rows?.[0];
      if (!student) {
        return res.status(404).json({ error: 'Student not found' });
      }

      const [paymentsRes, admissionsRes, reportCardsRes] = await Promise.all([
        supabaseAdmin
          .from('payments')
          .select('*')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('admissions')
          .select('*')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('report_cards')
          .select('id, session, term, overall_grade, overall_percentage, created_at')
          .eq('student_id', studentId)
          .order('session', { ascending: false })
          .order('term', { ascending: false }),
      ]);

      if (student.user) delete student.user.password_hash;

      res.json({
        success: true,
        student,
        payments: paymentsRes.data || [],
        admissions: admissionsRes.data || [],
        reportCards: reportCardsRes.data || [],
      });
    } catch (error) {
      console.error('❌ Get student details error:', error.message);
      res.status(500).json({ error: 'Failed to fetch student details', details: error.message });
    }
  }

  // ============================================================
  // PUT /api/admin/students/:studentId
  // ============================================================
  async updateStudent(req, res) {
    try {
      const { studentId } = req.params;
      const { fullName, email, phone, status, academic_year } = req.body;

      const studentUpdates = {};
      if (fullName !== undefined) studentUpdates.full_name = fullName.trim();
      if (status !== undefined) studentUpdates.status = status;
      if (academic_year !== undefined) studentUpdates.academic_year = academic_year;

      if (Object.keys(studentUpdates).length > 0) {
        studentUpdates.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin
          .from('students')
          .update(studentUpdates)
          .eq('id', studentId);
        if (error) throw error;
      }

      const { data: studentRows } = await supabaseAdmin
        .from('students')
        .select('user_id')
        .eq('id', studentId)
        .limit(1);
      const userId = studentRows?.[0]?.user_id;

      if (userId) {
        const userUpdates = {};
        if (email !== undefined) userUpdates.email = email.trim().toLowerCase();
        if (phone !== undefined) userUpdates.phone = phone;
        if (fullName !== undefined) userUpdates.full_name = fullName.trim();

        if (Object.keys(userUpdates).length > 0) {
          userUpdates.updated_at = new Date().toISOString();
          const { error } = await supabaseAdmin
            .from('users')
            .update(userUpdates)
            .eq('id', userId);
          if (error) throw error;
        }
      }

      res.json({ success: true, message: 'Student updated successfully' });
    } catch (error) {
      console.error('❌ Update student error:', error.message);
      res.status(500).json({ error: 'Failed to update student', details: error.message });
    }
  }

  // ============================================================
  // DELETE /api/admin/students/:studentId
  // ============================================================
  async deleteStudent(req, res) {
    try {
      const { studentId } = req.params;

      const { data: rows } = await supabaseAdmin
        .from('students')
        .select('user_id')
        .eq('id', studentId)
        .limit(1);

      const userId = rows?.[0]?.user_id;

      const { error: sErr } = await supabaseAdmin
        .from('students')
        .delete()
        .eq('id', studentId);
      if (sErr) throw sErr;

      if (userId) {
        await supabaseAdmin.from('users').delete().eq('id', userId);
      }

      res.json({ success: true, message: 'Student deleted successfully' });
    } catch (error) {
      console.error('❌ Delete student error:', error.message);
      res.status(500).json({ error: 'Failed to delete student', details: error.message });
    }
  }

  // ============================================================
  // GET /api/admin/programmes
  // ============================================================
  async getProgrammes(req, res) {
    try {
      const { data, error } = await supabaseAdmin
        .from('programmes')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      res.json({ success: true, programmes: data || [] });
    } catch (error) {
      console.error('❌ Get programmes error:', error.message);
      res.status(500).json({ error: 'Failed to fetch programmes', details: error.message });
    }
  }

  // ============================================================
  // POST /api/admin/programmes
  // ============================================================
  async createProgramme(req, res) {
    try {
      const { title, name, description, is_active } = req.body;

      const finalTitle = (title || name || '').trim();
      if (!finalTitle) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const { data, error } = await supabaseAdmin
        .from('programmes')
        .insert([
          {
            title: finalTitle,
            name: finalTitle,
            description: description || null,
            is_active: is_active !== false,
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();
      if (error) throw error;

      res.status(201).json({
        success: true,
        message: 'Programme created successfully',
        programme: data,
      });
    } catch (error) {
      console.error('❌ Create programme error:', error.message);
      res.status(500).json({ error: 'Failed to create programme', details: error.message });
    }
  }

  // ============================================================
  // PUT /api/admin/programmes/:programmeId
  // ============================================================
  async updateProgramme(req, res) {
    try {
      const { programmeId } = req.params;
      const updates = {};

      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.is_active !== undefined) updates.is_active = req.body.is_active;
      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('programmes')
        .update(updates)
        .eq('id', programmeId)
        .select()
        .single();
      if (error) throw error;

      res.json({
        success: true,
        message: 'Programme updated successfully',
        programme: data,
      });
    } catch (error) {
      console.error('❌ Update programme error:', error.message);
      res.status(500).json({ error: 'Failed to update programme', details: error.message });
    }
  }

  // ============================================================
  // DELETE /api/admin/programmes/:programmeId
  // ============================================================
  async deleteProgramme(req, res) {
    try {
      const { programmeId } = req.params;

      const { error } = await supabaseAdmin
        .from('programmes')
        .delete()
        .eq('id', programmeId);
      if (error) throw error;

      res.json({ success: true, message: 'Programme deleted successfully' });
    } catch (error) {
      console.error('❌ Delete programme error:', error.message);
      res.status(500).json({ error: 'Failed to delete programme', details: error.message });
    }
  }

  // ============================================================
  // GET /api/admin/stats
  // ============================================================
  async getStats(req, res) {
    try {
      const [
        usersRes,
        studentsRes,
        admissionsRes,
        paymentsRes,
        pendingAdmissionsRes,
        staffRes,
      ] = await Promise.all([
        supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('students').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('admissions').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('payments').select('*', { count: 'exact', head: true }),
        supabaseAdmin
          .from('admissions')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'pending'),
        supabaseAdmin
          .from('users')
          .select('*', { count: 'exact', head: true })
          .eq('role', 'staff'),
      ]);

      const { data: completed } = await supabaseAdmin
        .from('payments')
        .select('amount')
        .eq('status', 'completed');
      const totalRevenue = (completed || []).reduce(
        (sum, p) => sum + Number(p.amount || 0),
        0
      );

      const { data: recentAdmissions } = await supabaseAdmin
        .from('admissions')
        .select('id, student_name, course, track_name, status, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

      res.json({
        success: true,
        stats: {
          totalUsers: usersRes.count || 0,
          totalStudents: studentsRes.count || 0,
          totalStaff: staffRes.count || 0,
          totalAdmissions: admissionsRes.count || 0,
          totalPayments: paymentsRes.count || 0,
          pendingAdmissions: pendingAdmissionsRes.count || 0,
          totalRevenue,
        },
        recentAdmissions: recentAdmissions || [],
      });
    } catch (error) {
      console.error('❌ Get stats error:', error.message);
      res.status(500).json({ error: 'Failed to fetch statistics', details: error.message });
    }
  }

  // ============================================================
  // GET /api/admin/payments?status=&studentId=
  // ============================================================
  async getPayments(req, res) {
    try {
      const { status, studentId } = req.query;

      let query = supabaseAdmin
        .from('payments')
        .select(
          `
          id, payment_id, reference, amount, plan, status,
          description, payer_email, payment_date, created_at, student_id,
          student:students ( id, student_id, full_name )
        `
        )
        .order('created_at', { ascending: false });

      if (status) query = query.eq('status', status);
      if (studentId) query = query.eq('student_id', studentId);

      const { data, error } = await query;
      if (error) throw error;

      const completed = (data || []).filter((p) => p.status === 'completed');
      const pending = (data || []).filter((p) => p.status === 'pending');
      const failed = (data || []).filter((p) => p.status === 'failed');

      const totalCollected = completed.reduce((s, p) => s + Number(p.amount || 0), 0);
      const totalPending = pending.reduce((s, p) => s + Number(p.amount || 0), 0);

      res.json({
        success: true,
        payments: data || [],
        summary: {
          totalCollected,
          totalPending,
          countCompleted: completed.length,
          countPending: pending.length,
          countFailed: failed.length,
          countTotal: data?.length || 0,
        },
      });
    } catch (error) {
      console.error('❌ Get payments error:', error.message);
      res.status(500).json({ error: 'Failed to fetch payments', details: error.message });
    }
  }

  // ============================================================
  // GET /api/admin/reports
  // ============================================================
  async getReports(req, res) {
    try {
      const [studentsRes, paymentsRes, admissionsRes] = await Promise.all([
        supabaseAdmin.from('students').select('id, created_at, status'),
        supabaseAdmin.from('payments').select('amount, status, created_at'),
        supabaseAdmin.from('admissions').select('status, created_at'),
      ]);

      const students = studentsRes.data || [];
      const payments = paymentsRes.data || [];
      const admissions = admissionsRes.data || [];

      const totalRevenue = payments
        .filter((p) => p.status === 'completed')
        .reduce((s, p) => s + Number(p.amount || 0), 0);

      // Enrollment trend: last 6 months
      const enrollmentTrend = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString('en-NG', { month: 'short' });
        const count = students.filter((s) => {
          const c = new Date(s.created_at);
          return c.getFullYear() === d.getFullYear() && c.getMonth() === d.getMonth();
        }).length;
        enrollmentTrend.push({ month: label, value: count });
      }

      // Fee collection: last 6 months
      const feeCollection = enrollmentTrend.map(({ month }) => {
        const collected = payments
          .filter((p) => {
            if (p.status !== 'completed') return false;
            const c = new Date(p.created_at);
            return c.toLocaleString('en-NG', { month: 'short' }) === month;
          })
          .reduce((s, p) => s + Number(p.amount || 0), 0);
        return { month, collected: collected / 1_000_000, target: 16 };
      });

      // Class distribution (based on students grouped by academic year — placeholder)
      const classDistribution = Object.entries(
        students.reduce((acc, s) => {
          const key = s.academic_year || 'Unassigned';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      ).map(([label, value], i) => ({
        label,
        value,
        color: ['#1A73E8', '#34A853', '#FBBC05', '#EA4335', '#9C27B0', '#FF5722'][i % 6],
      }));

      res.json({
        success: true,
        stats: {
          totalStudents: students.length,
          totalRevenue,
          totalAdmissions: admissions.length,
          pendingAdmissions: admissions.filter((a) => a.status === 'pending').length,
        },
        enrollmentTrend,
        feeCollection,
        classDistribution,
      });
    } catch (error) {
      console.error('❌ Get reports error:', error.message);
      res.status(500).json({ error: 'Failed to fetch reports', details: error.message });
    }
  }

  // ============================================================
  // GET /api/admin/students/:studentId/report-cards
  // ============================================================
  async getStudentReportCards(req, res) {
    try {
      const { studentId } = req.params;

      const { data, error } = await supabaseAdmin
        .from('report_cards')
        .select('*')
        .eq('student_id', studentId)
        .order('session', { ascending: false })
        .order('term', { ascending: false });
      if (error) throw error;

      // Attach student info to each card
      const { data: studentRows } = await supabaseAdmin
        .from('students')
        .select('id, student_id, full_name, user:users ( email, avatar_url )')
        .eq('id', studentId)
        .limit(1);
      const student = studentRows?.[0] || null;

      const reportCards = (data || []).map((r) => ({ ...r, student }));

      res.json({ success: true, reportCards });
    } catch (error) {
      console.error('❌ Get student report cards error:', error.message);
      res.status(500).json({ error: 'Failed to fetch report cards', details: error.message });
    }
  }

  // ============================================================
  // GET /api/admin/students/:studentId/report-cards/:session/:term
  // ============================================================
  async getReportCard(req, res) {
    try {
      const { studentId, session, term } = req.params;

      const { data, error } = await supabaseAdmin
        .from('report_cards')
        .select('*')
        .eq('student_id', studentId)
        .eq('session', session)
        .eq('term', term)
        .limit(1);
      if (error) throw error;

      if (!data?.[0]) {
        return res.status(404).json({ error: 'Report card not found' });
      }

      const { data: studentRows } = await supabaseAdmin
        .from('students')
        .select('id, student_id, full_name, user:users ( email, avatar_url )')
        .eq('id', studentId)
        .limit(1);

      const reportCard = {
        ...data[0],
        student: studentRows?.[0] || null,
      };

      res.json({ success: true, reportCard });
    } catch (error) {
      console.error('❌ Get report card error:', error.message);
      res.status(500).json({ error: 'Failed to fetch report card', details: error.message });
    }
  }

  // ============================================================
  // POST /api/admin/students/:studentId/report-cards
  // ============================================================
  async upsertReportCard(req, res) {
    try {
      const { studentId } = req.params;
      const body = req.body || {};

      if (!body.session || !body.term) {
        return res.status(400).json({ error: 'Session and term are required' });
      }

      const payload = {
        ...body,
        student_id: studentId,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabaseAdmin
        .from('report_cards')
        .upsert([payload], { onConflict: 'student_id,session,term' })
        .select()
        .single();
      if (error) throw error;

      res.json({ success: true, reportCard: data });
    } catch (error) {
      console.error('❌ Upsert report card error:', error.message);
      res.status(500).json({ error: 'Failed to save report card', details: error.message });
    }
  }
}

module.exports = new AdminController();
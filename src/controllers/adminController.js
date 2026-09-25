// src/controllers/adminController.js
const { supabaseAdmin } = require('../config/supabase');

let bcrypt = null;
try {
  bcrypt = require('bcryptjs');
} catch {
  try {
    bcrypt = require('bcrypt');
  } catch {
    console.warn(
      '⚠️ bcrypt/bcryptjs not installed — reset passwords will be saved ' +
        'as plaintext only and won\'t be usable for login.'
    );
  }
}

const BCRYPT_ROUNDS = 10;

function generateTempPassword() {
  const words = [
    'Tiger', 'River', 'Lion', 'Eagle', 'Ocean', 'Sunset',
    'Melody', 'Crescendo', 'Harmony', 'Piano', 'Guitar', 'Drum',
    'Anthem', 'Chorus', 'Verse', 'Symphony', 'Rhythm', 'Chime',
  ];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  const num = 1000 + Math.floor(Math.random() * 9000);
  const symbol = '!@#$%'.charAt(Math.floor(Math.random() * 5));
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const suffix = letters.charAt(Math.floor(Math.random() * letters.length));
  return `${pick()}-${pick()}-${num}${symbol}${suffix}`;
}

// ─────────────────────────────────────────────────────────────
// Notify matching students when a teacher is assigned.
// ─────────────────────────────────────────────────────────────
async function notifyStudentsOfStaffAssignment({
  staffId,          // ← NEW: needed for the deep-link
  staffName,
  category,
  levels,
}) {
  if (!category) return 0;

  const levelList = Array.isArray(levels) ? levels : [];

  const { data: admissions, error } = await supabaseAdmin
    .from('admissions')
    .select('student_id, track_name, regular_class, instrument, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(
      'notifyStudentsOfStaffAssignment: fetch failed',
      error.message
    );
    return 0;
  }

  const latest = {};
  (admissions || []).forEach((a) => {
    if (!latest[a.student_id]) latest[a.student_id] = a;
  });

  const track = String(category).toLowerCase();
  const matchedStudentIds = [];

  Object.values(latest).forEach((a) => {
    const studentTrack = String(a.track_name || '').toLowerCase();
    const studentLevels = [a.regular_class, a.instrument].filter(Boolean);

    if (track === 'regular' && !studentTrack.includes('regular')) return;
    if (track === 'music' && !studentTrack.includes('music')) return;
    if (
      track === 'mixed' &&
      !studentTrack.includes('mixed') &&
      !studentTrack.includes('regular') &&
      !studentTrack.includes('music')
    )
      return;

    if (levelList.length > 0) {
      const match = levelList.some((lvl) =>
        studentLevels.some(
          (sl) => String(sl).toLowerCase() === String(lvl).toLowerCase()
        )
      );
      if (!match) return;
    }

    matchedStudentIds.push(a.student_id);
  });

  if (matchedStudentIds.length === 0) return 0;

  const levelText =
    levelList.length > 0 ? levelList.join(', ') : `${category} track`;

  const notifications = matchedStudentIds.map((studentId) => ({
    studentId,
    title: `New teacher assigned: ${staffName}`,
    message: `${staffName} has been assigned as your teacher for ${levelText}. You can now message them directly.`,
    type: 'teacher_assigned',
    link: staffId ? `/student/messages?teacher=${staffId}` : '/student/messages',  // ← CHANGED
  }));

  try {
    const notificationController = require('./notificationController');
    const { succeeded } = await notificationController.pushMany(
      notifications
    );
    console.log(
      `📢 Student notifications sent: ${succeeded}/${matchedStudentIds.length}`
    );
    return succeeded;
  } catch (err) {
    console.warn('Student notify failed:', err.message);
    return 0;
  }
}

class AdminController {
  // ═══════════════════════════════════════════════════════════
  // STUDENTS
  // ═══════════════════════════════════════════════════════════

  async getStudents(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;
      const search = (req.query.search || '').trim().toLowerCase();
      const offset = (page - 1) * limit;

      const { data: rows, error, count } = await supabaseAdmin
        .from('students')
        .select(
          `id, user_id, student_id, full_name, status, academic_year, created_at,
           user:users ( id, email, phone, role, avatar_url )`,
          { count: 'exact' }
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const students = rows || [];
      const ids = students.map((s) => s.id);

      let payMap = {};
      let admMap = {};
      let classMap = {};
      let rcMap = {};

      if (ids.length > 0) {
        const [payRes, admRes, scRes, rcRes] = await Promise.all([
          supabaseAdmin
            .from('payments')
            .select('student_id, amount, status, description, plan, payment_date, created_at')
            .in('student_id', ids)
            .order('created_at', { ascending: false }),
          supabaseAdmin
            .from('admissions')
            .select('student_id, course, track_name, status, created_at')
            .in('student_id', ids)
            .order('created_at', { ascending: false }),
          supabaseAdmin
            .from('student_classes')
            .select(
              `student_id, status,
               class:class_id (
                 id, title, subject,
                 instructor:instructor_id ( id, full_name, email )
               )`
            )
            .in('student_id', ids)
            .eq('status', 'active'),
          supabaseAdmin
            .from('report_cards')
            .select('student_id, status')
            .in('student_id', ids),
        ]);

        (payRes.data || []).forEach((p) => {
          if (!payMap[p.student_id]) payMap[p.student_id] = p;
        });
        (admRes.data || []).forEach((a) => {
          if (!admMap[a.student_id]) admMap[a.student_id] = a;
        });
        (scRes.data || []).forEach((row) => {
          classMap[row.student_id] = classMap[row.student_id] || [];
          if (row.class) classMap[row.student_id].push(row.class);
        });
        (rcRes.data || []).forEach((rc) => {
          rcMap[rc.student_id] = rcMap[rc.student_id] || { total: 0, submitted: 0 };
          rcMap[rc.student_id].total += 1;
          if (rc.status === 'submitted') rcMap[rc.student_id].submitted += 1;
        });
      }

      let combined = students.map((s) => {
        const pay = payMap[s.id];
        const adm = admMap[s.id];
        const classes = classMap[s.id] || [];
        const rc = rcMap[s.id] || { total: 0, submitted: 0 };

        const instructors = [
          ...new Map(
            classes
              .filter((c) => c.instructor)
              .map((c) => [c.instructor.id, c.instructor])
          ).values(),
        ];

        return {
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
          programme: adm?.course
            ? `${adm.course} · ${adm.track_name || ''}`.trim()
            : pay?.description || null,
          payment_status: pay?.status || 'none',
          payment_amount: pay?.amount || 0,
          payment_plan: pay?.plan || null,
          payment_date: pay?.payment_date || pay?.created_at || null,
          classes: classes.map((c) => ({
            id: c.id,
            title: c.title || c.subject,
          })),
          instructors,
          reportCards: rc,
        };
      });

      if (search) {
        combined = combined.filter((s) => {
          const name = (s.fullName || '').toLowerCase();
          const email = (s.email || '').toLowerCase();
          const code = (s.student_id || '').toLowerCase();
          const prog = (s.programme || '').toLowerCase();
          return (
            name.includes(search) ||
            email.includes(search) ||
            code.includes(search) ||
            prog.includes(search)
          );
        });
      }

      res.json({
        success: true,
        students: combined,
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (error) {
      console.error('❌ Get students error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch students',
        details: error.message,
      });
    }
  }

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
      if (!student) return res.status(404).json({ error: 'Student not found' });

      const [paymentsRes, admissionsRes, reportCardsRes, invoicesRes, classesRes] =
        await Promise.all([
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
            .select('*')
            .eq('student_id', studentId)
            .order('session', { ascending: false }),
          supabaseAdmin
            .from('invoices')
            .select('*')
            .eq('student_id', studentId)
            .order('created_at', { ascending: false }),
          supabaseAdmin
            .from('student_classes')
            .select(
              `status,
               class:class_id (
                 id, title, subject, schedule,
                 instructor:instructor_id ( id, full_name, email )
               )`
            )
            .eq('student_id', studentId)
            .eq('status', 'active'),
        ]);

      if (student.user) delete student.user.password_hash;

      res.json({
        success: true,
        student,
        payments: paymentsRes.data || [],
        admissions: admissionsRes.data || [],
        reportCards: reportCardsRes.data || [],
        invoices: invoicesRes.data || [],
        classes: (classesRes.data || []).map((r) => r.class).filter(Boolean),
      });
    } catch (error) {
      console.error('❌ Get student details error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch student details',
        details: error.message,
      });
    }
  }

  async updateStudent(req, res) {
    try {
      const { studentId } = req.params;
      const { fullName, email, phone, status, academic_year } = req.body;

      const sUpdates = {};
      if (fullName !== undefined) sUpdates.full_name = fullName.trim();
      if (status !== undefined) sUpdates.status = status;
      if (academic_year !== undefined) sUpdates.academic_year = academic_year;

      if (Object.keys(sUpdates).length > 0) {
        sUpdates.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin
          .from('students')
          .update(sUpdates)
          .eq('id', studentId);
        if (error) throw error;
      }

      const { data: sRows } = await supabaseAdmin
        .from('students')
        .select('user_id')
        .eq('id', studentId)
        .limit(1);
      const userId = sRows?.[0]?.user_id;

      if (userId) {
        const uUpdates = {};
        if (email !== undefined) uUpdates.email = email.trim().toLowerCase();
        if (phone !== undefined) uUpdates.phone = phone;
        if (fullName !== undefined) uUpdates.full_name = fullName.trim();
        if (Object.keys(uUpdates).length > 0) {
          uUpdates.updated_at = new Date().toISOString();
          const { error } = await supabaseAdmin
            .from('users')
            .update(uUpdates)
            .eq('id', userId);
          if (error) throw error;
        }
      }

      res.json({ success: true, message: 'Student updated successfully' });
    } catch (error) {
      console.error('❌ Update student error:', error.message);
      res.status(500).json({
        error: 'Failed to update student',
        details: error.message,
      });
    }
  }

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

      if (userId) await supabaseAdmin.from('users').delete().eq('id', userId);

      res.json({ success: true, message: 'Student deleted successfully' });
    } catch (error) {
      console.error('❌ Delete student error:', error.message);
      res.status(500).json({
        error: 'Failed to delete student',
        details: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // PROGRAMMES
  // ═══════════════════════════════════════════════════════════

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
      res.status(500).json({
        error: 'Failed to fetch programmes',
        details: error.message,
      });
    }
  }

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
      res.status(201).json({ success: true, programme: data });
    } catch (error) {
      console.error('❌ Create programme error:', error.message);
      res.status(500).json({
        error: 'Failed to create programme',
        details: error.message,
      });
    }
  }

  async updateProgramme(req, res) {
    try {
      const { programmeId } = req.params;
      const updates = { updated_at: new Date().toISOString() };
      ['title', 'name', 'description', 'is_active'].forEach((k) => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      });
      const { data, error } = await supabaseAdmin
        .from('programmes')
        .update(updates)
        .eq('id', programmeId)
        .select()
        .single();
      if (error) throw error;
      res.json({ success: true, programme: data });
    } catch (error) {
      console.error('❌ Update programme error:', error.message);
      res.status(500).json({
        error: 'Failed to update programme',
        details: error.message,
      });
    }
  }

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
      res.status(500).json({
        error: 'Failed to delete programme',
        details: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STATS & REPORTS
  // ═══════════════════════════════════════════════════════════

  async getStats(req, res) {
    try {
      const [
        usersRes,
        studentsRes,
        admissionsRes,
        paymentsRes,
        pendingAdmRes,
        staffRes,
      ] = await Promise.all([
        supabaseAdmin.from('users').select('*', { count: 'exact', head: true }),
        supabaseAdmin
          .from('students')
          .select('*', { count: 'exact', head: true }),
        supabaseAdmin
          .from('admissions')
          .select('*', { count: 'exact', head: true }),
        supabaseAdmin
          .from('payments')
          .select('*', { count: 'exact', head: true }),
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
        (s, p) => s + Number(p.amount || 0),
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
          pendingAdmissions: pendingAdmRes.count || 0,
          totalRevenue,
        },
        recentAdmissions: recentAdmissions || [],
      });
    } catch (error) {
      console.error('❌ Get stats error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch statistics',
        details: error.message,
      });
    }
  }

  async getPayments(req, res) {
    try {
      const { status, studentId } = req.query;
      let query = supabaseAdmin
        .from('payments')
        .select(
          `id, payment_id, reference, amount, plan, status, description,
           payer_email, payment_date, created_at, student_id,
           student:students ( id, student_id, full_name )`
        )
        .order('created_at', { ascending: false });
      if (status) query = query.eq('status', status);
      if (studentId) query = query.eq('student_id', studentId);

      const { data, error } = await query;
      if (error) throw error;

      const completed = (data || []).filter((p) => p.status === 'completed');
      const pending = (data || []).filter((p) => p.status === 'pending');
      const failed = (data || []).filter((p) => p.status === 'failed');

      res.json({
        success: true,
        payments: data || [],
        summary: {
          totalCollected: completed.reduce(
            (s, p) => s + Number(p.amount || 0),
            0
          ),
          totalPending: pending.reduce(
            (s, p) => s + Number(p.amount || 0),
            0
          ),
          countCompleted: completed.length,
          countPending: pending.length,
          countFailed: failed.length,
          countTotal: data?.length || 0,
        },
      });
    } catch (error) {
      console.error('❌ Get payments error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch payments',
        details: error.message,
      });
    }
  }

  async getReports(req, res) {
    try {
      const [studentsRes, paymentsRes, admissionsRes] = await Promise.all([
        supabaseAdmin
          .from('students')
          .select('id, created_at, status, academic_year'),
        supabaseAdmin.from('payments').select('amount, status, created_at'),
        supabaseAdmin.from('admissions').select('status, created_at'),
      ]);

      const students = studentsRes.data || [];
      const payments = paymentsRes.data || [];
      const admissions = admissionsRes.data || [];

      const totalRevenue = payments
        .filter((p) => p.status === 'completed')
        .reduce((s, p) => s + Number(p.amount || 0), 0);

      const enrollmentTrend = [];
      const now = new Date();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const label = d.toLocaleString('en-NG', { month: 'short' });
        const count = students.filter((s) => {
          const c = new Date(s.created_at);
          return (
            c.getFullYear() === d.getFullYear() &&
            c.getMonth() === d.getMonth()
          );
        }).length;
        enrollmentTrend.push({ month: label, value: count });
      }

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

      const classDistribution = Object.entries(
        students.reduce((acc, s) => {
          const key = s.academic_year || 'Unassigned';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      ).map(([label, value], i) => ({
        label,
        value,
        color: [
          '#1A73E8',
          '#34A853',
          '#FBBC05',
          '#EA4335',
          '#9C27B0',
          '#FF5722',
        ][i % 6],
      }));

      res.json({
        success: true,
        stats: {
          totalStudents: students.length,
          totalRevenue,
          totalAdmissions: admissions.length,
          pendingAdmissions: admissions.filter(
            (a) => a.status === 'pending'
          ).length,
        },
        enrollmentTrend,
        feeCollection,
        classDistribution,
      });
    } catch (error) {
      console.error('❌ Get reports error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch reports',
        details: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // REPORT CARDS
  // ═══════════════════════════════════════════════════════════

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

      const { data: sRows } = await supabaseAdmin
        .from('students')
        .select('id, student_id, full_name, user:users ( email, avatar_url )')
        .eq('id', studentId)
        .limit(1);
      const student = sRows?.[0] || null;

      const reportCards = (data || []).map((r) => ({ ...r, student }));
      res.json({ success: true, reportCards });
    } catch (error) {
      console.error('❌ Get student report cards error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch report cards',
        details: error.message,
      });
    }
  }

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

      const { data: sRows } = await supabaseAdmin
        .from('students')
        .select('id, student_id, full_name, user:users ( email, avatar_url )')
        .eq('id', studentId)
        .limit(1);

      res.json({
        success: true,
        reportCard: { ...data[0], student: sRows?.[0] || null },
      });
    } catch (error) {
      console.error('❌ Get report card error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch report card',
        details: error.message,
      });
    }
  }

  async upsertReportCard(req, res) {
    try {
      const { studentId } = req.params;
      const body = req.body || {};
      if (!body.session || !body.term) {
        return res
          .status(400)
          .json({ error: 'Session and term are required' });
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
      res.status(500).json({
        error: 'Failed to save report card',
        details: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STAFF
  // ═══════════════════════════════════════════════════════════

  async getStaff(req, res) {
    try {
      const { search } = req.query;

      const { data, error, count } = await supabaseAdmin
        .from('users')
        .select(
          'id, full_name, email, phone, role, is_active, last_login, created_at, avatar_url, department, staff_category, staff_levels',
          { count: 'exact' }
        )
        .in('role', ['staff', 'admin'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      let staff = data || [];

      if (search) {
        const s = search.toLowerCase();
        staff = staff.filter((u) => {
          const name = (u.full_name || '').toLowerCase();
          const email = (u.email || '').toLowerCase();
          return name.includes(s) || email.includes(s);
        });
      }

      res.json({
        success: true,
        staff,
        total: count || 0,
      });
    } catch (error) {
      console.error('❌ Get staff error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch staff',
        details: error.message,
      });
    }
  }

  async getStaffDetails(req, res) {
    try {
      const { staffId } = req.params;

      const { data: user, error } = await supabaseAdmin
        .from('users')
        .select(
          `id, full_name, email, phone, role, is_active,
           last_login, created_at, updated_at, avatar_url,
           department, temporary_password, temp_password_set_at,
           staff_category, staff_levels`
        )
        .eq('id', staffId)
        .single();

      if (error || !user) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const { data: classes } = await supabaseAdmin
        .from('classes')
        .select('id, title, subject, schedule, is_active')
        .eq('instructor_id', staffId)
        .order('title');

      const { data: sessions } = await supabaseAdmin
        .from('online_sessions')
        .select('id, title, start_time, status')
        .eq('host_id', String(staffId))
        .order('start_time', { ascending: false })
        .limit(5);

      return res.json({
        success: true,
        staff: user,
        classes: classes || [],
        sessions: sessions || [],
      });
    } catch (error) {
      console.error('❌ Get staff details error:', error.message);
      return res.status(500).json({
        error: 'Failed to fetch staff details',
        details: error.message,
      });
    }
  }

  async getStaffPassword(req, res) {
    try {
      const { staffId } = req.params;

      const { data, error } = await supabaseAdmin
        .from('users')
        .select(
          'id, full_name, email, role, temporary_password, temp_password_set_at'
        )
        .eq('id', staffId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      if (!data.temporary_password) {
        return res.status(404).json({
          error:
            'No temporary password on record. Use "Reset Password" to issue a new one.',
        });
      }

      res.json({
        success: true,
        id: data.id,
        fullName: data.full_name,
        email: data.email,
        role: data.role,
        temporaryPassword: data.temporary_password,
        setAt: data.temp_password_set_at,
      });
    } catch (error) {
      console.error('❌ Get staff password error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch password',
        details: error.message,
      });
    }
  }

  async resetStaffPassword(req, res) {
    try {
      const { staffId } = req.params;
      const { sendEmail = true } = req.body || {};

      const { data: user, error: fetchErr } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, role')
        .eq('id', staffId)
        .single();

      if (fetchErr || !user) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      if (!['staff', 'admin'].includes(user.role)) {
        return res.status(400).json({
          error: 'This account is not a staff or admin account',
        });
      }

      const tempPassword = generateTempPassword();

      let passwordHash = null;
      if (bcrypt) {
        try {
          passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS);
        } catch (hashErr) {
          console.warn('⚠️ Password hashing failed:', hashErr.message);
        }
      }

      const updates = {
        temporary_password: tempPassword,
        temp_password_set_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (passwordHash) {
        updates.password_hash = passwordHash;
      }

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('users')
        .update(updates)
        .eq('id', staffId)
        .select(
          'id, full_name, email, role, temporary_password, temp_password_set_at'
        )
        .single();

      if (updateErr) throw updateErr;

      let emailed = false;
      if (sendEmail && user.email) {
        try {
          const { sendMail } = require('../services/emailService');
          await sendMail({
            to: user.email,
            subject: '🔐 Your new Clan of David Academy password',
            text:
              `Hello ${user.full_name || 'there'},\n\n` +
              `Your password has been reset by an administrator.\n\n` +
              `New temporary password: ${tempPassword}\n\n` +
              `For security, please log in and change it right away.\n\n` +
              `— Clan of David Art and Music Academy`,
            html: `
              <div style="font-family:system-ui,Arial,sans-serif;max-width:560px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
                <h2 style="color:#1A73E8;margin:0 0 12px;">Password Reset</h2>
                <p style="color:#334155;">Hello ${user.full_name || 'there'},</p>
                <p style="color:#334155;">An administrator has reset your password. Use the credentials below to log in:</p>
                <div style="background:#F5F9FF;border:1px solid #e5e7eb;border-radius:10px;padding:16px;margin:16px 0;">
                  <p style="margin:0 0 8px;color:#475569;">Email: <strong>${user.email}</strong></p>
                  <p style="margin:0;color:#475569;">New Password: <strong>${tempPassword}</strong></p>
                </div>
                <p style="color:#94a3b8;font-size:12px;">Please log in and change this password immediately.</p>
                <p style="color:#94a3b8;font-size:12px;margin-top:12px;">— Clan of David Art and Music Academy</p>
              </div>
            `,
          });
          emailed = true;
        } catch (mailErr) {
          console.warn('⚠️ Email send failed:', mailErr.message);
        }
      }

      return res.json({
        success: true,
        message: 'New password generated',
        emailed,
        password: {
          id: updated.id,
          fullName: updated.full_name,
          email: updated.email,
          temporaryPassword: updated.temporary_password,
          setAt: updated.temp_password_set_at,
        },
      });
    } catch (error) {
      console.error('❌ Reset staff password error:', error.message);
      return res.status(500).json({
        error: 'Failed to reset password',
        details: error.message,
      });
    }
  }

  async updateStaff(req, res) {
    try {
      const { staffId } = req.params;
      const {
        fullName,
        phone,
        department,
        role,
        is_active,
        staff_category,
        staff_levels,
      } = req.body;

      const { data: current, error: fetchErr } = await supabaseAdmin
        .from('users')
        .select('id, full_name, email, staff_category, staff_levels')
        .eq('id', staffId)
        .single();

      if (fetchErr || !current) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      const updates = { updated_at: new Date().toISOString() };

      if (fullName !== undefined) {
        const trimmed = String(fullName).trim();
        if (!trimmed) {
          return res.status(400).json({ error: 'Name cannot be empty' });
        }
        updates.full_name = trimmed;
      }
      if (phone !== undefined) updates.phone = phone || null;
      if (department !== undefined) updates.department = department || null;
      if (role !== undefined) {
        if (!['staff', 'admin'].includes(role)) {
          return res.status(400).json({ error: 'Invalid role' });
        }
        updates.role = role;
      }
      if (is_active !== undefined) updates.is_active = !!is_active;

      let categoryChanged = false;

      if (staff_category !== undefined) {
        const allowed = ['regular', 'music', 'mixed', null, ''];
        const newCat = allowed.includes(staff_category)
          ? staff_category || null
          : null;
        updates.staff_category = newCat;
        if (current.staff_category !== newCat) categoryChanged = true;
      }

      if (staff_levels !== undefined) {
        const newLevels = Array.isArray(staff_levels) ? staff_levels : [];
        updates.staff_levels = newLevels;

        const oldLevels = Array.isArray(current.staff_levels)
          ? [...current.staff_levels].sort()
          : [];
        const sorted = [...newLevels].sort();
        if (JSON.stringify(oldLevels) !== JSON.stringify(sorted)) {
          categoryChanged = true;
        }
      }

      const { data, error } = await supabaseAdmin
        .from('users')
        .update(updates)
        .eq('id', staffId)
        .select(
          'id, full_name, email, phone, role, is_active, department, avatar_url, last_login, created_at, staff_category, staff_levels'
        )
        .single();

      if (error) throw error;

      let notified = 0;
      const finalCategory = updates.staff_category ?? current.staff_category;
      if (categoryChanged && finalCategory) {
        const finalLevels =
          updates.staff_levels ?? current.staff_levels ?? [];
        const staffName =
          updates.full_name || current.full_name || 'Your teacher';

        notified = await notifyStudentsOfStaffAssignment({
          staffId,        // ← CHANGED: pass staffId so the deep-link works
          staffName,
          category: finalCategory,
          levels: finalLevels,
        });
      }

      return res.json({
        success: true,
        message: 'Staff updated successfully',
        staff: data,
        notified,
      });
    } catch (error) {
      console.error('❌ Update staff error:', error.message);
      return res.status(500).json({
        error: 'Failed to update staff',
        details: error.message,
      });
    }
  }

  async deleteStaff(req, res) {
    try {
      const { staffId } = req.params;

      const callerId =
        req.user?.id || req.user?._id || req.user?.userId;
      if (callerId && String(callerId) === String(staffId)) {
        return res.status(400).json({
          error: 'You cannot delete your own account',
        });
      }

      const { data: user, error: fetchErr } = await supabaseAdmin
        .from('users')
        .select('id, role, email')
        .eq('id', staffId)
        .single();

      if (fetchErr || !user) {
        return res.status(404).json({ error: 'Staff not found' });
      }

      if (!['staff', 'admin'].includes(user.role)) {
        return res.status(400).json({
          error: 'This account is not a staff or admin account',
        });
      }

      await supabaseAdmin
        .from('classes')
        .update({
          instructor_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq('instructor_id', staffId);

      const { error: deleteErr } = await supabaseAdmin
        .from('users')
        .delete()
        .eq('id', staffId);

      if (deleteErr) throw deleteErr;

      return res.json({
        success: true,
        message: `Staff account (${user.email}) deleted`,
      });
    } catch (error) {
      console.error('❌ Delete staff error:', error.message);
      return res.status(500).json({
        error: 'Failed to delete staff',
        details: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // CLASSES
  // ═══════════════════════════════════════════════════════════

  async getClasses(req, res) {
    try {
      const { data, error } = await supabaseAdmin
        .from('classes')
        .select(
          `id, title, subject, schedule, is_active, is_published,
           programme_id,
           instructor:instructor_id ( id, full_name, email )`
        )
        .order('title');
      if (error) throw error;
      res.json({ success: true, classes: data || [] });
    } catch (error) {
      console.error('❌ Get classes error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch classes',
        details: error.message,
      });
    }
  }

  async getTracks(req, res) {
    try {
      const { data, error } = await supabaseAdmin
        .from('admissions')
        .select('course, track_name');
      if (error) throw error;

      const map = new Map();
      (data || []).forEach((row) => {
        const key = `${row.course || ''}||${row.track_name || ''}`;
        if (!map.has(key)) {
          map.set(key, {
            course: row.course,
            trackName: row.track_name,
            label: [row.course, row.track_name].filter(Boolean).join(' · '),
          });
        }
      });

      res.json({ success: true, tracks: Array.from(map.values()) });
    } catch (error) {
      console.error('❌ Get tracks error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch tracks',
        details: error.message,
      });
    }
  }

  async getStaffClasses(req, res) {
    try {
      const { staffId } = req.params;
      const { data, error } = await supabaseAdmin
        .from('classes')
        .select('id, title, subject, schedule, is_active')
        .eq('instructor_id', staffId)
        .order('title');
      if (error) throw error;
      res.json({ success: true, classes: data || [] });
    } catch (error) {
      console.error('❌ Get staff classes error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch staff classes',
        details: error.message,
      });
    }
  }

  async assignStaffToClasses(req, res) {
    try {
      const { staffId } = req.params;
      const { classIds } = req.body;

      if (!Array.isArray(classIds)) {
        return res.status(400).json({ error: 'classIds must be an array' });
      }

      const { error: unassignErr } = await supabaseAdmin
        .from('classes')
        .update({ instructor_id: null, updated_at: new Date().toISOString() })
        .eq('instructor_id', staffId);
      if (unassignErr) throw unassignErr;

      if (classIds.length > 0) {
        const { error: assignErr } = await supabaseAdmin
          .from('classes')
          .update({
            instructor_id: staffId,
            updated_at: new Date().toISOString(),
          })
          .in('id', classIds);
        if (assignErr) throw assignErr;
      }

      const { data, error } = await supabaseAdmin
        .from('classes')
        .select('id, title, subject, schedule, is_active')
        .eq('instructor_id', staffId);
      if (error) throw error;

      res.json({
        success: true,
        message: 'Staff assignments updated',
        classes: data || [],
      });
    } catch (error) {
      console.error('❌ Assign staff error:', error.message);
      res.status(500).json({
        error: 'Failed to assign staff',
        details: error.message,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NEWS / BLOG
  // ═══════════════════════════════════════════════════════════

  async getNews(req, res) {
    try {
      const { data, error } = await supabaseAdmin
        .from('news')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      res.json({ success: true, posts: data || [] });
    } catch (error) {
      console.error('❌ Get news error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch news',
        details: error.message,
      });
    }
  }

  async createNews(req, res) {
    try {
      const {
        title,
        slug,
        excerpt,
        content,
        cover_image_url,
        author,
        category,
        tags,
        read_time,
        link_url,
        is_published,
      } = req.body;

      if (!title) {
        return res.status(400).json({ error: 'Title is required' });
      }

      const baseSlug = (slug || title)
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 80);

      const finalSlug = `${baseSlug}-${Date.now().toString().slice(-5)}`;

      const tagsArray = Array.isArray(tags)
        ? tags
        : typeof tags === 'string'
        ? tags.split(',').map((t) => t.trim()).filter(Boolean)
        : [];

      const payload = {
        title,
        slug: finalSlug,
        content: content || '',
        excerpt: excerpt || null,
        cover_image_url: cover_image_url || null,
        author: author || null,
        category: category || null,
        tags: tagsArray,
        read_time: read_time || null,
        link_url: link_url || null,
        is_published: is_published !== false,
        published_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      };

      let { data, error } = await supabaseAdmin
        .from('news')
        .insert([payload])
        .select()
        .single();

      if (error) {
        console.warn('⚠️ Full insert failed →', error.message);
        const minimal = {
          title,
          slug: finalSlug,
          content: content || '',
        };
        const retry = await supabaseAdmin
          .from('news')
          .insert([minimal])
          .select()
          .single();

        if (retry.error) {
          console.error('❌ Minimal insert also failed →', {
            message: retry.error.message,
            code: retry.error.code,
            hint: retry.error.hint,
          });
          return res.status(500).json({
            error: 'Failed to create news',
            details: retry.error.message,
            code: retry.error.code,
            hint: retry.error.hint,
          });
        }
        data = retry.data;
      }

      res.status(201).json({ success: true, post: data });
    } catch (error) {
      console.error('❌ createNews crash →', error);
      res.status(500).json({
        error: 'Failed to create news',
        details: error.message,
      });
    }
  }

  async updateNews(req, res) {
    try {
      const { newsId } = req.params;
      const updates = { updated_at: new Date().toISOString() };

      [
        'title',
        'excerpt',
        'content',
        'cover_image_url',
        'author',
        'is_published',
        'slug',
        'category',
        'read_time',
        'link_url',
      ].forEach((k) => {
        if (req.body[k] !== undefined) updates[k] = req.body[k];
      });

      if (req.body.tags !== undefined) {
        updates.tags = Array.isArray(req.body.tags)
          ? req.body.tags
          : typeof req.body.tags === 'string'
          ? req.body.tags.split(',').map((t) => t.trim()).filter(Boolean)
          : [];
      }

      if (req.body.is_published === true) {
        const { data: existing } = await supabaseAdmin
          .from('news')
          .select('published_at')
          .eq('id', newsId)
          .limit(1);
        if (!existing?.[0]?.published_at) {
          updates.published_at = new Date().toISOString();
        }
      }

      const { data, error } = await supabaseAdmin
        .from('news')
        .update(updates)
        .eq('id', newsId)
        .select()
        .single();
      if (error) throw error;
      res.json({ success: true, post: data });
    } catch (error) {
      console.error('❌ Update news error:', error.message);
      res.status(500).json({
        error: 'Failed to update news',
        details: error.message,
      });
    }
  }

  async deleteNews(req, res) {
    try {
      const { newsId } = req.params;
      const { error } = await supabaseAdmin
        .from('news')
        .delete()
        .eq('id', newsId);
      if (error) throw error;
      res.json({ success: true, message: 'Post deleted' });
    } catch (error) {
      console.error('❌ Delete news error:', error.message);
      res.status(500).json({
        error: 'Failed to delete post',
        details: error.message,
      });
    }
  }
}

module.exports = new AdminController();
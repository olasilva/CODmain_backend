// src/controllers/adminController.js
const { supabaseAdmin } = require('../config/supabase');
const { sendMail } = require('../services/emailService');

let bcrypt = null;
try {
  bcrypt = require('bcryptjs');
} catch {
  try {
    bcrypt = require('bcrypt');
  } catch {
    console.warn(
      '⚠️ bcrypt/bcryptjs not installed — reset passwords will be saved ' +
        "as plaintext only and won't be usable for login."
    );
  }
}

const BCRYPT_ROUNDS = 10;

function isMusicAdmission(trackName, instrument) {
  return /music|instrument/i.test(String(trackName || '')) || Boolean(instrument);
}

function resolvePaymentDuration(body = {}) {
  const rawDuration =
    body.durationDays ??
    body.duration_days ??
    body.duration ??
    body.plan;
  if (rawDuration === undefined || rawDuration === null || rawDuration === '') return null;

  const value = String(rawDuration).trim().toLowerCase();
  const presets = {
    daily: { plan: 'daily', durationDays: 1 },
    day: { plan: 'daily', durationDays: 1 },
    monthly: { plan: 'monthly', durationDays: 30 },
    month: { plan: 'monthly', durationDays: 30 },
    termly: { plan: 'termly', durationDays: 90 },
    term: { plan: 'termly', durationDays: 90 },
    quarterly: { plan: 'termly', durationDays: 90 },
    yearly: { plan: 'custom', durationDays: 365 },
    annually: { plan: 'custom', durationDays: 365 },
    annual: { plan: 'custom', durationDays: 365 },
  };
  if (presets[value]) return presets[value];

  const match = value.match(/^(\d+)\s*(days?|d|weeks?|w|months?|mo|years?|y)?$/);
  if (!match) return null;

  const quantity = Number(match[1]);
  const unit = match[2] || 'days';
  const multiplier = /^(w|week)/.test(unit)
    ? 7
    : /^(mo|month)/.test(unit)
    ? 30
    : /^(y|year)/.test(unit)
    ? 365
    : 1;
  const durationDays = quantity * multiplier;
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) return null;

  const plan = durationDays === 1
    ? 'daily'
    : durationDays === 30
    ? 'monthly'
    : durationDays === 90
    ? 'termly'
    : 'custom';
  return { plan, durationDays };
}

function formatAdminPayment(payment) {
  const isPaid = payment.status === 'completed';
  const paidAt = isPaid
    ? payment.payment_date || payment.created_at || null
    : payment.payment_date || null;
  const paidMonth = paidAt && !Number.isNaN(new Date(paidAt).getTime())
    ? new Intl.DateTimeFormat('en-NG', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(paidAt))
    : null;

  return {
    ...payment,
    paid_at: paidAt,
    payment_month: paidMonth,
    paymentMonth: paidMonth,
  };
}

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
  staffId,
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
    link: staffId ? `/student/messages?teacher=${staffId}` : '/student/messages',
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

      const paymentHistoryMap = {};
      let admMap = {};
      let classMap = {};
      let rcMap = {};

      if (ids.length > 0) {
        const [payRes, admRes, scRes, rcRes] = await Promise.all([
          supabaseAdmin
            .from('payments')
            .select('id, student_id, payment_id, reference, amount, currency, status, payment_type, description, plan, duration_days, payment_date, created_at')
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
          paymentHistoryMap[p.student_id] = paymentHistoryMap[p.student_id] || [];
          paymentHistoryMap[p.student_id].push(formatAdminPayment(p));
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
        const paymentHistory = paymentHistoryMap[s.id] || [];
        const mostRecentPayment = paymentHistory[0] || null;
        const mostRecentPaidPayment = paymentHistory.find((payment) => payment.status === 'completed') || null;
        const totalPaid = paymentHistory
          .filter((payment) => payment.status === 'completed')
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
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
            : mostRecentPayment?.description || null,
          payment_status: mostRecentPayment?.status || 'none',
          latest_payment_status: mostRecentPayment?.status || 'none',
          payment_amount: Number(mostRecentPaidPayment?.amount || 0),
          amount_paid: Number(mostRecentPaidPayment?.amount || 0),
          payment_plan: mostRecentPaidPayment?.plan || null,
          payment_date: mostRecentPaidPayment?.paid_at || null,
          payment_month: mostRecentPaidPayment?.payment_month || null,
          paymentMonth: mostRecentPaidPayment?.payment_month || null,
          total_paid: totalPaid,
          payments: paymentHistory,
          payment_history: paymentHistory,
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

      const [paymentsRes, admissionsRes, reportCardsRes, invoicesRes, classesRes, idCardRequestsRes] =
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
          supabaseAdmin
            .from('id_card_requests')
            .select('*')
            .eq('student_id', studentId)
            .order('created_at', { ascending: false }),
        ]);

      if (student.user) delete student.user.password_hash;

      const payments = (paymentsRes.data || []).map(formatAdminPayment);
      const completedPayments = payments.filter((payment) => payment.status === 'completed');
      const totalPaid = completedPayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0
      );

      res.json({
        success: true,
        student,
        payments,
        paymentSummary: {
          totalPaid,
          completedCount: completedPayments.length,
          latestPaidPayment: completedPayments[0] || null,
        },
        admissions: admissionsRes.data || [],
        reportCards: reportCardsRes.data || [],
        invoices: invoicesRes.data || [],
        classes: (classesRes.data || []).map((r) => r.class).filter(Boolean),
        idCardRequests: idCardRequestsRes.data || [],
      });
    } catch (error) {
      console.error('❌ Get student details error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch student details',
        details: error.message,
      });
    }
  }

  async getIdCardRequests(req, res) {
    try {
      const status = req.query.status || 'pending';
      const { data: requests, error } = await supabaseAdmin
        .from('id_card_requests')
        .select('*')
        .eq('status', status)
        .order('submitted_at', { ascending: false });
      if (error) throw error;

      const studentIds = [...new Set((requests || []).map((request) => request.student_id))];
      let studentsById = {};
      let admissionsByStudentId = {};
      if (studentIds.length) {
        const [studentsResult, admissionsResult] = await Promise.all([
          supabaseAdmin
            .from('students')
            .select('id, user_id, student_id, full_name, email, academic_year, user:users(id, email, phone)')
            .in('id', studentIds),
          supabaseAdmin
            .from('admissions')
            .select('student_id, course, track_name, instrument, academic_year, status, created_at')
            .in('student_id', studentIds)
            .order('created_at', { ascending: false }),
        ]);
        if (studentsResult.error) throw studentsResult.error;
        if (admissionsResult.error) throw admissionsResult.error;
        const students = studentsResult.data;
        studentsById = Object.fromEntries((students || []).map((student) => [student.id, student]));
        (admissionsResult.data || []).forEach((admission) => {
          if (!admissionsByStudentId[admission.student_id]) {
            admissionsByStudentId[admission.student_id] = admission;
          }
        });
      }

      res.json({
        success: true,
        requests: (requests || []).map((request) => ({
          ...request,
          student: studentsById[request.student_id] || null,
          admission: admissionsByStudentId[request.student_id] || null,
        })),
      });
    } catch (error) {
      console.error('Get ID-card requests error:', error.message);
      if (error.code === 'PGRST205' || /id_card_requests.*schema cache/i.test(error.message || '')) {
        return res.status(503).json({
          error: 'ID-card request storage is not enabled. Apply backend/supabase/migrations/202610090002_student_id_cards.sql in Supabase.',
          code: 'ID_CARD_SCHEMA_MISSING',
        });
      }
      res.status(500).json({ error: 'Failed to fetch ID-card requests' });
    }
  }

  // ─── NEW: per-student ID-card requests ───
  // GET /api/admin/students/:studentId/id-card-requests
  async getStudentIdCardRequests(req, res) {
    try {
      const { studentId } = req.params;

      const { data: requests, error } = await supabaseAdmin
        .from('id_card_requests')
        .select('*')
        .eq('student_id', studentId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const { data: studentRows } = await supabaseAdmin
        .from('students')
        .select('id, user_id, student_id, full_name, email, academic_year')
        .eq('id', studentId)
        .maybeSingle();

      return res.json({
        success: true,
        studentId,
        student: studentRows || null,
        requests: requests || [],
        latest: (requests || [])[0] || null,
      });
    } catch (error) {
      console.error('Get student ID-card requests error:', error.message);
      if (
        error.code === 'PGRST205' ||
        /id_card_requests.*schema cache/i.test(error.message || '')
      ) {
        return res.status(503).json({
          error:
            'ID-card request storage is not enabled. Apply the student ID-card migration.',
          code: 'ID_CARD_SCHEMA_MISSING',
        });
      }
      return res
        .status(500)
        .json({ error: 'Failed to fetch student ID-card requests' });
    }
  }

  async approveIdCardRequest(req, res) {
    try {
      const { requestId } = req.params;
      const { data: pendingRequest, error: requestError } = await supabaseAdmin
        .from('id_card_requests')
        .select('student_id')
        .eq('id', requestId)
        .maybeSingle();
      if (requestError) throw requestError;
      if (!pendingRequest) return res.status(404).json({ error: 'ID-card request not found' });

      const { data: previousStudent, error: previousStudentError } = await supabaseAdmin
        .from('students')
        .select('student_id')
        .eq('id', pendingRequest.student_id)
        .maybeSingle();
      if (previousStudentError) throw previousStudentError;

      const { data, error } = await supabaseAdmin.rpc('approve_student_id_card_request', {
        p_request_id: requestId,
        p_admin_id: req.user.id,
      });
      if (error) {
        if (/not pending|not found/i.test(error.message)) {
          return res.status(409).json({ error: error.message });
        }
        throw error;
      }

      const result = Array.isArray(data) ? data[0] : data;
      const { data: student, error: studentError } = await supabaseAdmin
        .from('students')
        .select('id, student_id, user_id, full_name')
        .eq('id', result.student_id)
        .maybeSingle();
      if (studentError) throw studentError;

      if (previousStudent?.student_id !== student.student_id) {
        try {
          const notificationController = require('./notificationController');
          await notificationController.pushNotification({
            studentId: student.id,
            title: 'Student ID assigned',
            message: `Your student ID is ${student.student_id}. Your ID-card request has been approved.`,
            type: 'student_id_updated',
            link: '/student/profile',
          });
        } catch (notificationError) {
          console.warn('ID-card approval notification failed:', notificationError.message);
        }
      }

      return res.json({
        success: true,
        message: 'ID-card request approved and student ID generated',
        request: result,
        student,
      });
    } catch (error) {
      console.error('Approve ID-card request error:', error.message);
      return res.status(500).json({ error: 'Failed to approve ID-card request' });
    }
  }

  // ─── NEW: per-student ID-card approval ───
  // POST /api/admin/students/:studentId/id-card-requests/:requestId/approve
  async approveStudentIdCardRequest(req, res) {
    try {
      const { studentId, requestId } = req.params;
      const { studentType } = req.body || {};

      // 1. Load the request and confirm it belongs to this student
      const { data: request, error: reqErr } = await supabaseAdmin
        .from('id_card_requests')
        .select('id, student_id, status')
        .eq('id', requestId)
        .maybeSingle();
      if (reqErr) throw reqErr;
      if (!request) return res.status(404).json({ error: 'ID-card request not found' });
      if (String(request.student_id) !== String(studentId)) {
        return res
          .status(403)
          .json({ error: 'Request does not belong to this student' });
      }
      if (request.status !== 'pending') {
        return res
          .status(409)
          .json({ error: 'ID-card request is not pending' });
      }

      // 2. Load student to check current ID
      const { data: studentRow, error: stuErr } = await supabaseAdmin
        .from('students')
        .select('id, user_id, student_id, full_name, email')
        .eq('id', studentId)
        .maybeSingle();
      if (stuErr) throw stuErr;
      if (!studentRow) {
        return res.status(404).json({ error: 'Student not found' });
      }

      // 3. Decide the ID format based on studentType or admission track
      let resolvedType = String(studentType || '').toLowerCase();
      if (!['regular', 'music'].includes(resolvedType)) {
        const { data: admRow } = await supabaseAdmin
          .from('admissions')
          .select('track_name, instrument')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        resolvedType = isMusicAdmission(admRow?.track_name, admRow?.instrument)
          ? 'music'
          : 'regular';
      }

      // 4. Generate the student ID if one isn't set yet
      let generatedStudentId = studentRow.student_id;
      if (!generatedStudentId) {
        const year = new Date().getFullYear();
        const seq = String(Date.now()).slice(-5);
        generatedStudentId =
          resolvedType === 'music'
            ? `COD-${year}-${seq}`
            : `COD-${year - 1}/${year}-${seq}`;

        const { error: updErr } = await supabaseAdmin
          .from('students')
          .update({
            student_id: generatedStudentId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', studentId);
        if (updErr) throw updErr;
      }

      // 5. Mark the request approved
      const now = new Date().toISOString();
      const { data: updatedRequest, error: updateErr } = await supabaseAdmin
        .from('id_card_requests')
        .update({
          status: 'approved',
          reviewed_at: now,
          reviewed_by: req.user?.id || null,
          updated_at: now,
        })
        .eq('id', requestId)
        .select()
        .maybeSingle();
      if (updateErr) throw updateErr;

      // 6. Notify the student
      try {
        const notificationController = require('./notificationController');
        await notificationController.pushNotification({
          studentId,
          title: 'Student ID assigned',
          message: `Your student ID is ${generatedStudentId}. Your ID-card request has been approved.`,
          type: 'student_id_updated',
          link: '/student/profile',
        });
      } catch (notificationError) {
        console.warn(
          'ID-card approval notification failed:',
          notificationError.message
        );
      }

      return res.json({
        success: true,
        message: 'ID-card request approved',
        request: updatedRequest,
        studentId: generatedStudentId,
        studentType: resolvedType,
      });
    } catch (error) {
      console.error('Approve student ID-card request error:', error.message);
      return res
        .status(500)
        .json({ error: 'Failed to approve student ID-card request' });
    }
  }

  async rejectIdCardRequest(req, res) {
    try {
      const { requestId } = req.params;
      const { adminNote } = req.body || {};
      const { data: request, error } = await supabaseAdmin
        .from('id_card_requests')
        .update({
          status: 'rejected',
          admin_note: adminNote || null,
          reviewed_at: new Date().toISOString(),
          reviewed_by: req.user.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', requestId)
        .eq('status', 'pending')
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!request) return res.status(409).json({ error: 'ID-card request not found or is no longer pending' });

      try {
        const notificationController = require('./notificationController');
        await notificationController.pushNotification({
          studentId: request.student_id,
          title: 'ID-card request needs attention',
          message: adminNote || 'Your ID-card request was not approved. Please contact the school admin.',
          type: 'id_card_request',
          link: '/student/profile',
        });
      } catch (notificationError) {
        console.warn('ID-card rejection notification failed:', notificationError.message);
      }

      return res.json({ success: true, request });
    } catch (error) {
      console.error('Reject ID-card request error:', error.message);
      return res.status(500).json({ error: 'Failed to reject ID-card request' });
    }
  }

  async updateStudent(req, res) {
    try {
      const { studentId } = req.params;
      const { fullName, email, phone, status, academic_year } = req.body;
      const requestedStudentId = req.body.studentIdNumber ?? req.body.student_id;
      const { data: existingStudent, error: existingStudentError } = await supabaseAdmin
        .from('students')
        .select('id, user_id, student_id')
        .eq('id', studentId)
        .maybeSingle();
      if (existingStudentError) throw existingStudentError;
      if (!existingStudent) return res.status(404).json({ error: 'Student not found' });

      const sUpdates = {};
      if (fullName !== undefined) sUpdates.full_name = fullName.trim();
      if (status !== undefined) sUpdates.status = status;
      if (academic_year !== undefined) sUpdates.academic_year = academic_year;
      if (requestedStudentId !== undefined) {
        const newStudentId = String(requestedStudentId).trim();
        const { data: admissions, error: admissionError } = await supabaseAdmin
          .from('admissions')
          .select('track_name, instrument')
          .eq('student_id', studentId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (admissionError) throw admissionError;
        const isMusic = isMusicAdmission(admissions?.[0]?.track_name, admissions?.[0]?.instrument);
        const validId = isMusic
          ? /^COD-\d{4}-\d{3,}$/.test(newStudentId)
          : /^COD-\d{4}\/\d{4}-\d{4,}$/.test(newStudentId);
        if (!validId) {
          return res.status(400).json({
            error: isMusic
              ? 'Music student IDs must use COD-YYYY-NNN format'
              : 'Regular student IDs must use COD-YYYY/YYYY-NNNN format',
          });
        }
        sUpdates.student_id = newStudentId;
      }

      if (Object.keys(sUpdates).length > 0) {
        sUpdates.updated_at = new Date().toISOString();
        const { error } = await supabaseAdmin
          .from('students')
          .update(sUpdates)
          .eq('id', studentId);
        if (error) throw error;
      }

      const userId = existingStudent.user_id;

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

      if (
        requestedStudentId !== undefined &&
        String(requestedStudentId).trim() !== existingStudent.student_id
      ) {
        try {
          const notificationController = require('./notificationController');
          await notificationController.pushNotification({
            studentId,
            title: 'Student ID updated',
            message: `Your student ID has been changed to ${String(requestedStudentId).trim()}.`,
            type: 'student_id_updated',
            link: '/student/profile',
          });
        } catch (notificationError) {
          console.warn('Student ID change notification failed:', notificationError.message);
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

  async getAdmissions(req, res) {
    try {
      const { status } = req.query;
      let query = supabaseAdmin
        .from('admissions')
        .select('*')
        .order('created_at', { ascending: false });
      if (status === 'pending') query = query.in('status', ['pending', 'payment_submitted']);
      else if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      res.json({
        success: true,
        admissions: (data || []).map((admission) => ({
          ...admission,
          confirmationPrompt: `Are you sure you want to approve ${admission.student_name || 'this student'}'s admission?`,
          approvalEndpoint: `/api/admin/admissions/${admission.id}/approve`,
        })),
      });
    } catch (error) {
      console.error('❌ Get admissions error:', error.message);
      res.status(500).json({
        error: 'Failed to fetch admissions',
        details: error.message,
      });
    }
  }

  async getAdmissionReviewQueue(req, res) {
    try {
      const { data: admissions, error } = await supabaseAdmin
        .from('admissions')
        .select('*')
        .in('status', ['pending', 'payment_submitted'])
        .order('created_at', { ascending: false });
      if (error) throw error;

      const studentIds = [...new Set((admissions || []).map((admission) => admission.student_id))];
      const studentMap = {};
      const userIds = [];
      if (studentIds.length) {
        const { data: students, error: studentsError } = await supabaseAdmin
          .from('students')
          .select('id, user_id, student_id, full_name, email')
          .in('id', studentIds);
        if (studentsError) throw studentsError;
        (students || []).forEach((student) => {
          studentMap[student.id] = student;
          if (student.user_id) userIds.push(student.user_id);
        });
      }

      const userMap = {};
      if (userIds.length) {
        const { data: users, error: usersError } = await supabaseAdmin
          .from('users')
          .select('id, email, phone')
          .in('id', [...new Set(userIds)]);
        if (usersError) throw usersError;
        (users || []).forEach((user) => { userMap[user.id] = user; });
      }

      const reviewItems = (admissions || []).map((admission) => {
        const student = studentMap[admission.student_id] || null;
        const user = student?.user_id ? userMap[student.user_id] : null;
        const rawAmount = admission.amount_due ?? admission.fee_amount ?? process.env.ADMISSION_FEE_AMOUNT;
        const parsedAmount = Number(rawAmount);
        const paymentSubmitted = admission.status === 'payment_submitted';
        return {
          ...admission,
          reviewType: paymentSubmitted ? 'bank_transfer' : 'admission',
          paymentStatus: paymentSubmitted ? 'awaiting_admin_verification' : 'awaiting_transfer',
          confirmationPrompt: `Are you sure you want to approve ${admission.student_name || student?.full_name || 'this student'}'s admission?`,
          amountDue:
            rawAmount !== undefined && rawAmount !== null && rawAmount !== '' && Number.isFinite(parsedAmount)
              ? parsedAmount
              : null,
          amountPaid: admission.amount_paid === null || admission.amount_paid === undefined
            ? null
            : Number(admission.amount_paid),
          student: student
            ? { ...student, email: user?.email || student.email || admission.guardian_email || null, phone: user?.phone || admission.guardian_phone || null }
            : null,
        };
      });

      return res.json({
        success: true,
        items: reviewItems,
        summary: {
          pendingAdmissions: reviewItems.filter((item) => item.status === 'pending').length,
          transfersAwaitingVerification: reviewItems.filter((item) => item.status === 'payment_submitted').length,
          total: reviewItems.length,
        },
      });
    } catch (error) {
      console.error('Get admission review queue error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch admission review queue' });
    }
  }

  async approveAdmission(req, res) {
    let approvalStage = 'load admission';
    try {
      const { admissionId } = req.params;
      const { confirmationMessage } = req.body || {};
      const { data: admission, error: admissionError } = await supabaseAdmin
        .from('admissions')
        .select('*')
        .eq('id', admissionId)
        .maybeSingle();
      if (admissionError) throw admissionError;
      if (!admission) {
        return res.status(404).json({ error: 'Admission not found' });
      }
      if (admission.status === 'rejected') {
        return res.status(409).json({ error: 'Rejected admissions cannot be approved' });
      }
      approvalStage = 'load student account';
      const { data: student, error: studentError } = await supabaseAdmin
        .from('students')
        .select('user_id, email, full_name')
        .eq('id', admission.student_id)
        .maybeSingle();
      if (studentError) throw studentError;

      let user = null;
      if (student?.user_id) {
        const { data: userRows, error: userError } = await supabaseAdmin
          .from('users')
          .select('email, full_name')
          .eq('id', student.user_id)
          .limit(1);
        if (userError) throw userError;
        user = userRows?.[0] || null;
      }

      let updatedAdmission = admission;
      let approvedPaymentAmount = null;
      let approvedPaymentDuration = null;
      if (admission.status !== 'approved') {
        const submittedAmount =
          req.body?.amountReceived ??
          req.body?.amount_received ??
          req.body?.amountPaid ??
          req.body?.amount_paid ??
          req.body?.selectedAmount ??
          req.body?.selected_amount ??
          req.body?.amountToPay ??
          req.body?.amount_to_pay ??
          req.body?.amount ??
          admission.amount_paid ??
          admission.amount_due ??
          admission.fee_amount ??
          process.env.ADMISSION_FEE_AMOUNT;
        if (admission.status === 'payment_submitted') {
          const parsedAmount = Number(submittedAmount);
          approvedPaymentDuration = resolvePaymentDuration(req.body);
          if (
            submittedAmount === undefined ||
            submittedAmount === null ||
            submittedAmount === '' ||
            !Number.isFinite(parsedAmount) ||
            parsedAmount <= 0
          ) {
            return res.status(400).json({
              error: 'A valid selected payment amount is required to approve this bank transfer.',
              code: 'PAYMENT_AMOUNT_REQUIRED',
            });
          }
          if (!approvedPaymentDuration) {
            return res.status(400).json({
              error: 'A valid payment duration is required (for example: monthly, termly, or 45 days).',
              code: 'PAYMENT_DURATION_REQUIRED',
            });
          }
          approvedPaymentAmount = parsedAmount;
        }

        approvalStage = 'update admission status';
        const admissionUpdates = {
          status: 'approved',
          updated_at: new Date().toISOString(),
        };
        if (admission.status === 'payment_submitted') {
          admissionUpdates.amount_paid = Number(submittedAmount);
        }
        const { data, error: updateError } = await supabaseAdmin
          .from('admissions')
          .update(admissionUpdates)
          .eq('id', admissionId)
          .in('status', ['pending', 'payment_submitted'])
          .select()
          .maybeSingle();
        if (updateError) throw updateError;
        if (!data) {
          return res.status(409).json({ error: 'Admission is no longer pending review' });
        }
        updatedAdmission = data;
      }

      const recipient = user?.email || student?.email || admission.guardian_email;
      let paymentRecorded = false;
      let paymentWarning = null;
      if (admission.status === 'payment_submitted') {
        const rawAmount =
          req.body?.amountReceived ??
          req.body?.amount_received ??
          req.body?.amountPaid ??
          req.body?.amount_paid ??
          req.body?.selectedAmount ??
          req.body?.selected_amount ??
          req.body?.amountToPay ??
          req.body?.amount_to_pay ??
          req.body?.amount ??
          admission.amount_paid ??
          admission.amount_due ??
          admission.fee_amount ??
          process.env.ADMISSION_FEE_AMOUNT;
        const amount = Number(rawAmount);
        if (
          rawAmount === undefined ||
          rawAmount === null ||
          rawAmount === '' ||
          !Number.isFinite(amount) ||
          amount <= 0
        ) {
          paymentWarning = 'Admission approved, but payment history was not recorded because no valid fee amount is configured.';
        } else {
          const paymentId = `BANK-${admission.id}`;
          try {
            const { data: existingPayment, error: existingPaymentError } = await supabaseAdmin
              .from('payments')
              .select('id')
              .eq('payment_id', paymentId)
              .maybeSingle();
            if (existingPaymentError) throw existingPaymentError;

            if (!existingPayment) {
              const paidAt = updatedAdmission.updated_at || new Date().toISOString();
              const { error: paymentInsertError } = await supabaseAdmin
                .from('payments')
                .insert({
                  student_id: admission.student_id,
                  payment_id: paymentId,
                  reference: `BANK-${admission.admission_number || admission.id}`,
                  amount,
                  currency: 'NGN',
                  plan: approvedPaymentDuration?.plan || 'monthly',
                  duration_days: approvedPaymentDuration?.durationDays || 30,
                  payment_type: 'school_fees',
                  payment_method: 'bank_transfer',
                  description: [admission.course, admission.track_name].filter(Boolean).join(' · ') || 'School fees',
                  status: 'completed',
                  payer_email: recipient || null,
                  payment_date: paidAt,
                  created_at: paidAt,
                  updated_at: paidAt,
                });
              if (paymentInsertError) throw paymentInsertError;
            }
            paymentRecorded = true;
          } catch (paymentError) {
            console.error('Approved transfer payment history insert failed:', paymentError.message);
            paymentWarning = 'Admission approved, but the payment history record could not be saved.';
          }
        }
      }

      const message = String(confirmationMessage || '').trim() ||
        `Your admission to ${admission.course || 'Clan of David Music'} has been approved. You can now log in to your student account.`;
      const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '');
      const loginUrl = `${frontendUrl}/login?email=${encodeURIComponent(recipient || '')}`;
      const htmlMessage = message
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/\n/g, '<br>');
      approvalStage = 'send approval email';
      const emailInfo = await sendMail({
        to: recipient,
        subject: 'Your admission has been approved',
        text: `${message}\n\nLog in to your student account: ${loginUrl}`,
        html: `<p>${htmlMessage}</p><p><a href="${loginUrl}">Log in to your student account</a></p>`,
      });

      return res.json({
        success: true,
        admission: updatedAdmission,
        emailSent: Boolean(emailInfo),
        email: recipient || null,
        paymentRecorded,
        amountReceived: approvedPaymentAmount,
        duration: approvedPaymentDuration,
        message: admission.status === 'approved'
          ? 'Admission is approved; confirmation email resent'
          : 'Admission approved and confirmation email sent',
        ...(emailInfo ? {} : { emailWarning: 'Admission approved, but email delivery failed. Check SMTP configuration and retry notification.' }),
        ...(paymentWarning ? { paymentWarning } : {}),
      });
    } catch (error) {
      console.error(`❌ Approve admission error during ${approvalStage}:`, error);
      return res.status(500).json({
        error: `Failed to approve admission during ${approvalStage}: ${error.message}`,
        stage: approvalStage,
        details: error.message,
      });
    }
  }

  async rejectAdmission(req, res) {
    try {
      const { admissionId } = req.params;
      const { adminNote } = req.body || {};
      const { data: admission, error } = await supabaseAdmin
        .from('admissions')
        .update({
          status: 'rejected',
          admin_note: adminNote || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', admissionId)
        .neq('status', 'approved')
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!admission) return res.status(409).json({ error: 'Admission not found or already approved' });

      return res.json({ success: true, admission });
    } catch (error) {
      console.error('Reject admission error:', error.message);
      return res.status(500).json({ error: 'Failed to reject admission' });
    }
  }

  async getPayments(req, res) {
    try {
      const { status, studentId } = req.query;
      let query = supabaseAdmin
        .from('payments')
        .select(
          `id, payment_id, reference, amount, plan, duration_days, status, description,
           payer_email, payment_date, created_at, student_id,
           student:students ( id, student_id, full_name )`
        )
        .order('created_at', { ascending: false });
      if (status) query = query.eq('status', status);
      if (studentId) query = query.eq('student_id', studentId);

      const [paymentsResult, transfersResult] = await Promise.all([
        query,
        supabaseAdmin
          .from('admissions')
          .select('*')
          .eq('status', 'payment_submitted')
          .order('created_at', { ascending: false }),
      ]);
      const { data, error } = paymentsResult;
      if (error) throw error;
      if (transfersResult.error) throw transfersResult.error;

      const includeTransfers = !status || ['pending', 'payment_submitted'].includes(status);
      const bankTransfers = includeTransfers
        ? (transfersResult.data || [])
            .filter((admission) => !studentId || admission.student_id === studentId)
            .map((admission) => {
              const rawAmount =
                admission.selected_amount ??
                admission.selectedAmount ??
                admission.amount_paid ??
                admission.amount_due ??
                admission.fee_amount ??
                process.env.ADMISSION_FEE_AMOUNT;
              const parsedAmount = Number(rawAmount);
              const amount =
                rawAmount !== undefined && rawAmount !== null && rawAmount !== '' && Number.isFinite(parsedAmount)
                  ? parsedAmount
                  : null;

              return {
                id: admission.id,
                payment_id: admission.admission_number || admission.id,
                reference: admission.admission_number || null,
                amount,
                amount_paid: amount,
                selected_amount: amount,
                plan: null,
                status: 'pending',
                payment_type: 'bank_transfer',
                description: `Bank transfer reported for ${[admission.course, admission.track_name].filter(Boolean).join(' · ')}`,
                payer_email: admission.guardian_email || null,
                payment_date: null,
                created_at: admission.created_at,
                student_id: admission.student_id,
                student: {
                  id: admission.student_id,
                  student_id: null,
                  full_name: admission.student_name || null,
                },
                admission_id: admission.id,
                admission_status: admission.status,
                confirmationPrompt: `Are you sure you want to approve ${admission.student_name || 'this student'}'s admission?`,
                approval_endpoint: `/api/admin/payments/${admission.id}/approve`,
              };
            })
        : [];
      const paymentList = [...(data || []), ...bankTransfers].sort(
        (left, right) => new Date(right.created_at || 0) - new Date(left.created_at || 0)
      );

      const completed = paymentList.filter((p) => p.status === 'completed');
      const pending = paymentList.filter((p) => p.status === 'pending');
      const failed = paymentList.filter((p) => p.status === 'failed');

      res.json({
        success: true,
        payments: paymentList,
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
          countTotal: paymentList.length,
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

  // ─── NEW: approve a bank transfer payment row ───
  // POST /api/admin/payments/:paymentId/approve
  // Body: { amountReceived, duration, durationUnit, durationDays, loginUrl }
  async approveBankTransfer(req, res) {
    try {
      const { paymentId } = req.params;
      const {
        amountReceived,
        duration,
        durationUnit,
        durationDays,
      } = req.body || {};

      // 1. Load the payment
      const { data: payment, error: payErr } = await supabaseAdmin
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .maybeSingle();
      if (payErr) throw payErr;
      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }
      if (!payment.student_id) {
        return res.status(400).json({
          error:
            'This payment has no linked student. Cannot approve it automatically.',
        });
      }

      // 2. Resolve amount + duration
      const numericAmount = Number(
        amountReceived ?? payment.amount ?? 0
      );
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res
          .status(400)
          .json({ error: 'A valid received amount is required.' });
      }

      // Prefer explicit durationDays; otherwise derive from duration+unit
      let resolvedDuration = resolvePaymentDuration(req.body);
      if (!resolvedDuration && durationDays) {
        resolvedDuration = {
          plan: 'custom',
          durationDays: Number(durationDays) || 30,
        };
      }
      if (!resolvedDuration) {
        resolvedDuration = { plan: 'monthly', durationDays: 30 };
      }

      // 3. Mark the payment completed
      const now = new Date().toISOString();
      const { data: updatedPayment, error: updateErr } = await supabaseAdmin
        .from('payments')
        .update({
          status: 'completed',
          amount: numericAmount,
          plan: resolvedDuration.plan,
          duration_days: resolvedDuration.durationDays,
          payment_date: now,
          updated_at: now,
        })
        .eq('id', paymentId)
        .select()
        .maybeSingle();
      if (updateErr) throw updateErr;

      // 4. Find the linked admission — by student_id, NOT by id
      let admission = null;
      let admissionApproved = false;
      const { data: admissionRows, error: admErr } = await supabaseAdmin
        .from('admissions')
        .select('*')
        .eq('student_id', payment.student_id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (admErr) throw admErr;
      admission = admissionRows?.[0] || null;

      if (admission) {
        if (admission.status !== 'approved') {
          const { data: updAdm, error: updAdmErr } = await supabaseAdmin
            .from('admissions')
            .update({
              status: 'approved',
              amount_paid: numericAmount,
              updated_at: now,
            })
            .eq('id', admission.id)
            .select()
            .maybeSingle();
          if (updAdmErr) throw updAdmErr;
          admission = updAdm || admission;
        }
        admissionApproved = true;
      }

      // 5. Send confirmation email (best-effort)
      let emailSent = false;
      try {
        const { data: studentRows } = await supabaseAdmin
          .from('students')
          .select('user_id, email, full_name, user:users ( email, full_name )')
          .eq('id', payment.student_id)
          .maybeSingle();

        const recipient =
          studentRows?.user?.email ||
          studentRows?.email ||
          payment.payer_email ||
          null;

        if (recipient) {
          const frontendUrl = (
            process.env.FRONTEND_URL || 'http://localhost:5173'
          )
            .split(',')[0]
            .trim()
            .replace(/\/$/, '');
          const loginUrl = `${frontendUrl}/login?email=${encodeURIComponent(
            recipient
          )}`;
          const emailInfo = await sendMail({
            to: recipient,
            subject: 'Your payment has been approved',
            text: `Your payment of ₦${numericAmount.toLocaleString()} has been approved. Log in: ${loginUrl}`,
            html: `<p>Your payment of <strong>₦${numericAmount.toLocaleString()}</strong> has been approved.</p><p><a href="${loginUrl}">Log in to your student account</a></p>`,
          });
          emailSent = Boolean(emailInfo);
        }
      } catch (mailErr) {
        console.warn('Approval email failed:', mailErr.message);
      }

      return res.json({
        success: true,
        message: admissionApproved
          ? 'Payment approved and admission linked.'
          : 'Payment approved. No admission on file for this student.',
        payment: updatedPayment || payment,
        admission,
        admissionApproved,
        amountReceived: numericAmount,
        duration: resolvedDuration,
        emailSent,
      });
    } catch (error) {
      console.error('❌ Approve bank transfer error:', error.message);
      return res.status(500).json({
        error: 'Failed to approve bank transfer',
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
          staffId,
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
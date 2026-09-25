// src/controllers/studentController.js
const { supabaseAdmin } = require('../config/supabase');
const supabaseService = require('../services/supabaseService');

// ============ HELPERS ============
async function findStudent(userId) {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('id, user_id, student_id, full_name, status')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function ensureStudent(req) {
  const userId = req.user.id;
  let student = await findStudent(userId);
  if (student) return student;

  const { data: userRows } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name')
    .eq('id', userId)
    .limit(1);
  const user = userRows?.[0] || null;

  const { data: created, error: createErr } = await supabaseAdmin
    .from('students')
    .insert([
      {
        user_id: userId,
        student_id: `STU-${Date.now()}`,
        full_name: user?.full_name || user?.email?.split('@')[0] || null,
        email: user?.email || null,
        status: 'active',
        created_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  if (createErr) {
    if (createErr.code === '23505') return await findStudent(userId);
    throw createErr;
  }
  return created;
}

// ============ MY PROGRAMME ============
async function getMyProgramme(req, res) {
  try {
    const userId = req.user?.id;
    const student = await findStudent(userId);
    if (!student) return res.json({ success: true, programme: null });

    const { data: admRows, error } = await supabaseAdmin
      .from('admissions')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;

    const adm = admRows?.[0] || null;
    if (!adm) return res.json({ success: true, programme: null });

    res.json({
      success: true,
      programme: {
        id: adm.id,
        course: adm.course,
        trackName: adm.track_name,
        regularClass: adm.regular_class || null,
        instrument: adm.instrument || null,
        academicYear: adm.academic_year,
        status: adm.status,
        admissionNumber: adm.admission_number,
        enrolledAt: adm.created_at,
        description: [adm.course, adm.track_name].filter(Boolean).join(' · '),
      },
    });
  } catch (error) {
    console.error('❌ getMyProgramme error:', error.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch your programme', details: error.message });
  }
}

// ============ MY CLASSES ============
async function getMyEnrolledClasses(req, res) {
  try {
    const userId = req.user?.id;
    const student = await findStudent(userId);
    if (!student) return res.json({ success: true, classes: [] });

    const { data: rows, error } = await supabaseAdmin
      .from('student_classes')
      .select(
        `id, status, enrollment_date,
         class:class_id (
           id, title, subject, schedule,
           instructor:instructor_id ( id, full_name, email, avatar_url )
         )`
      )
      .eq('student_id', student.id)
      .eq('status', 'active');
    if (error) throw error;

    const classes = (rows || []).map((r) => r.class).filter(Boolean);
    res.json({ success: true, classes });
  } catch (error) {
    console.error('❌ getMyEnrolledClasses error:', error.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch your classes', details: error.message });
  }
}

// ============ PROFILE ============
async function getProfile(req, res) {
  try {
    const userId = req.user.id;
    const user = await supabaseService.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const { data: studentRows, error } = await supabaseAdmin
      .from('students')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);

    if (error) throw error;
    delete user.password_hash;

    res.json({ user, student: studentRows?.[0] || null });
  } catch (error) {
    console.error('Get profile error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch profile', details: error.message });
  }
}

async function updateProfile(req, res) {
  try {
    const userId = req.user.id;
    const updates = req.body;

    const userUpdates = {};
    const studentUpdates = {};
    const userFields = ['full_name', 'phone', 'address', 'avatar_url'];
    const studentFields = [
      'date_of_birth',
      'nationality',
      'country_of_residence',
      'emergency_contact',
      'emergency_phone',
    ];

    Object.keys(updates).forEach((key) => {
      if (userFields.includes(key)) userUpdates[key] = updates[key];
      if (studentFields.includes(key)) studentUpdates[key] = updates[key];
    });

    if (Object.keys(userUpdates).length > 0) {
      await supabaseService.update('users', userId, userUpdates);
    }

    if (Object.keys(studentUpdates).length > 0) {
      const student = await findStudent(userId);
      if (student) {
        await supabaseService.update('students', student.id, studentUpdates);
      }
    }

    res.json({ message: 'Profile updated successfully' });
  } catch (error) {
    console.error('Update profile error:', error);
    res
      .status(500)
      .json({ error: 'Failed to update profile', details: error.message });
  }
}

// ============ COURSES (legacy) ============
async function getCourses(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student?.id) return res.json([]);

    const { data, error } = await supabaseAdmin
      .from('enrollments')
      .select('*')
      .eq('student_id', student.id);

    if (error) {
      console.warn('⚠️ [getCourses] enrollments query error:', error.message);
      return res.json([]);
    }
    res.json(data || []);
  } catch (error) {
    console.error('❌ Get courses error:', error);
    res.json([]);
  }
}

async function getCourseDetails(req, res) {
  try {
    const { courseId } = req.params;
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: courseRows, error } = await supabaseAdmin
      .from('programmes')
      .select('*')
      .eq('id', courseId)
      .limit(1);
    if (error) throw error;

    const course = courseRows?.[0];
    if (!course) return res.status(404).json({ error: 'Course not found' });
    res.json(course);
  } catch (error) {
    console.error('Get course details error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch course details', details: error.message });
  }
}

// ============ ASSIGNMENTS ============
async function getAssignments(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: submissions } = await supabaseAdmin
      .from('submissions')
      .select('*, assignment:assignment_id (*)')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });

    const { data: myClassRows } = await supabaseAdmin
      .from('student_classes')
      .select('class_id')
      .eq('student_id', student.id)
      .eq('status', 'active');

    const myClassIds = (myClassRows || []).map((r) => r.class_id);

    let pending = [];
    if (myClassIds.length > 0) {
      const { data: allAssignments } = await supabaseAdmin
        .from('assignments')
        .select('*, class:class_id ( id, title )')
        .in('class_id', myClassIds)
        .eq('is_published', true)
        .order('due_date', { ascending: true });

      const submittedIds = (submissions || []).map((s) => s.assignment_id);
      pending = (allAssignments || []).filter(
        (a) => !submittedIds.includes(a.id)
      );
    }

    res.json({ submitted: submissions || [], pending });
  } catch (error) {
    console.error('Get assignments error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch assignments', details: error.message });
  }
}

async function getAssignmentDetails(req, res) {
  try {
    const { assignmentId } = req.params;
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: assignmentRows, error } = await supabaseAdmin
      .from('assignments')
      .select('*, class:class_id ( id, title )')
      .eq('id', assignmentId)
      .limit(1);
    if (error) throw error;

    const assignment = assignmentRows?.[0];
    if (!assignment)
      return res.status(404).json({ error: 'Assignment not found' });

    const { data: submissionRows } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', student.id)
      .limit(1);

    res.json({ ...assignment, my_submission: submissionRows?.[0] || null });
  } catch (error) {
    console.error('Get assignment details error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch assignment details',
        details: error.message,
      });
  }
}

async function submitAssignment(req, res) {
  try {
    const { assignmentId } = req.params;
    const { content, attachments } = req.body;

    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: assignmentRows } = await supabaseAdmin
      .from('assignments')
      .select('id, due_date, is_published')
      .eq('id', assignmentId)
      .limit(1);
    const assignment = assignmentRows?.[0];

    if (!assignment)
      return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.is_published === false) {
      return res.status(400).json({ error: 'Assignment is not available' });
    }

    const { data: existingRows } = await supabaseAdmin
      .from('submissions')
      .select('id')
      .eq('assignment_id', assignmentId)
      .eq('student_id', student.id)
      .limit(1);

    if (existingRows?.length > 0) {
      return res.status(409).json({ error: 'Assignment already submitted' });
    }

    const { data: submission, error } = await supabaseAdmin
      .from('submissions')
      .insert([
        {
          assignment_id: assignmentId,
          student_id: student.id,
          content,
          attachments: attachments || [],
          status: 'submitted',
          submission_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();
    if (error) throw error;

    res
      .status(201)
      .json({ message: 'Assignment submitted successfully', submission });
  } catch (error) {
    console.error('Submit assignment error:', error);
    res
      .status(500)
      .json({ error: 'Failed to submit assignment', details: error.message });
  }
}

// ============ CLASSES ============
async function getClasses(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: rows, error } = await supabaseAdmin
      .from('student_classes')
      .select(
        `id, status, enrollment_date,
         class:class_id (
           id, title, subject, schedule,
           instructor:instructor_id ( id, full_name, email, avatar_url )
         )`
      )
      .eq('student_id', student.id)
      .eq('status', 'active');
    if (error) throw error;

    const classes = (rows || []).map((r) => ({
      id: r.id,
      status: r.status,
      enrollment_date: r.enrollment_date,
      ...r.class,
    }));

    res.json(classes);
  } catch (error) {
    console.error('Get classes error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch classes', details: error.message });
  }
}

async function getClassDetails(req, res) {
  try {
    const { classId } = req.params;
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: enrollmentRows } = await supabaseAdmin
      .from('student_classes')
      .select('id')
      .eq('student_id', student.id)
      .eq('class_id', classId)
      .eq('status', 'active')
      .limit(1);

    if (!enrollmentRows || enrollmentRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this class' });
    }

    const { data: classRows, error } = await supabaseAdmin
      .from('classes')
      .select('*, instructor:instructor_id ( id, full_name, email, avatar_url )')
      .eq('id', classId)
      .limit(1);
    if (error) throw error;

    const classData = classRows?.[0];
    if (!classData) return res.status(404).json({ error: 'Class not found' });
    res.json(classData);
  } catch (error) {
    console.error('Get class details error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch class details',
        details: error.message,
      });
  }
}

// ============ RESULTS ============
async function getResults(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: reportCards, error: rcErr } = await supabaseAdmin
      .from('report_cards')
      .select('*')
      .eq('student_id', student.id)
      .order('session', { ascending: false })
      .order('term', { ascending: false });

    if (!rcErr && reportCards && reportCards.length > 0) {
      return res.json({
        results: reportCards,
        overall_gpa: null,
        total_credits: 0,
        source: 'report_cards',
      });
    }

    const { data: results, error } = await supabaseAdmin
      .from('results')
      .select('*')
      .eq('student_id', student.id);
    if (error) throw error;

    let totalCredits = 0;
    let totalPoints = 0;
    (results || []).forEach((r) => {
      if (r.gpa && r.credits_earned) {
        totalCredits += r.credits_earned;
        totalPoints += r.gpa * r.credits_earned;
      }
    });
    const overallGPA =
      totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : null;

    res.json({
      results: results || [],
      overall_gpa: overallGPA,
      total_credits: totalCredits,
      source: 'results',
    });
  } catch (error) {
    console.error('Get results error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch results', details: error.message });
  }
}

async function getResultDetails(req, res) {
  try {
    const { resultId } = req.params;
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: rcRows } = await supabaseAdmin
      .from('report_cards')
      .select('*')
      .eq('id', resultId)
      .eq('student_id', student.id)
      .limit(1);
    if (rcRows?.[0]) return res.json(rcRows[0]);

    const { data: resultRows, error } = await supabaseAdmin
      .from('results')
      .select('*')
      .eq('id', resultId)
      .eq('student_id', student.id)
      .limit(1);
    if (error) throw error;

    const result = resultRows?.[0];
    if (!result) return res.status(404).json({ error: 'Result not found' });
    res.json(result);
  } catch (error) {
    console.error('Get result details error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch result details', details: error.message });
  }
}

// ============ PAYMENTS ============
async function getPayments(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: payments, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const totalPaid =
      payments
        ?.filter((p) => p.status === 'completed')
        .reduce((s, p) => s + Number(p.amount || 0), 0) || 0;
    const totalPending =
      payments
        ?.filter((p) => p.status === 'pending')
        .reduce((s, p) => s + Number(p.amount || 0), 0) || 0;

    res.json({
      payments: payments || [],
      summary: {
        total_paid: totalPaid,
        total_pending: totalPending,
        total_count: payments?.length || 0,
      },
    });
  } catch (error) {
    console.error('Get payments error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch payments', details: error.message });
  }
}

async function getPaymentDetails(req, res) {
  try {
    const { paymentId } = req.params;
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: paymentRows, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .eq('student_id', student.id)
      .limit(1);
    if (error) throw error;

    const payment = paymentRows?.[0];
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (error) {
    console.error('Get payment details error:', error);
    res
      .status(500)
      .json({
        error: 'Failed to fetch payment details',
        details: error.message,
      });
  }
}

// ============ FEES (countdown) ============
async function getMyFees(req, res) {
  try {
    const userId = req.user.id;

    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!student) {
      return res.json({
        success: true,
        fees: null,
        payments: [],
        totalPaid: 0,
        totalPending: 0,
      });
    }

    const { data: payments, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const list = payments || [];
    const latest = list.find((p) => p.status === 'completed');

    let fees = null;
    if (latest) {
      const paidDate = new Date(latest.payment_date || latest.created_at);
      const plan = (latest.plan || 'monthly').toLowerCase();
      const planDays =
        plan === 'termly'
          ? 90
          : plan === 'monthly'
          ? 30
          : plan === 'daily'
          ? 1
          : 30;

      const expiresAt = new Date(paidDate);
      expiresAt.setDate(expiresAt.getDate() + planDays);

      const now = new Date();
      const msRemaining = expiresAt.getTime() - now.getTime();
      const daysRemaining = Math.ceil(msRemaining / 86400000);
      const hoursRemaining = Math.ceil(msRemaining / 3600000);
      const minutesRemaining = Math.ceil(msRemaining / 60000);
      const daysUsed = Math.max(0, planDays - daysRemaining);
      const progress = Math.min(
        100,
        Math.max(0, (daysUsed / planDays) * 100)
      );

      fees = {
        plan,
        planLabel:
          plan === 'termly'
            ? 'Termly (3 months)'
            : plan === 'monthly'
            ? 'Monthly'
            : plan === 'daily'
            ? 'Daily'
            : 'Monthly',
        amount: Number(latest.amount || 0),
        paidAt: paidDate.toISOString(),
        expiresAt: expiresAt.toISOString(),
        totalDays: planDays,
        daysUsed,
        daysRemaining: Math.max(0, daysRemaining),
        hoursRemaining: Math.max(0, hoursRemaining),
        minutesRemaining: Math.max(0, minutesRemaining),
        progress,
        status:
          daysRemaining <= 0
            ? 'expired'
            : daysRemaining <= 7
            ? 'expiring-soon'
            : 'active',
        reference: latest.reference || null,
      };
    }

    const totalPaid = list
      .filter((p) => p.status === 'completed')
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalPending = list
      .filter((p) => p.status === 'pending')
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    return res.json({
      success: true,
      fees,
      totalPaid,
      totalPending,
      payments: list,
    });
  } catch (error) {
    console.error('❌ getMyFees error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch fees' });
  }
}

// ============ ATTENDANCE ============
async function getMyAttendance(req, res) {
  try {
    const userId = req.user.id;
    const days = Math.min(365, Math.max(7, parseInt(req.query.days) || 30));

    const { data: student } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (!student) {
      return res.json({
        success: true,
        records: [],
        summary: {
          present: 0,
          absent: 0,
          late: 0,
          excused: 0,
          total: 0,
          attendanceRate: 0,
        },
      });
    }

    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data: records, error } = await supabaseAdmin
      .from('attendance')
      .select('*')
      .eq('student_id', student.id)
      .gte('date', since.toISOString().slice(0, 10))
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) throw error;

    const list = records || [];
    const summary = {
      present: list.filter((r) => r.status === 'present').length,
      absent: list.filter((r) => r.status === 'absent').length,
      late: list.filter((r) => r.status === 'late').length,
      excused: list.filter((r) => r.status === 'excused').length,
      total: list.length,
      attendanceRate: 0,
    };
    summary.attendanceRate =
      summary.total > 0
        ? Math.round(((summary.present + summary.late) / summary.total) * 100)
        : 0;

    return res.json({ success: true, records: list, summary });
  } catch (error) {
    console.error('❌ getMyAttendance error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch attendance' });
  }
}

async function submitAttendance(req, res) {
  try {
    const userId = req.user?.id;
    const { date, course, teacher, status = 'present', notes } = req.body || {};

    if (!date || !course || !teacher) {
      return res
        .status(400)
        .json({ error: 'date, course, and teacher are required' });
    }

    const student = await findStudent(userId);
    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const allowed = ['present', 'late', 'excused', 'absent'];
    const finalStatus = allowed.includes(status) ? status : 'present';

    const row = {
      student_id: student.id,
      date,
      course: String(course).trim(),
      teacher: String(teacher).trim(),
      status: finalStatus,
      notes: notes ? String(notes).trim() : null,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from('attendance')
      .upsert([row], { onConflict: 'student_id,date,course' })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({ success: true, attendance: data });
  } catch (error) {
    console.error('❌ submitAttendance error:', error.message);
    return res
      .status(500)
      .json({ error: 'Failed to submit attendance', details: error.message });
  }
}

// ============ TEACHER MESSAGING (NEW) ============

// GET /api/student/teachers
async function getMyTeachers(req, res) {
  try {
    const userId = req.user.id;

    const student = await findStudent(userId);
    if (!student) {
      return res.json({ success: true, teachers: [] });
    }

    // 1. Student's latest admission
    const { data: admRows } = await supabaseAdmin
      .from('admissions')
      .select('track_name, regular_class, instrument')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })
      .limit(1);
    const adm = admRows?.[0] || null;

    // 2. Get all staff
    const { data: allStaff, error: staffErr } = await supabaseAdmin
      .from('users')
      .select(
        'id, full_name, email, avatar_url, department, staff_category, staff_levels'
      )
      .in('role', ['staff', 'admin']);
    if (staffErr) throw staffErr;

    const studentTrack = (adm?.track_name || '').toLowerCase();
    const studentLevels = [adm?.regular_class, adm?.instrument].filter(Boolean);

    // 3. Filter staff who match the student's track + levels
    const matched = (allStaff || []).filter((s) => {
      if (!s.staff_category) return false;

      const cat = s.staff_category.toLowerCase();
      const catMatches =
        cat === 'mixed' ||
        (cat === 'regular' && studentTrack.includes('regular')) ||
        (cat === 'music' && studentTrack.includes('music')) ||
        studentTrack.includes('mixed');

      if (!catMatches) return false;

      const levels = Array.isArray(s.staff_levels) ? s.staff_levels : [];
      if (levels.length === 0) return true;

      return levels.some((lvl) =>
        studentLevels.some(
          (sl) => String(sl).toLowerCase() === String(lvl).toLowerCase()
        )
      );
    });

    if (matched.length === 0) {
      return res.json({ success: true, teachers: [] });
    }

    // 4. Latest message between student and each teacher
    const teacherIds = matched.map((t) => t.id);
    const { data: msgs } = await supabaseAdmin
      .from('messages')
      .select('id, sender_id, recipient_id, body, content, is_read, created_at')
      .or(
        `and(sender_id.eq.${userId},recipient_id.in.(${teacherIds.join(',')})),and(sender_id.in.(${teacherIds.join(',')}),recipient_id.eq.${userId})`
      )
      .order('created_at', { ascending: false });

    const byTeacher = {};
    (msgs || []).forEach((m) => {
      const other = m.sender_id === userId ? m.recipient_id : m.sender_id;
      if (!byTeacher[other]) {
        byTeacher[other] = {
          lastMessage: m.body || m.content || '',
          lastAt: m.created_at,
          unreadCount: 0,
        };
      }
      if (m.recipient_id === userId && !m.is_read) {
        byTeacher[other].unreadCount += 1;
      }
    });

    const teachers = matched.map((t) => ({
      id: t.id,
      name: t.full_name || 'Teacher',
      email: t.email,
      avatar_url: t.avatar_url,
      department: t.department,
      category: t.staff_category,
      levels: t.staff_levels || [],
      lastMessage: byTeacher[t.id]?.lastMessage || null,
      lastMessageAt: byTeacher[t.id]?.lastAt || null,
      unreadCount: byTeacher[t.id]?.unreadCount || 0,
    }));

    teachers.sort((a, b) => {
      if (a.unreadCount !== b.unreadCount) return b.unreadCount - a.unreadCount;
      return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
    });

    return res.json({ success: true, teachers });
  } catch (error) {
    console.error('❌ getMyTeachers error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch teachers' });
  }
}

// GET /api/student/messages/:teacherUserId
async function getConversationWithTeacher(req, res) {
  try {
    const userId = req.user.id;
    const { teacherUserId } = req.params;

    const student = await findStudent(userId);
    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const { data: teacher } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, avatar_url, role, department')
      .eq('id', teacherUserId)
      .in('role', ['staff', 'admin'])
      .maybeSingle();

    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const { data: msgs, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${userId},recipient_id.eq.${teacherUserId}),and(sender_id.eq.${teacherUserId},recipient_id.eq.${userId})`
      )
      .order('created_at', { ascending: true });
    if (error) throw error;

    await supabaseAdmin
      .from('messages')
      .update({ is_read: true })
      .eq('recipient_id', userId)
      .eq('sender_id', teacherUserId);

    return res.json({
      success: true,
      teacher,
      messages: msgs || [],
    });
  } catch (error) {
    console.error('❌ getConversationWithTeacher error:', error.message);
    return res
      .status(500)
      .json({ error: 'Failed to fetch conversation' });
  }
}

// POST /api/student/messages
async function sendMessageToTeacher(req, res) {
  try {
    const userId = req.user.id;
    const { teacherUserId, body, content } = req.body || {};
    const msgBody = (body || content || '').trim();

    if (!teacherUserId || !msgBody) {
      return res
        .status(400)
        .json({ error: 'teacherUserId and body are required' });
    }

    const student = await findStudent(userId);
    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const { data: teacher } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email')
      .eq('id', teacherUserId)
      .in('role', ['staff', 'admin'])
      .maybeSingle();
    if (!teacher) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert([
        {
          sender_id: userId,
          recipient_id: teacherUserId,
          student_id: student.id,
          body: msgBody,
          content: msgBody,
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();
    if (error) throw error;

    // Best-effort staff notification
    try {
      const notificationController = require('./notificationController');
      await notificationController.pushStaffNotification({
        staffId: teacherUserId,
        type: 'student_message',
        title: `New message from ${student.full_name || 'a student'}`,
        message:
          msgBody.length > 80 ? `${msgBody.slice(0, 80)}…` : msgBody,
        link: `/staff/messages?student=${student.id}`,
        meta: { studentId: student.id, senderId: userId },
      });
    } catch (notifErr) {
      console.warn('⚠️ Staff notify failed:', notifErr.message);
    }

    return res.status(201).json({ success: true, message: data });
  } catch (error) {
    console.error('❌ sendMessageToTeacher error:', error.message);
    return res
      .status(500)
      .json({ error: 'Failed to send message', details: error.message });
  }
}

// ============ MATERIALS ============
async function getMaterials(req, res) {
  try {
    const { classId } = req.params;
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: enrollmentRows } = await supabaseAdmin
      .from('student_classes')
      .select('id')
      .eq('student_id', student.id)
      .eq('class_id', classId)
      .eq('status', 'active')
      .limit(1);

    if (!enrollmentRows || enrollmentRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this class' });
    }

    const { data: materials, error } = await supabaseAdmin
      .from('course_materials')
      .select('*')
      .eq('class_id', classId);
    if (error) throw error;

    res.json(materials || []);
  } catch (error) {
    console.error('Get materials error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch materials', details: error.message });
  }
}

async function getMaterial(req, res) {
  try {
    const { classId, materialId } = req.params;
    const student = await ensureStudent(req);
    if (!student)
      return res.status(404).json({ error: 'Student record not found' });

    const { data: enrollmentRows } = await supabaseAdmin
      .from('student_classes')
      .select('id')
      .eq('student_id', student.id)
      .eq('class_id', classId)
      .eq('status', 'active')
      .limit(1);

    if (!enrollmentRows || enrollmentRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this class' });
    }

    const { data: materialRows, error } = await supabaseAdmin
      .from('course_materials')
      .select('*')
      .eq('id', materialId)
      .eq('class_id', classId)
      .limit(1);
    if (error) throw error;

    const material = materialRows?.[0];
    if (!material) return res.status(404).json({ error: 'Material not found' });
    res.json(material);
  } catch (error) {
    console.error('Get material error:', error);
    res
      .status(500)
      .json({ error: 'Failed to fetch material', details: error.message });
  }
}

// ============ EXPORTS ============
module.exports = {
  getProfile,
  updateProfile,
  getCourses,
  getCourseDetails,
  getMyProgramme,
  getMyEnrolledClasses,
  getAssignments,
  getAssignmentDetails,
  submitAssignment,
  getClasses,
  getClassDetails,
  getResults,
  getResultDetails,
  getPayments,
  getPaymentDetails,
  getMyFees,
  getMyAttendance,
  submitAttendance,
  getMyTeachers,
  getConversationWithTeacher,
  sendMessageToTeacher,
  getMaterials,
  getMaterial,
};
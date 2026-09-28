// src/controllers/staffController.js
const { supabaseAdmin } = require('../config/supabase');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
async function getMyClasses(staffId) {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .select(
      'id, title, subject, schedule, is_active, is_published, programme_id, instructor_id'
    )
    .eq('instructor_id', staffId);
  if (error) {
    console.error('getMyClasses error:', error.message);
    return [];
  }
  return data || [];
}

async function getStaffProfile(staffId) {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, staff_category, staff_levels')
    .eq('id', staffId)
    .limit(1);
  if (error) {
    console.error('getStaffProfile error:', error.message);
    return null;
  }
  return data?.[0] || null;
}

function admissionMatchesStaff(admission, staffCat, staffLevels) {
  const norm = (s) => String(s || '').toLowerCase().trim();

  const cat = norm(staffCat);
  const levels = Array.isArray(staffLevels)
    ? staffLevels.map(norm).filter(Boolean)
    : [];

  if (cat && cat !== 'mixed') {
    const track = norm(admission?.track_name || admission?.course);
    if (track) {
      if (cat.includes('regular') || cat.includes('academ')) {
        if (
          track.includes('music') &&
          !track.includes('regular') &&
          !track.includes('mixed')
        ) {
          return false;
        }
      } else if (cat.includes('music')) {
        if (
          track.includes('regular') &&
          !track.includes('music') &&
          !track.includes('mixed')
        ) {
          return false;
        }
      }
    }
  }

  if (levels.length > 0) {
    const level = norm(admission?.regular_class || admission?.instrument);
    if (level) {
      const match = levels.some(
        (l) => level === l || level.includes(l) || l.includes(level)
      );
      if (!match) return false;
    }
  }

  return true;
}

async function getMyStudents(staffId) {
  const [classes, staffProfile] = await Promise.all([
    getMyClasses(staffId),
    getStaffProfile(staffId),
  ]);

  const staffCat = staffProfile?.staff_category || null;
  const staffLevels = Array.isArray(staffProfile?.staff_levels)
    ? staffProfile.staff_levels
    : [];

  const classIds = classes.map((c) => c.id);
  const enrolledIds = new Set();
  const byClass = {};

  if (classIds.length > 0) {
    const { data: enrolls, error } = await supabaseAdmin
      .from('student_classes')
      .select('class_id, student_id, status')
      .in('class_id', classIds);
    if (error) {
      console.error('getMyStudents enrolls error:', error.message);
    } else {
      (enrolls || []).forEach((e) => {
        enrolledIds.add(e.student_id);
        byClass[e.student_id] = byClass[e.student_id] || [];
        const cls = classes.find((c) => c.id === e.class_id);
        if (cls) {
          byClass[e.student_id].push({
            id: cls.id,
            title: cls.title || cls.subject || 'Class',
          });
        }
      });
    }
  }

  const { data: allStudents, error: sErr } = await supabaseAdmin
    .from('students')
    .select(
      'id, user_id, student_id, full_name, status, academic_year, user:users ( id, email, phone, avatar_url )'
    )
    .eq('status', 'active');
  if (sErr) {
    console.error('getMyStudents students error:', sErr.message);
    return [];
  }

  const studentIds = (allStudents || []).map((s) => s.id);
  const admByStudent = {};

  if (studentIds.length > 0) {
    const { data: admRows, error: admErr } = await supabaseAdmin
      .from('admissions')
      .select(
        'student_id, track_name, regular_class, instrument, course, created_at'
      )
      .in('student_id', studentIds)
      .order('created_at', { ascending: false });
    if (admErr) {
      console.error('getMyStudents admissions error:', admErr.message);
    } else {
      (admRows || []).forEach((a) => {
        if (!admByStudent[a.student_id]) admByStudent[a.student_id] = a;
      });
    }
  }

  const seen = new Set();
  const result = [];
  const hasCategoryFilter = Boolean(staffCat) || staffLevels.length > 0;

  (allStudents || []).forEach((s) => {
    const admission = admByStudent[s.id] || null;
    const isEnrolledInMyClass = enrolledIds.has(s.id);

    let include = isEnrolledInMyClass;

    if (!include && hasCategoryFilter) {
      include = admissionMatchesStaff(admission, staffCat, staffLevels);
    }

    if (!include || seen.has(s.id)) return;
    seen.add(s.id);

    result.push({
      id: s.id,
      user_id: s.user_id,
      student_id: s.student_id,
      fullName: s.full_name,
      email: s.user?.email || null,
      phone: s.user?.phone || null,
      avatar_url: s.user?.avatar_url || null,
      status: s.status,
      academic_year: s.academic_year,
      track_name: admission?.track_name || null,
      regular_class: admission?.regular_class || null,
      instrument: admission?.instrument || null,
      classes: byClass[s.id] || [],
    });
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/me
// ═══════════════════════════════════════════════════════════════
async function getMe(req, res) {
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select(
        'id, full_name, email, phone, role, avatar_url, last_login, created_at, staff_category, staff_levels'
      )
      .eq('id', req.user.id)
      .limit(1);

    const me = data?.[0] || null;
    const classes = await getMyClasses(req.user.id);

    res.json({ success: true, user: me, classes });
  } catch (err) {
    console.error('❌ staff getMe:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch profile', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/stats
// ═══════════════════════════════════════════════════════════════
async function getStats(req, res) {
  try {
    const staffId = req.user.id;
    const classes = await getMyClasses(staffId);
    const students = await getMyStudents(staffId);
    const classIds = classes.map((c) => c.id);

    let assignments = 0;
    let pendingSubmissions = 0;
    let unreadMessages = 0;

    if (classIds.length > 0) {
      const { count: aCount } = await supabaseAdmin
        .from('assignments')
        .select('*', { count: 'exact', head: true })
        .in('class_id', classIds);
      assignments = aCount || 0;

      const { data: aRows } = await supabaseAdmin
        .from('assignments')
        .select('id')
        .in('class_id', classIds);
      const assignmentIds = (aRows || []).map((a) => a.id);

      if (assignmentIds.length > 0) {
        const { count: pCount } = await supabaseAdmin
          .from('submissions')
          .select('*', { count: 'exact', head: true })
          .in('assignment_id', assignmentIds)
          .eq('status', 'submitted');
        pendingSubmissions = pCount || 0;
      }
    }

    const { count: msgCount } = await supabaseAdmin
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('recipient_id', staffId)
      .eq('is_read', false);
    unreadMessages = msgCount || 0;

    res.json({
      success: true,
      stats: {
        totalClasses: classes.length,
        totalStudents: students.length,
        totalAssignments: assignments,
        pendingSubmissions,
        unreadMessages,
      },
      classes,
    });
  } catch (err) {
    console.error('❌ staff getStats:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch stats', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/students
// ═══════════════════════════════════════════════════════════════
async function getStudents(req, res) {
  try {
    const search = (req.query.search || '').trim().toLowerCase();
    let students = await getMyStudents(req.user.id);

    if (search) {
      students = students.filter((s) => {
        const n = (s.fullName || '').toLowerCase();
        const e = (s.email || '').toLowerCase();
        const c = (s.student_id || '').toLowerCase();
        return n.includes(search) || e.includes(search) || c.includes(search);
      });
    }

    res.json({ success: true, students });
  } catch (err) {
    console.error('❌ staff getStudents:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch students', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/students/:studentId
// ═══════════════════════════════════════════════════════════════
async function getStudentDetails(req, res) {
  try {
    const { studentId } = req.params;
    const staffId = req.user.id;

    const myStudents = await getMyStudents(staffId);
    const allowed = myStudents.find((s) => s.id === studentId);
    if (!allowed) {
      return res
        .status(403)
        .json({ error: 'This student is not in your classes' });
    }

    const { data: studentRows } = await supabaseAdmin
      .from('students')
      .select('*, user:users ( id, email, phone, avatar_url )')
      .eq('id', studentId)
      .limit(1);
    const student = studentRows?.[0];

    const { data: reportCards } = await supabaseAdmin
      .from('report_cards')
      .select('*')
      .eq('student_id', studentId)
      .order('session', { ascending: false })
      .order('term', { ascending: false });

    const { data: submissions } = await supabaseAdmin
      .from('submissions')
      .select('*, assignment:assignment_id ( id, title, due_date, class_id )')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false });

    res.json({
      success: true,
      student,
      classes: allowed.classes,
      reportCards: reportCards || [],
      submissions: submissions || [],
    });
  } catch (err) {
    console.error('❌ staff getStudentDetails:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch student', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// ATTENDANCE
// ═══════════════════════════════════════════════════════════════

async function getAttendanceStudents(req, res) {
  try {
    const staffId = req.user.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [students, classes] = await Promise.all([
      getMyStudents(staffId),
      getMyClasses(staffId),
    ]);

    if (students.length === 0) {
      return res.json({
        success: true,
        date,
        students: [],
        classes: classes.map((c) => ({
          id: c.id,
          title: c.title || c.subject || 'Class',
        })),
        message: 'No students match your category or classes yet.',
      });
    }

    const ids = students.map((s) => s.id);
    const { data: rows, error } = await supabaseAdmin
      .from('attendance')
      .select('student_id, status, notes')
      .eq('date', date)
      .in('student_id', ids);
    if (error) throw error;

    const attMap = {};
    (rows || []).forEach((r) => {
      attMap[r.student_id] = { status: r.status, notes: r.notes || '' };
    });

    const enriched = students.map((s) => ({
      ...s,
      attendance: attMap[s.id] || null,
    }));

    res.json({
      success: true,
      date,
      students: enriched,
      classes: classes.map((c) => ({
        id: c.id,
        title: c.title || c.subject || 'Class',
      })),
    });
  } catch (err) {
    console.error('❌ staff getAttendanceStudents:', err.message);
    res.status(500).json({
      error: 'Failed to fetch attendance students',
      details: err.message,
    });
  }
}

async function markAttendance(req, res) {
  try {
    const staffId = req.user.id;
    const { date, records } = req.body || {};

    if (!date || !Array.isArray(records) || records.length === 0) {
      return res
        .status(400)
        .json({ error: 'date and records[] are required' });
    }

    const myStudents = await getMyStudents(staffId);
    const allowed = new Set(myStudents.map((s) => s.id));

    const valid = records.filter(
      (r) => r?.studentId && allowed.has(r.studentId)
    );

    if (valid.length === 0) {
      return res.status(403).json({
        error: 'None of the students in this list are assigned to you.',
      });
    }

    const rows = valid.map((r) => ({
      student_id: r.studentId,
      date,
      status: r.status || 'present',
      course: r.course || null,
      teacher: r.teacher || null,
      notes: r.notes || null,
      marked_by: staffId,
      approval_status: 'approved',
      approved_by: staffId,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data, error } = await supabaseAdmin
      .from('attendance')
      .upsert(rows, { onConflict: 'student_id,date,course' })
      .select();

    if (error) throw error;

    res.json({
      success: true,
      marked: data?.length || 0,
      skipped: records.length - valid.length,
      records: data || [],
    });
  } catch (err) {
    console.error('❌ staff markAttendance:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to mark attendance', details: err.message });
  }
}

async function getAttendanceHistory(req, res) {
  try {
    const staffId = req.user.id;
    const days = Math.min(180, Math.max(7, parseInt(req.query.days) || 30));

    const students = await getMyStudents(staffId);
    if (students.length === 0) {
      return res.json({
        success: true,
        history: [],
        byDate: {},
        summary: null,
      });
    }

    const studentIds = students.map((s) => s.id);
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabaseAdmin
      .from('attendance')
      .select('*')
      .in('student_id', studentIds)
      .gte('date', since.toISOString().slice(0, 10))
      .order('date', { ascending: false });

    if (error) throw error;

    const list = data || [];
    const summary = {
      present: list.filter((r) => r.status === 'present').length,
      absent: list.filter((r) => r.status === 'absent').length,
      late: list.filter((r) => r.status === 'late').length,
      excused: list.filter((r) => r.status === 'excused').length,
      total: list.length,
      studentCount: studentIds.length,
    };
    summary.rate =
      summary.total > 0
        ? Math.round(((summary.present + summary.late) / summary.total) * 100)
        : 0;

    const byDate = {};
    list.forEach((r) => {
      if (!byDate[r.date]) byDate[r.date] = [];
      byDate[r.date].push(r);
    });

    res.json({ success: true, history: list, byDate, summary });
  } catch (err) {
    console.error('❌ staff getAttendanceHistory:', err.message);
    res.status(500).json({
      error: 'Failed to fetch attendance history',
      details: err.message,
    });
  }
}

async function getAttendanceSubmissions(req, res) {
  try {
    const staffId = req.user.id;
    const { date } = req.query;

    const students = await getMyStudents(staffId);
    if (students.length === 0) {
      return res.json({
        success: true,
        date: date || null,
        submissions: [],
        summary: null,
      });
    }

    const studentIds = students.map((s) => s.id);

    let query = supabaseAdmin
      .from('attendance')
      .select('*')
      .in('student_id', studentIds)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (date) query = query.eq('date', date);

    const { data, error } = await query.limit(500);
    if (error) throw error;

    const studentMap = {};
    students.forEach((s) => {
      studentMap[s.id] = s;
    });

    const list = (data || []).map((r) => {
      const s = studentMap[r.student_id] || {};
      return {
        ...r,
        student_name: s.fullName || 'Unknown',
        student_code: s.student_id || '',
        student_email: s.email || '',
        student_avatar: s.avatar_url || null,
        student_track: s.track_name || null,
        student_level: s.regular_class || s.instrument || null,
        approval_status: r.approval_status || 'pending',
      };
    });

    const summary = {
      total: list.length,
      present: list.filter((r) => r.status === 'present').length,
      late: list.filter((r) => r.status === 'late').length,
      absent: list.filter((r) => r.status === 'absent').length,
      excused: list.filter((r) => r.status === 'excused').length,
      uniqueStudents: new Set(list.map((r) => r.student_id)).size,
      pending: list.filter(
        (r) => (r.approval_status || 'pending') === 'pending'
      ).length,
      approved: list.filter((r) => r.approval_status === 'approved').length,
      rejected: list.filter((r) => r.approval_status === 'rejected').length,
    };

    res.json({
      success: true,
      date: date || null,
      submissions: list,
      summary,
    });
  } catch (err) {
    console.error('❌ staff getAttendanceSubmissions:', err.message);
    res.status(500).json({
      error: 'Failed to fetch attendance submissions',
      details: err.message,
    });
  }
}

async function approveAttendance(req, res) {
  try {
    const staffId = req.user.id;
    const { attendanceId } = req.params;
    const { approval } = req.body || {};

    if (!['approved', 'rejected', 'pending'].includes(approval)) {
      return res
        .status(400)
        .json({ error: 'approval must be approved | rejected | pending' });
    }

    const myStudents = await getMyStudents(staffId);
    const allowed = new Set(myStudents.map((s) => s.id));

    const { data: rows } = await supabaseAdmin
      .from('attendance')
      .select('id, student_id')
      .eq('id', attendanceId)
      .limit(1);

    if (!rows?.[0]) {
      return res.status(404).json({ error: 'Attendance not found' });
    }
    if (!allowed.has(rows[0].student_id)) {
      return res.status(403).json({ error: 'Not your student' });
    }

    const { data, error } = await supabaseAdmin
      .from('attendance')
      .update({
        approval_status: approval,
        approved_by: approval === 'pending' ? null : staffId,
        approved_at:
          approval === 'pending' ? null : new Date().toISOString(),
      })
      .eq('id', attendanceId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, attendance: data });
  } catch (err) {
    console.error('❌ approveAttendance:', err.message);
    res.status(500).json({ error: 'Failed to update approval' });
  }
}

async function bulkApproveAttendance(req, res) {
  try {
    const staffId = req.user.id;
    const { ids, approval } = req.body || {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids[] is required' });
    }
    if (!['approved', 'rejected', 'pending'].includes(approval)) {
      return res.status(400).json({ error: 'invalid approval value' });
    }

    const myStudents = await getMyStudents(staffId);
    const allowed = new Set(myStudents.map((s) => s.id));

    const { data: rows } = await supabaseAdmin
      .from('attendance')
      .select('id, student_id')
      .in('id', ids);

    const validIds = (rows || [])
      .filter((r) => allowed.has(r.student_id))
      .map((r) => r.id);

    if (validIds.length === 0) {
      return res.status(403).json({ error: 'No valid records' });
    }

    const { data, error } = await supabaseAdmin
      .from('attendance')
      .update({
        approval_status: approval,
        approved_by: approval === 'pending' ? null : staffId,
        approved_at:
          approval === 'pending' ? null : new Date().toISOString(),
      })
      .in('id', validIds)
      .select();
    if (error) throw error;

    res.json({
      success: true,
      updated: data?.length || 0,
      skipped: ids.length - validIds.length,
    });
  } catch (err) {
    console.error('❌ bulkApproveAttendance:', err.message);
    res.status(500).json({ error: 'Failed to bulk-approve' });
  }
}

// ═══════════════════════════════════════════════════════════════
// CLASS SESSIONS — start / end / list
// ═══════════════════════════════════════════════════════════════

// POST /api/staff/sessions/start
// body: { class_ids[], title, description, meeting_url, meeting_id, passcode, notify }
async function startSession(req, res) {
  try {
    const staffId = req.user.id;
    const {
      class_ids,
      class_id,
      title,
      description,
      meeting_url,
      meeting_id,
      passcode,
      notify = true,
    } = req.body || {};

    const ids =
      Array.isArray(class_ids) && class_ids.length > 0
        ? class_ids
        : class_id
        ? [class_id]
        : [];

    if (ids.length === 0) {
      return res.status(400).json({ error: 'Select at least one class' });
    }
    if (!meeting_url || !String(meeting_url).trim()) {
      return res.status(400).json({ error: 'Meeting link is required' });
    }

    const { data: cls, error: clsErr } = await supabaseAdmin
      .from('classes')
      .select('id, title, subject, instructor_id')
      .in('id', ids);
    if (clsErr) throw clsErr;

    const owned = (cls || []).filter((c) => c.instructor_id === staffId);
    if (owned.length === 0) {
      return res
        .status(403)
        .json({ error: 'None of the selected classes belong to you' });
    }

    // Auto-close existing live sessions for these classes
    await supabaseAdmin
      .from('class_sessions')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('class_id', owned.map((c) => c.id))
      .eq('status', 'live');

    const now = new Date().toISOString();
    const baseTitle = (title || '').trim();
    const rows = owned.map((c) => ({
      class_id: c.id,
      staff_id: staffId,
      title: baseTitle || `${c.title || c.subject || 'Class'} — Live Session`,
      description: description || null,
      meeting_url: String(meeting_url).trim(),
      meeting_id: meeting_id || null,
      passcode: passcode || null,
      scheduled_at: now,
      started_at: now,
      status: 'live',
      created_at: now,
      updated_at: now,
    }));

    const { data: created, error } = await supabaseAdmin
      .from('class_sessions')
      .insert(rows)
      .select();
    if (error) throw error;

    // Notify enrolled students
    let notified = 0;
    if (notify) {
      try {
        const { data: enrolls } = await supabaseAdmin
          .from('student_classes')
          .select('student_id')
          .in('class_id', owned.map((c) => c.id))
          .eq('status', 'active');

        const studentIds = [
          ...new Set((enrolls || []).map((e) => e.student_id).filter(Boolean)),
        ];

        if (studentIds.length > 0) {
          const { data: students } = await supabaseAdmin
            .from('students')
            .select('id, user_id')
            .in('id', studentIds);

          const userIds = (students || [])
            .map((s) => s.user_id)
            .filter(Boolean);

          if (userIds.length > 0) {
            const classTitle =
              owned[0].title || owned[0].subject || 'your class';
            const notifTitle = baseTitle
              ? `Live now: ${baseTitle}`
              : `Live now: ${classTitle}`;
            const notifMessage =
              'Your class is now in session. Open your Classes page to join.';

            const notifRows = userIds.map((uid) => ({
              user_id: uid,
              type: 'class_session',
              title: notifTitle,
              message: notifMessage,
              link: '/student/classes',
              meta: {
                session_ids: (created || []).map((c) => c.id),
                meeting_url: String(meeting_url).trim(),
              },
              is_read: false,
              created_at: new Date().toISOString(),
            }));

            const { error: notifErr } = await supabaseAdmin
              .from('notifications')
              .insert(notifRows);

            if (notifErr) {
              console.warn('⚠️ notify insert failed:', notifErr.message);
            } else {
              notified = notifRows.length;
            }
          }
        }
      } catch (notifyErr) {
        console.warn('⚠️ student notify failed:', notifyErr.message);
      }
    }

    res.status(201).json({
      success: true,
      sessions: created || [],
      notified,
    });
  } catch (err) {
    console.error('❌ startSession:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to start session', details: err.message });
  }
}

// POST /api/staff/sessions/:sessionId/end
async function endSession(req, res) {
  try {
    const staffId = req.user.id;
    const { sessionId } = req.params;
    const { recording_url } = req.body || {};

    const { data: rows } = await supabaseAdmin
      .from('class_sessions')
      .select('id, staff_id, started_at, status')
      .eq('id', sessionId)
      .limit(1);

    if (!rows?.[0]) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (rows[0].staff_id !== staffId) {
      return res.status(403).json({ error: 'Not your session' });
    }
    if (rows[0].status === 'completed') {
      return res.json({ success: true, session: rows[0], alreadyEnded: true });
    }

    const startedAt = rows[0].started_at
      ? new Date(rows[0].started_at)
      : new Date();
    const endedAt = new Date();
    const duration = Math.max(
      1,
      Math.round((endedAt.getTime() - startedAt.getTime()) / 60000)
    );

    const { data, error } = await supabaseAdmin
      .from('class_sessions')
      .update({
        status: 'completed',
        ended_at: endedAt.toISOString(),
        duration_minutes: duration,
        recording_url: recording_url || null,
        updated_at: endedAt.toISOString(),
      })
      .eq('id', sessionId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, session: data });
  } catch (err) {
    console.error('❌ endSession:', err.message);
    res.status(500).json({ error: 'Failed to end session' });
  }
}

// GET /api/staff/sessions
async function getStaffSessions(req, res) {
  try {
    const staffId = req.user.id;

    const { data, error } = await supabaseAdmin
      .from('class_sessions')
      .select('*, class:class_id ( id, title, subject )')
      .eq('staff_id', staffId)
      .order('started_at', { ascending: false })
      .limit(100);
    if (error) throw error;

    const sessions = data || [];
    const live = sessions.filter((s) => s.status === 'live');
    const recent = sessions.filter((s) => s.status !== 'live');

    res.json({ success: true, sessions, live, recent });
  } catch (err) {
    console.error('❌ getStaffSessions:', err.message);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
}

// ═══════════════════════════════════════════════════════════════
// SCORES / RESULTS
// ═══════════════════════════════════════════════════════════════
function computeGrade(total) {
  if (total >= 80) return { grade: 'A', remark: 'Distinction' };
  if (total >= 70) return { grade: 'B1', remark: 'Excellent' };
  if (total >= 60) return { grade: 'B2', remark: 'Very Good' };
  if (total >= 50) return { grade: 'C', remark: 'Good' };
  if (total >= 40) return { grade: 'D', remark: 'Fair' };
  return { grade: 'F', remark: 'Fail' };
}

async function submitScores(req, res) {
  try {
    const { studentId } = req.params;
    const staffId = req.user.id;
    const { session, term, subject, ca1, ca2, exam } = req.body;

    if (!session || !term || !subject) {
      return res
        .status(400)
        .json({ error: 'session, term, and subject are required' });
    }

    const myStudents = await getMyStudents(staffId);
    if (!myStudents.find((s) => s.id === studentId)) {
      return res.status(403).json({ error: 'Student is not in your classes' });
    }

    const numCA1 = Number(ca1) || 0;
    const numCA2 = Number(ca2) || 0;
    const numExam = Number(exam) || 0;
    const total = numCA1 + numCA2 + numExam;
    const { grade, remark } = computeGrade(total);

    const { data: existing } = await supabaseAdmin
      .from('report_cards')
      .select('*')
      .eq('student_id', studentId)
      .eq('session', session)
      .eq('term', term)
      .limit(1);

    let card = existing?.[0] || null;
    let subjects = card?.subjects ? [...card.subjects] : [];

    const idx = subjects.findIndex((s) => s.subject === subject);
    const newRow = {
      subject,
      ca1: numCA1,
      ca2: numCA2,
      exam: numExam,
      total,
      grade,
      remark,
      position: subjects[idx]?.position || null,
      in_class: subjects[idx]?.in_class || null,
    };

    if (idx >= 0) subjects[idx] = newRow;
    else subjects.push(newRow);

    const totalObtainable = subjects.length * 100;
    const overallTotal = subjects.reduce((s, r) => s + (r.total || 0), 0);
    const overallPercentage = totalObtainable
      ? Math.round((overallTotal / totalObtainable) * 1000) / 10
      : 0;
    const overallGrade = computeGrade(overallPercentage).grade;

    const payload = {
      student_id: studentId,
      session,
      term,
      subjects,
      overall_total: overallTotal,
      total_obtainable: totalObtainable,
      overall_percentage: overallPercentage,
      overall_grade: overallGrade,
      status: 'draft',
      entered_by: staffId,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error } = await supabaseAdmin
      .from('report_cards')
      .upsert([payload], { onConflict: 'student_id,session,term' })
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, reportCard: saved });
  } catch (err) {
    console.error('❌ staff submitScores:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to save scores', details: err.message });
  }
}

async function submitResults(req, res) {
  try {
    const { studentId } = req.params;
    const { session, term } = req.body;

    const { data, error } = await supabaseAdmin
      .from('report_cards')
      .update({
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('student_id', studentId)
      .eq('session', session)
      .eq('term', term)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, reportCard: data });
  } catch (err) {
    console.error('❌ staff submitResults:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to submit results', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// ASSIGNMENTS
// ═══════════════════════════════════════════════════════════════
async function getAssignments(req, res) {
  try {
    const staffId = req.user.id;
    const classes = await getMyClasses(staffId);
    const classIds = classes.map((c) => c.id);
    if (classIds.length === 0) {
      return res.json({ success: true, assignments: [], classes });
    }

    const { data, error } = await supabaseAdmin
      .from('assignments')
      .select(
        '*, class:class_id ( id, title ), submissions:submissions ( id, student_id, status )'
      )
      .in('class_id', classIds)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('getAssignments error:', error.message);
      return res.json({ success: true, assignments: [], classes });
    }

    const assignments = (data || []).map((a) => ({
      ...a,
      submissionCount: a.submissions?.length || 0,
      pendingCount:
        a.submissions?.filter((s) => s.status === 'submitted').length || 0,
    }));

    res.json({ success: true, assignments, classes });
  } catch (err) {
    console.error('❌ staff getAssignments:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch assignments', details: err.message });
  }
}

async function createAssignment(req, res) {
  try {
    const staffId = req.user.id;
    const { class_id, title, description, due_date, subject, max_score } =
      req.body || {};

    if (!class_id || !title) {
      return res
        .status(400)
        .json({ error: 'class_id and title are required' });
    }

    const { data: cls } = await supabaseAdmin
      .from('classes')
      .select('id, instructor_id')
      .eq('id', class_id)
      .limit(1);
    if (!cls?.[0] || cls[0].instructor_id !== staffId) {
      return res.status(403).json({ error: 'Not your class' });
    }

    const { data, error } = await supabaseAdmin
      .from('assignments')
      .insert([
        {
          class_id,
          title,
          description: description || null,
          due_date: due_date || null,
          subject: subject || null,
          max_score: Number(max_score) || 100,
          instructor_id: staffId,
          type: 'general',
          instructions: description || null,
          attachments: [],
          is_published: true,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, assignment: data });
  } catch (err) {
    console.error('❌ staff createAssignment:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to create assignment', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// MESSAGES
// ═══════════════════════════════════════════════════════════════
async function getConversation(req, res) {
  try {
    const staffId = req.user.id;
    const { studentId } = req.params;

    const myStudents = await getMyStudents(staffId);
    if (!myStudents.find((s) => s.id === studentId)) {
      return res.status(403).json({ error: 'Not your student' });
    }

    const { data: sRow } = await supabaseAdmin
      .from('students')
      .select('user_id')
      .eq('id', studentId)
      .limit(1);
    const studentUserId = sRow?.[0]?.user_id;
    if (!studentUserId) {
      return res.status(404).json({ error: 'Student has no linked user' });
    }

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${staffId},recipient_id.eq.${studentUserId}),and(sender_id.eq.${studentUserId},recipient_id.eq.${staffId})`
      )
      .order('created_at', { ascending: true });
    if (error) throw error;

    await supabaseAdmin
      .from('messages')
      .update({ is_read: true })
      .eq('recipient_id', staffId)
      .eq('sender_id', studentUserId);

    res.json({ success: true, messages: data || [] });
  } catch (err) {
    console.error('❌ staff getConversation:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch messages', details: err.message });
  }
}

async function sendMessage(req, res) {
  try {
    const staffId = req.user.id;
    const { studentId, body, content } = req.body || {};
    const messageBody = (body || content || '').trim();

    if (!studentId || !messageBody) {
      return res
        .status(400)
        .json({ error: 'studentId and body are required' });
    }

    const myStudents = await getMyStudents(staffId);
    if (!myStudents.find((s) => s.id === studentId)) {
      return res.status(403).json({ error: 'Not your student' });
    }

    const { data: sRow } = await supabaseAdmin
      .from('students')
      .select('user_id')
      .eq('id', studentId)
      .limit(1);
    const studentUserId = sRow?.[0]?.user_id;

    const { data, error } = await supabaseAdmin
      .from('messages')
      .insert([
        {
          sender_id: staffId,
          recipient_id: studentUserId,
          student_id: studentId,
          body: messageBody,
          content: messageBody,
          is_read: false,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();
    if (error) throw error;

    res.status(201).json({ success: true, message: data });
  } catch (err) {
    console.error('❌ staff sendMessage:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to send message', details: err.message });
  }
}

async function getInbox(req, res) {
  try {
    const staffId = req.user.id;
    const students = await getMyStudents(staffId);
    const studentUserIds = students.map((s) => s.user_id).filter(Boolean);
    if (studentUserIds.length === 0)
      return res.json({ success: true, inbox: [] });

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${staffId},recipient_id.in.(${studentUserIds.join(
          ','
        )})),and(sender_id.in.(${studentUserIds.join(
          ','
        )}),recipient_id.eq.${staffId})`
      )
      .order('created_at', { ascending: false });
    if (error) throw error;

    const threads = {};
    (data || []).forEach((m) => {
      const other = m.sender_id === staffId ? m.recipient_id : m.sender_id;
      if (!threads[other]) {
        threads[other] = {
          otherUserId: other,
          messages: [],
          lastMessage: m,
          unreadCount: 0,
        };
      }
      threads[other].messages.push(m);
      if (m.recipient_id === staffId && !m.is_read) {
        threads[other].unreadCount += 1;
      }
    });

    const inbox = Object.values(threads)
      .map((t) => {
        const student = students.find((s) => s.user_id === t.otherUserId);
        return {
          studentId: student?.id || null,
          studentName: student?.fullName || 'Unknown',
          studentEmail: student?.email || null,
          avatar_url: student?.avatar_url || null,
          lastMessage: t.lastMessage.body || t.lastMessage.content,
          lastMessageAt: t.lastMessage.created_at,
          unreadCount: t.unreadCount,
        };
      })
      .sort((a, b) => new Date(b.lastMessageAt) - new Date(a.lastMessageAt));

    res.json({ success: true, inbox });
  } catch (err) {
    console.error('❌ staff getInbox:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch inbox', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// SUBMISSIONS
// ═══════════════════════════════════════════════════════════════
async function getSubmissions(req, res) {
  try {
    const staffId = req.user.id;
    const { assignmentId } = req.params;

    const { data: aRows } = await supabaseAdmin
      .from('assignments')
      .select('id, class_id, title, class:class_id ( instructor_id )')
      .eq('id', assignmentId)
      .limit(1);
    const assignment = aRows?.[0];
    if (!assignment || assignment.class?.instructor_id !== staffId) {
      return res.status(403).json({ error: 'Not your assignment' });
    }

    const { data, error } = await supabaseAdmin
      .from('submissions')
      .select(
        '*, student:student_id ( id, student_id, full_name, user:users ( email, avatar_url ) )'
      )
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    res.json({ success: true, assignment, submissions: data || [] });
  } catch (err) {
    console.error('❌ staff getSubmissions:', err.message);
    res
      .status(500)
      .json({ error: 'Failed to fetch submissions', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  getMe,
  getStats,
  getStudents,
  getStudentDetails,
  getAttendanceStudents,
  markAttendance,
  getAttendanceHistory,
  getAttendanceSubmissions,
  approveAttendance,
  bulkApproveAttendance,
  startSession,
  endSession,
  getStaffSessions,
  submitScores,
  submitResults,
  getAssignments,
  createAssignment,
  getConversation,
  sendMessage,
  getInbox,
  getSubmissions,
};
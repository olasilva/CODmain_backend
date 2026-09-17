// src/controllers/staffController.js
const { supabaseAdmin } = require('../config/supabase');

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
async function getMyClasses(staffId) {
  const { data, error } = await supabaseAdmin
    .from('classes')
    .select('id, title, subject, schedule, is_active, is_published, programme_id, instructor_id')
    .eq('instructor_id', staffId);
  if (error) {
    console.error('getMyClasses error:', error.message);
    return [];
  }
  return data || [];
}

async function getMyStudents(staffId) {
  const classes = await getMyClasses(staffId);
  const classIds = classes.map((c) => c.id);
  if (classIds.length === 0) return [];

  const { data: enrolls, error } = await supabaseAdmin
    .from('student_classes')
    .select('class_id, student_id, status')
    .in('class_id', classIds);
  if (error) {
    console.error('getMyStudents enrolls error:', error.message);
    return [];
  }

  const studentIds = [...new Set((enrolls || []).map((e) => e.student_id))];
  if (studentIds.length === 0) return [];

  const { data: students, error: sErr } = await supabaseAdmin
    .from('students')
    .select('id, user_id, student_id, full_name, status, academic_year, user:users ( id, email, phone, avatar_url )')
    .in('id', studentIds);
  if (sErr) {
    console.error('getMyStudents students error:', sErr.message);
    return [];
  }

  const byClass = {};
  (enrolls || []).forEach((e) => {
    byClass[e.student_id] = byClass[e.student_id] || [];
    const cls = classes.find((c) => c.id === e.class_id);
    if (cls) {
      byClass[e.student_id].push({
        id: cls.id,
        title: cls.title || cls.subject || 'Class',
      });
    }
  });

  return (students || []).map((s) => ({
    id: s.id,
    user_id: s.user_id,
    student_id: s.student_id,
    fullName: s.full_name,
    email: s.user?.email || null,
    phone: s.user?.phone || null,
    avatar_url: s.user?.avatar_url || null,
    status: s.status,
    academic_year: s.academic_year,
    classes: byClass[s.id] || [],
  }));
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/me
// ═══════════════════════════════════════════════════════════════
async function getMe(req, res) {
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, phone, role, avatar_url, last_login, created_at')
      .eq('id', req.user.id)
      .limit(1);

    const me = data?.[0] || null;
    const classes = await getMyClasses(req.user.id);

    res.json({ success: true, user: me, classes });
  } catch (err) {
    console.error('❌ staff getMe:', err.message);
    res.status(500).json({ error: 'Failed to fetch profile', details: err.message });
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
    res.status(500).json({ error: 'Failed to fetch stats', details: err.message });
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
    res.status(500).json({ error: 'Failed to fetch students', details: err.message });
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
      return res.status(403).json({ error: 'This student is not in your classes' });
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
    res.status(500).json({ error: 'Failed to fetch student', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/staff/students/:studentId/scores
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
      return res.status(400).json({ error: 'session, term, and subject are required' });
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
    res.status(500).json({ error: 'Failed to save scores', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/staff/students/:studentId/submit-results
// ═══════════════════════════════════════════════════════════════
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
    res.status(500).json({ error: 'Failed to submit results', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/assignments
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
      .select('*, class:class_id ( id, title ), submissions:submissions ( id, student_id, status )')
      .in('class_id', classIds)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('getAssignments error:', error.message);
      return res.json({ success: true, assignments: [], classes });
    }

    const assignments = (data || []).map((a) => ({
      ...a,
      submissionCount: a.submissions?.length || 0,
      pendingCount: a.submissions?.filter((s) => s.status === 'submitted').length || 0,
    }));

    res.json({ success: true, assignments, classes });
  } catch (err) {
    console.error('❌ staff getAssignments:', err.message);
    res.status(500).json({ error: 'Failed to fetch assignments', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/staff/assignments
// ═══════════════════════════════════════════════════════════════
async function createAssignment(req, res) {
  try {
    const staffId = req.user.id;
    const { class_id, title, description, due_date, subject, max_score } = req.body || {};

    if (!class_id || !title) {
      return res.status(400).json({ error: 'class_id and title are required' });
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
    res.status(500).json({ error: 'Failed to create assignment', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/messages/:studentId
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
    res.status(500).json({ error: 'Failed to fetch messages', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/staff/messages
// ═══════════════════════════════════════════════════════════════
async function sendMessage(req, res) {
  try {
    const staffId = req.user.id;
    const { studentId, body, content } = req.body || {};
    const messageBody = (body || content || '').trim();

    if (!studentId || !messageBody) {
      return res.status(400).json({ error: 'studentId and body are required' });
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
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/inbox
// ═══════════════════════════════════════════════════════════════
async function getInbox(req, res) {
  try {
    const staffId = req.user.id;
    const students = await getMyStudents(staffId);
    const studentUserIds = students.map((s) => s.user_id).filter(Boolean);
    if (studentUserIds.length === 0) return res.json({ success: true, inbox: [] });

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .or(
        `and(sender_id.eq.${staffId},recipient_id.in.(${studentUserIds.join(',')})),and(sender_id.in.(${studentUserIds.join(',')}),recipient_id.eq.${staffId})`
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
    res.status(500).json({ error: 'Failed to fetch inbox', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/staff/submissions/:assignmentId
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
      .select('*, student:student_id ( id, student_id, full_name, user:users ( email, avatar_url ) )')
      .eq('assignment_id', assignmentId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    res.json({ success: true, assignment, submissions: data || [] });
  } catch (err) {
    console.error('❌ staff getSubmissions:', err.message);
    res.status(500).json({ error: 'Failed to fetch submissions', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS — all 12 functions
// ═══════════════════════════════════════════════════════════════
module.exports = {
  getMe,
  getStats,
  getStudents,
  getStudentDetails,
  submitScores,
  submitResults,
  getAssignments,
  createAssignment,
  getConversation,
  sendMessage,
  getInbox,
  getSubmissions,
};
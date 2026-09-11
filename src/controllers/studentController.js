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

  // Auto-create
  const { data: userRows } = await supabaseAdmin
    .from('users')
    .select('id, email, full_name')
    .eq('id', userId)
    .limit(1);
  const user = userRows?.[0] || null;

  const { data: created, error: createErr } = await supabaseAdmin
    .from('students')
    .insert([{
      user_id: userId,
      student_id: `STU-${Date.now()}`,
      full_name: user?.full_name || user?.email?.split('@')[0] || null,
      email: user?.email || null,
      status: 'active',
      created_at: new Date().toISOString(),
    }])
    .select()
    .single();

  if (createErr) {
    if (createErr.code === '23505') return await findStudent(userId);
    throw createErr;
  }
  return created;
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
    res.status(500).json({ error: 'Failed to fetch profile', details: error.message });
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
      'date_of_birth', 'nationality', 'country_of_residence',
      'emergency_contact', 'emergency_phone',
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
    res.status(500).json({ error: 'Failed to update profile', details: error.message });
  }
}

// ============ COURSES ============
async function getCourses(req, res) {
  try {
    const userId = req.user.id;
    console.log('🔵 [getCourses] userId:', userId);

    const student = await ensureStudent(req);

    if (!student?.id) {
      console.warn('🟡 [getCourses] No student id — returning []');
      return res.json([]);
    }

    const { data, error } = await supabaseAdmin
      .from('enrollments')
      .select('*')
      .eq('student_id', student.id);

    if (error) {
      console.warn('⚠️ [getCourses] enrollments query error:', error.message);
      return res.json([]);
    }

    console.log(`🟢 [getCourses] Returning ${data?.length || 0} courses`);
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
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: enrollmentRows } = await supabaseAdmin
      .from('enrollments')
      .select('*')
      .eq('student_id', student.id)
      .eq('programme_id', courseId)
      .limit(1);

    if (!enrollmentRows || enrollmentRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this course' });
    }

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
    res.status(500).json({ error: 'Failed to fetch course details', details: error.message });
  }
}

// ============ ASSIGNMENTS ============
async function getAssignments(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: submissions } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });

    res.json({ submitted: submissions || [], pending: [] });
  } catch (error) {
    console.error('Get assignments error:', error);
    res.status(500).json({ error: 'Failed to fetch assignments', details: error.message });
  }
}

async function getAssignmentDetails(req, res) {
  try {
    const { assignmentId } = req.params;
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: assignmentRows, error } = await supabaseAdmin
      .from('assignments')
      .select('*')
      .eq('id', assignmentId)
      .limit(1);

    if (error) throw error;
    const assignment = assignmentRows?.[0];
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const { data: submissionRows } = await supabaseAdmin
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', student.id)
      .limit(1);

    res.json({ ...assignment, my_submission: submissionRows?.[0] || null });
  } catch (error) {
    console.error('Get assignment details error:', error);
    res.status(500).json({ error: 'Failed to fetch assignment details', details: error.message });
  }
}

async function submitAssignment(req, res) {
  try {
    const { assignmentId } = req.params;
    const { content, attachments } = req.body;

    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: assignmentRows } = await supabaseAdmin
      .from('assignments')
      .select('id, due_date, is_published')
      .eq('id', assignmentId)
      .limit(1);
    const assignment = assignmentRows?.[0];

    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (assignment.is_published === false) {
      return res.status(400).json({ error: 'Assignment is not available' });
    }
    if (assignment.due_date && new Date(assignment.due_date) < new Date()) {
      return res.status(400).json({ error: 'Assignment is past due date' });
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
      .insert([{
        assignment_id: assignmentId,
        student_id: student.id,
        content,
        attachments: attachments || [],
        status: 'submitted',
      }])
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({ message: 'Assignment submitted successfully', submission });
  } catch (error) {
    console.error('Submit assignment error:', error);
    res.status(500).json({ error: 'Failed to submit assignment', details: error.message });
  }
}

// ============ CLASSES ============
async function getClasses(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: classes, error } = await supabaseAdmin
      .from('student_classes')
      .select('*')
      .eq('student_id', student.id)
      .eq('status', 'active');

    if (error) throw error;
    res.json(classes || []);
  } catch (error) {
    console.error('Get classes error:', error);
    res.status(500).json({ error: 'Failed to fetch classes', details: error.message });
  }
}

async function getClassDetails(req, res) {
  try {
    const { classId } = req.params;
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: enrollmentRows } = await supabaseAdmin
      .from('student_classes')
      .select('*')
      .eq('student_id', student.id)
      .eq('class_id', classId)
      .eq('status', 'active')
      .limit(1);

    if (!enrollmentRows || enrollmentRows.length === 0) {
      return res.status(403).json({ error: 'Not enrolled in this class' });
    }

    const { data: classRows, error } = await supabaseAdmin
      .from('classes')
      .select('*')
      .eq('id', classId)
      .limit(1);

    if (error) throw error;
    const classData = classRows?.[0];
    if (!classData) return res.status(404).json({ error: 'Class not found' });

    res.json(classData);
  } catch (error) {
    console.error('Get class details error:', error);
    res.status(500).json({ error: 'Failed to fetch class details', details: error.message });
  }
}

// ============ RESULTS ============
async function getResults(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: results, error } = await supabaseAdmin
      .from('results')
      .select('*')
      .eq('student_id', student.id);

    if (error) throw error;

    let totalCredits = 0;
    let totalPoints = 0;
    results?.forEach((r) => {
      if (r.gpa && r.credits_earned) {
        totalCredits += r.credits_earned;
        totalPoints += r.gpa * r.credits_earned;
      }
    });

    const overallGPA = totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : null;

    res.json({
      results: results || [],
      overall_gpa: overallGPA,
      total_credits: totalCredits,
    });
  } catch (error) {
    console.error('Get results error:', error);
    res.status(500).json({ error: 'Failed to fetch results', details: error.message });
  }
}

async function getResultDetails(req, res) {
  try {
    const { resultId } = req.params;
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

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
    res.status(500).json({ error: 'Failed to fetch result details', details: error.message });
  }
}

// ============ PAYMENTS ============
async function getPayments(req, res) {
  try {
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

    const { data: payments, error } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const totalPaid = payments?.filter((p) => p.status === 'completed')
      .reduce((s, p) => s + (p.amount || 0), 0) || 0;
    const totalPending = payments?.filter((p) => p.status === 'pending')
      .reduce((s, p) => s + (p.amount || 0), 0) || 0;

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
    res.status(500).json({ error: 'Failed to fetch payments', details: error.message });
  }
}

async function getPaymentDetails(req, res) {
  try {
    const { paymentId } = req.params;
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

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
    res.status(500).json({ error: 'Failed to fetch payment details', details: error.message });
  }
}

// ============ MATERIALS ============
async function getMaterials(req, res) {
  try {
    const { classId } = req.params;
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

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
    res.status(500).json({ error: 'Failed to fetch materials', details: error.message });
  }
}

async function getMaterial(req, res) {
  try {
    const { classId, materialId } = req.params;
    const student = await ensureStudent(req);
    if (!student) return res.status(404).json({ error: 'Student record not found' });

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
    res.status(500).json({ error: 'Failed to fetch material', details: error.message });
  }
}

// ============ EXPORTS ============
module.exports = {
  getProfile,
  updateProfile,
  getCourses,
  getCourseDetails,
  getAssignments,
  getAssignmentDetails,
  submitAssignment,
  getClasses,
  getClassDetails,
  getResults,
  getResultDetails,
  getPayments,
  getPaymentDetails,
  getMaterials,
  getMaterial,
};
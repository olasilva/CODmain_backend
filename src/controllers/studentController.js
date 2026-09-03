const supabaseService = require('../services/supabaseService');

class StudentController {
  // Get student profile
  async getProfile(req, res) {
    try {
      const userId = req.user.id;
      
      // Get user data
      const user = await supabaseService.getUserById(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get student data
      const { data: student, error } = await supabaseService.client
        .from('students')
        .select('*, programmes(*)')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      // Remove sensitive data
      delete user.password_hash;

      res.json({
        user,
        student: student || null
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ error: 'Failed to fetch profile' });
    }
  }

  // Update student profile
  async updateProfile(req, res) {
    try {
      const userId = req.user.id;
      const updates = req.body;

      // Update user
      const userUpdates = {};
      const studentUpdates = {};

      // Separate user and student updates
      const userFields = ['full_name', 'phone', 'address', 'avatar_url'];
      const studentFields = ['date_of_birth', 'nationality', 'country_of_residence', 
                             'emergency_contact', 'emergency_phone'];

      Object.keys(updates).forEach(key => {
        if (userFields.includes(key)) {
          userUpdates[key] = updates[key];
        }
        if (studentFields.includes(key)) {
          studentUpdates[key] = updates[key];
        }
      });

      // Update user
      if (Object.keys(userUpdates).length > 0) {
        await supabaseService.update('users', userId, userUpdates);
      }

      // Update student
      if (Object.keys(studentUpdates).length > 0) {
        const { data: student } = await supabaseService.client
          .from('students')
          .select('id')
          .eq('user_id', userId)
          .single();

        if (student) {
          await supabaseService.update('students', student.id, studentUpdates);
        }
      }

      res.json({ message: 'Profile updated successfully' });
    } catch (error) {
      console.error('Update profile error:', error);
      res.status(500).json({ error: 'Failed to update profile' });
    }
  }

  // Get student's enrolled courses
  async getCourses(req, res) {
    try {
      const userId = req.user.id;
      
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: enrollments, error } = await supabaseService.client
        .from('enrollments')
        .select(`
          *,
          programmes:programme_id (*),
          classes:class_id (*)
        `)
        .eq('student_id', student.id);

      if (error) throw error;

      res.json(enrollments);
    } catch (error) {
      console.error('Get courses error:', error);
      res.status(500).json({ error: 'Failed to fetch courses' });
    }
  }

  // Get course details with materials and assignments
  async getCourseDetails(req, res) {
    try {
      const { courseId } = req.params;
      const userId = req.user.id;

      // Verify student has access to this course
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Check enrollment
      const { data: enrollment } = await supabaseService.client
        .from('enrollments')
        .select('*')
        .eq('student_id', student.id)
        .eq('programme_id', courseId)
        .single();

      if (!enrollment) {
        return res.status(403).json({ error: 'Not enrolled in this course' });
      }

      // Get course details
      const { data: course, error } = await supabaseService.client
        .from('programmes')
        .select(`
          *,
          classes:classes (*),
          assignments:assignments (
            *,
            submissions:submissions (id, student_id, status, score)
          )
        `)
        .eq('id', courseId)
        .single();

      if (error) throw error;

      // Filter assignments to show student's submissions
      if (course.assignments) {
        course.assignments = course.assignments.map(assignment => {
          const studentSubmission = assignment.submissions?.find(
            sub => sub.student_id === student.id
          );
          return {
            ...assignment,
            my_submission: studentSubmission || null,
            submissions: undefined
          };
        });
      }

      res.json(course);
    } catch (error) {
      console.error('Get course details error:', error);
      res.status(500).json({ error: 'Failed to fetch course details' });
    }
  }

  // Get student's assignments
  async getAssignments(req, res) {
    try {
      const userId = req.user.id;
      
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: submissions, error } = await supabaseService.client
        .from('submissions')
        .select(`
          *,
          assignment:assignment_id (
            *,
            class:class_id (*)
          )
        `)
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Get pending assignments (not submitted yet)
      const { data: pendingAssignments } = await supabaseService.client
        .from('assignments')
        .select(`
          *,
          class:class_id (*)
        `)
        .eq('is_published', true)
        .gt('due_date', new Date().toISOString());

      // Filter out assignments already submitted
      const submittedIds = submissions?.map(s => s.assignment_id) || [];
      const pending = pendingAssignments?.filter(a => !submittedIds.includes(a.id)) || [];

      res.json({
        submitted: submissions || [],
        pending: pending
      });
    } catch (error) {
      console.error('Get assignments error:', error);
      res.status(500).json({ error: 'Failed to fetch assignments' });
    }
  }

  // Get assignment details
  async getAssignmentDetails(req, res) {
    try {
      const { assignmentId } = req.params;
      const userId = req.user.id;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: assignment, error } = await supabaseService.client
        .from('assignments')
        .select(`
          *,
          class:class_id (*)
        `)
        .eq('id', assignmentId)
        .single();

      if (error) throw error;

      if (!assignment) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      // Get student's submission if exists
      const { data: submission } = await supabaseService.client
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignmentId)
        .eq('student_id', student.id)
        .single();

      res.json({
        ...assignment,
        my_submission: submission || null
      });
    } catch (error) {
      console.error('Get assignment details error:', error);
      res.status(500).json({ error: 'Failed to fetch assignment details' });
    }
  }

  // Submit assignment
  async submitAssignment(req, res) {
    try {
      const userId = req.user.id;
      const { assignmentId } = req.params;
      const { content, attachments } = req.body;

      // Get student
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Check if assignment exists and is active
      const { data: assignment } = await supabaseService.client
        .from('assignments')
        .select('id, due_date, is_published')
        .eq('id', assignmentId)
        .single();

      if (!assignment) {
        return res.status(404).json({ error: 'Assignment not found' });
      }

      if (!assignment.is_published) {
        return res.status(400).json({ error: 'Assignment is not available' });
      }

      // Check if assignment is overdue
      if (new Date(assignment.due_date) < new Date()) {
        return res.status(400).json({ error: 'Assignment is past due date' });
      }

      // Check if already submitted
      const { data: existing } = await supabaseService.client
        .from('submissions')
        .select('id')
        .eq('assignment_id', assignmentId)
        .eq('student_id', student.id)
        .single();

      if (existing) {
        return res.status(409).json({ error: 'Assignment already submitted' });
      }

      // Create submission
      const { data: submission, error } = await supabaseService.client
        .from('submissions')
        .insert([{
          assignment_id: assignmentId,
          student_id: student.id,
          content,
          attachments: attachments || [],
          status: 'submitted'
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: 'Assignment submitted successfully',
        submission
      });
    } catch (error) {
      console.error('Submit assignment error:', error);
      res.status(500).json({ error: 'Failed to submit assignment' });
    }
  }

  // Get student's classes
  async getClasses(req, res) {
    try {
      const userId = req.user.id;
      
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: classes, error } = await supabaseService.client
        .from('student_classes')
        .select(`
          *,
          class:class_id (
            *,
            programme:programme_id (*),
            instructor:instructor_id (full_name, email)
          )
        `)
        .eq('student_id', student.id)
        .eq('status', 'active');

      if (error) throw error;

      res.json(classes);
    } catch (error) {
      console.error('Get classes error:', error);
      res.status(500).json({ error: 'Failed to fetch classes' });
    }
  }

  // Get class details
  async getClassDetails(req, res) {
    try {
      const { classId } = req.params;
      const userId = req.user.id;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Verify enrollment
      const { data: enrollment } = await supabaseService.client
        .from('student_classes')
        .select('*')
        .eq('student_id', student.id)
        .eq('class_id', classId)
        .eq('status', 'active')
        .single();

      if (!enrollment) {
        return res.status(403).json({ error: 'Not enrolled in this class' });
      }

      // Get class details with materials and assignments
      const { data: classData, error } = await supabaseService.client
        .from('classes')
        .select(`
          *,
          programme:programme_id (*),
          instructor:instructor_id (full_name, email, phone),
          materials:course_materials (*),
          assignments:assignments (*)
        `)
        .eq('id', classId)
        .single();

      if (error) throw error;

      res.json(classData);
    } catch (error) {
      console.error('Get class details error:', error);
      res.status(500).json({ error: 'Failed to fetch class details' });
    }
  }

  // Get student's results
  async getResults(req, res) {
    try {
      const userId = req.user.id;
      
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: results, error } = await supabaseService.client
        .from('results')
        .select(`
          *,
          programme:programme_id (*)
        `)
        .eq('student_id', student.id)
        .order('semester', { ascending: false });

      if (error) throw error;

      // Calculate overall GPA
      let totalCredits = 0;
      let totalPoints = 0;
      
      results?.forEach(result => {
        if (result.gpa && result.credits_earned) {
          totalCredits += result.credits_earned;
          totalPoints += result.gpa * result.credits_earned;
        }
      });

      const overallGPA = totalCredits > 0 ? (totalPoints / totalCredits).toFixed(2) : null;

      res.json({
        results: results || [],
        overall_gpa: overallGPA,
        total_credits: totalCredits
      });
    } catch (error) {
      console.error('Get results error:', error);
      res.status(500).json({ error: 'Failed to fetch results' });
    }
  }

  // Get result details
  async getResultDetails(req, res) {
    try {
      const { resultId } = req.params;
      const userId = req.user.id;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: result, error } = await supabaseService.client
        .from('results')
        .select(`
          *,
          programme:programme_id (*),
          student:student_id (student_id, user:user_id (full_name))
        `)
        .eq('id', resultId)
        .eq('student_id', student.id)
        .single();

      if (error) throw error;

      if (!result) {
        return res.status(404).json({ error: 'Result not found' });
      }

      res.json(result);
    } catch (error) {
      console.error('Get result details error:', error);
      res.status(500).json({ error: 'Failed to fetch result details' });
    }
  }

  // Get student's payments
  async getPayments(req, res) {
    try {
      const userId = req.user.id;
      
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: payments, error } = await supabaseService.client
        .from('payments')
        .select('*')
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // Calculate payment summary
      const totalPaid = payments?.filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + p.amount, 0) || 0;

      const totalPending = payments?.filter(p => p.status === 'pending')
        .reduce((sum, p) => sum + p.amount, 0) || 0;

      res.json({
        payments: payments || [],
        summary: {
          total_paid: totalPaid,
          total_pending: totalPending,
          total_count: payments?.length || 0
        }
      });
    } catch (error) {
      console.error('Get payments error:', error);
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  }

  // Get payment details
  async getPaymentDetails(req, res) {
    try {
      const { paymentId } = req.params;
      const userId = req.user.id;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      const { data: payment, error } = await supabaseService.client
        .from('payments')
        .select('*')
        .eq('id', paymentId)
        .eq('student_id', student.id)
        .single();

      if (error) throw error;

      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      res.json(payment);
    } catch (error) {
      console.error('Get payment details error:', error);
      res.status(500).json({ error: 'Failed to fetch payment details' });
    }
  }

  // Get course materials for a class
  async getMaterials(req, res) {
    try {
      const { classId } = req.params;
      const userId = req.user.id;

      // Verify student has access
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Check enrollment
      const { data: enrollment } = await supabaseService.client
        .from('student_classes')
        .select('id')
        .eq('student_id', student.id)
        .eq('class_id', classId)
        .eq('status', 'active')
        .single();

      if (!enrollment) {
        return res.status(403).json({ error: 'Not enrolled in this class' });
      }

      const { data: materials, error } = await supabaseService.client
        .from('course_materials')
        .select('*')
        .eq('class_id', classId)
        .eq('is_published', true)
        .order('order_index', { ascending: true });

      if (error) throw error;

      res.json(materials);
    } catch (error) {
      console.error('Get materials error:', error);
      res.status(500).json({ error: 'Failed to fetch materials' });
    }
  }

  // Get specific material
  async getMaterial(req, res) {
    try {
      const { classId, materialId } = req.params;
      const userId = req.user.id;

      // Verify student has access
      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Check enrollment
      const { data: enrollment } = await supabaseService.client
        .from('student_classes')
        .select('id')
        .eq('student_id', student.id)
        .eq('class_id', classId)
        .eq('status', 'active')
        .single();

      if (!enrollment) {
        return res.status(403).json({ error: 'Not enrolled in this class' });
      }

      const { data: material, error } = await supabaseService.client
        .from('course_materials')
        .select('*')
        .eq('id', materialId)
        .eq('class_id', classId)
        .eq('is_published', true)
        .single();

      if (error) throw error;

      if (!material) {
        return res.status(404).json({ error: 'Material not found' });
      }

      res.json(material);
    } catch (error) {
      console.error('Get material error:', error);
      res.status(500).json({ error: 'Failed to fetch material' });
    }
  }
}

module.exports = new StudentController();
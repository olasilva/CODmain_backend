const supabaseService = require('../services/supabaseService');

class AdmissionController {
  // =========================================================
  // POST /api/admissions  — Start new admission
  // Accepts the payload from CompleteApplication.jsx
  // =========================================================
  async startAdmission(req, res) {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required',
        });
      }

      // Accept BOTH shapes: the new flat form OR legacy nested form
      const {
        // New flat shape (from CompleteApplication.jsx)
        studentName,
        dob,
        gender,
        nationality,
        previousSchool,
        guardianName,
        guardianEmail,
        guardianPhone,
        homeAddress,
        medicalNotes,
        course,
        trackName,
        // Legacy nested shape
        programmeId,
        academicYear,
        personalInfo,
        academicInfo,
      } = req.body;

      console.log('📝 Starting admission for user:', userId);
      console.log('📚 Received:', { studentName, course, trackName, programmeId });

      // Validate required fields (only what we truly need)
      if (!course || !trackName) {
        return res.status(400).json({
          success: false,
          error: 'Course and track name are required',
        });
      }

      if (!studentName || !guardianName || !guardianEmail || !guardianPhone || !homeAddress) {
        return res.status(400).json({
          success: false,
          error: 'Missing required student or guardian fields',
        });
      }

      // -----------------------------------------------------
      // 1. Find or create the student record for this user
      // -----------------------------------------------------
      let student = await supabaseService.getStudentByUserId(userId);

      if (!student) {
        console.log('👤 Student record not found — creating one…');
        const studentData = {
          user_id: userId,
          student_id: `STU-${Date.now()}`,
          full_name: studentName,
          academic_year: academicYear || new Date().getFullYear().toString(),
          status: 'active',
          created_at: new Date().toISOString(),
        };

        try {
          student = await supabaseService.createStudent(studentData);
          console.log('✅ Student created:', student?.id);
        } catch (err) {
          console.error('❌ createStudent failed:', err.message);
          return res.status(500).json({
            success: false,
            error: 'Failed to create student record',
            details: err.message,
          });
        }
      }

      if (!student?.id) {
        return res.status(500).json({
          success: false,
          error: 'Student record could not be resolved',
        });
      }

      // -----------------------------------------------------
      // 2. Check for existing admission for the same course+track
      // -----------------------------------------------------
      const existing = await supabaseService.getAll('admissions', {
        student_id: student.id,
        course,
        track_name: trackName,
      });

      if (existing && existing.length > 0) {
        return res.status(409).json({
          success: false,
          error: 'You have already applied for this programme',
          admission: existing[0],
        });
      }

      // -----------------------------------------------------
      // 3. Generate admission number
      // -----------------------------------------------------
      const admissionNumber = `ADM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

      // -----------------------------------------------------
      // 4. Build admission row (only fields that exist in your table)
      //    The SQL schema below creates exactly these columns.
      // -----------------------------------------------------
      const admissionData = {
        student_id: student.id,
        admission_number: admissionNumber,
        student_name: studentName,
        dob: dob || null,
        gender: gender || null,
        nationality: nationality || null,
        previous_school: previousSchool || null,
        guardian_name: guardianName,
        guardian_email: guardianEmail,
        guardian_phone: guardianPhone,
        home_address: homeAddress,
        medical_notes: medicalNotes || null,
        course,
        track_name: trackName,
        academic_year: academicYear || new Date().getFullYear().toString(),
        status: 'pending',
        created_at: new Date().toISOString(),
      };

      let admission;
      try {
        admission = await supabaseService.create('admissions', admissionData);
        console.log('✅ Admission created:', admission?.id);
      } catch (err) {
        console.error('❌ create admission failed:', err.message);
        console.error('   Payload:', JSON.stringify(admissionData, null, 2));
        return res.status(500).json({
          success: false,
          error: 'Failed to create admission record',
          details: err.message,
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Admission started successfully',
        admission,
      });
    } catch (error) {
      console.error('❌ Start admission error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to start admission',
        details: error.message,
      });
    }
  }

  // =========================================================
  // GET /api/admissions/status
  // =========================================================
  async getAdmissionStatus(req, res) {
    try {
      const userId = req.user?.id;
      console.log('🔍 Getting admission status for user:', userId);

      const student = await supabaseService.getStudentByUserId(userId);
      if (!student) {
        return res.status(404).json({
          success: false,
          error: 'Student record not found',
        });
      }

      const admissions = await supabaseService.getAll('admissions', {
        student_id: student.id,
      });

      console.log(`✅ Found ${admissions.length} admissions`);

      res.json({ success: true, admissions });
    } catch (error) {
      console.error('❌ Get admission status error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch admission status',
        details: error.message,
      });
    }
  }

  // =========================================================
  // POST /api/admissions/:admissionId/documents
  // =========================================================
  async submitDocuments(req, res) {
    try {
      const userId = req.user?.id;
      const { admissionId } = req.params;
      const { documents } = req.body;

      if (!documents) {
        return res.status(400).json({ success: false, error: 'Documents are required' });
      }

      const student = await supabaseService.getStudentByUserId(userId);
      if (!student) {
        return res.status(404).json({ success: false, error: 'Student record not found' });
      }

      const admission = await supabaseService.getById('admissions', admissionId);
      if (!admission) {
        return res.status(404).json({ success: false, error: 'Admission not found' });
      }

      if (admission.student_id !== student.id) {
        return res.status(403).json({ success: false, error: 'Unauthorized' });
      }

      if (!['pending', 'reviewing'].includes(admission.status)) {
        return res.status(400).json({
          success: false,
          error: 'Cannot submit documents at this stage',
        });
      }

      const updated = await supabaseService.update('admissions', admissionId, {
        documents,
        status: 'reviewing',
        updated_at: new Date().toISOString(),
      });

      res.json({
        success: true,
        message: 'Documents submitted successfully',
        admission: updated,
      });
    } catch (error) {
      console.error('❌ Submit documents error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to submit documents',
        details: error.message,
      });
    }
  }

  // =========================================================
  // GET /api/admissions/programmes
  // =========================================================
  async getProgrammes(req, res) {
    try {
      console.log('📚 Fetching programmes...');
      const programmes = await supabaseService.getProgrammes(true);
      res.json({ success: true, programmes });
    } catch (error) {
      console.error('❌ Get programmes error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch programmes',
        details: error.message,
      });
    }
  }

  async getProgrammeById(req, res) {
    try {
      const { programmeId } = req.params;
      const programme = await supabaseService.getProgrammeById(programmeId);
      if (!programme) {
        return res.status(404).json({ success: false, error: 'Programme not found' });
      }
      res.json({ success: true, programme });
    } catch (error) {
      console.error('❌ Get programme error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch programme',
        details: error.message,
      });
    }
  }
}

module.exports = new AdmissionController();
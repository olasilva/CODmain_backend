// src/controllers/admissionController.js
const { supabaseAdmin } = require('../config/supabase');

// ═══════════════════════════════════════════════════════════════
// POST /api/admissions/start
// ═══════════════════════════════════════════════════════════════
async function startAdmission(req, res) {
  try {
    console.log('📥 [startAdmission] req.body:', JSON.stringify(req.body, null, 2));

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const body = req.body || {};
    const personal = body.personalInfo || {};
    const academic = body.academicInfo || {};

    const studentName =
      personal.fullName || personal.studentName || body.studentName;
    const dob = personal.dateOfBirth || personal.dob || body.dob;
    const gender = personal.gender || body.gender;
    const nationality = personal.nationality || body.nationality;
    const previousSchool = personal.previousSchool || body.previousSchool;
    const guardianName = personal.guardianName || body.guardianName;
    const guardianEmail = personal.guardianEmail || body.guardianEmail;
    const guardianPhone = personal.guardianPhone || body.guardianPhone;
    const homeAddress = personal.homeAddress || body.homeAddress;
    const medicalNotes = personal.medicalNotes || body.medicalNotes;

    const course = academic.course || body.course || body.campus || body.programme;
    const trackName = academic.trackName || body.trackName || body.track;
    const academicYear =
      body.academicYear || new Date().getFullYear().toString();

    console.log('📚 Resolved:', { course, trackName, studentName });

    if (!course || !trackName) {
      return res.status(400).json({
        error: 'Course and track name are required',
        received: {
          course: course ?? null,
          trackName: trackName ?? null,
          bodyKeys: Object.keys(body),
          academicKeys: Object.keys(academic),
        },
      });
    }

    if (
      !studentName ||
      !guardianName ||
      !guardianEmail ||
      !guardianPhone ||
      !homeAddress
    ) {
      return res.status(400).json({
        error: 'Missing required student or guardian fields',
        received: {
          studentName: studentName ?? null,
          guardianName: guardianName ?? null,
          guardianEmail: guardianEmail ?? null,
          guardianPhone: guardianPhone ?? null,
          homeAddress: homeAddress ?? null,
          personalKeys: Object.keys(personal),
        },
      });
    }

    // ─── Find or auto-create the student row ───
    const { data: sRows } = await supabaseAdmin
      .from('students')
      .select('id, user_id, student_id, full_name, status')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);

    let student = sRows?.[0] || null;

    if (!student) {
      console.log('👤 Student row missing — creating one…');

      const { data: uRows } = await supabaseAdmin
        .from('users')
        .select('id, email, full_name')
        .eq('id', userId)
        .limit(1);
      const user = uRows?.[0] || null;

      const { data: created, error: cErr } = await supabaseAdmin
        .from('students')
        .insert([
          {
            user_id: userId,
            student_id: `STU-${Date.now()}`,
            full_name: studentName || user?.full_name || user?.email?.split('@')[0] || null,
            academic_year: academicYear,
            status: 'active',
            created_at: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (cErr) {
        if (cErr.code === '23505') {
          const { data: refetch } = await supabaseAdmin
            .from('students')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: true })
            .limit(1);
          student = refetch?.[0];
        } else {
          throw cErr;
        }
      } else {
        student = created;
      }
    }

    if (!student?.id) {
      return res.status(500).json({ error: 'Student record could not be resolved' });
    }

    // ─── Duplicate check ───
    const { data: existing } = await supabaseAdmin
      .from('admissions')
      .select('*')
      .eq('student_id', student.id)
      .eq('course', course)
      .eq('track_name', trackName)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({
        error: 'You have already applied for this programme',
        admission: existing[0],
      });
    }

    // ─── Create admission ───
    const admissionNumber = `ADM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const { data: admission, error: aErr } = await supabaseAdmin
      .from('admissions')
      .insert([
        {
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
          academic_year: academicYear,
          status: 'pending',
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (aErr) {
      console.error('❌ create admission failed:', aErr.message);
      return res.status(500).json({
        error: 'Failed to create admission record',
        details: aErr.message,
      });
    }

    console.log('✅ Admission created:', admission.id);

    res.status(201).json({
      success: true,
      message: 'Admission started successfully',
      admission,
    });
  } catch (error) {
    console.error('❌ startAdmission error:', error);
    res.status(500).json({
      error: 'Failed to start admission',
      details: error.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/admissions/status
// ═══════════════════════════════════════════════════════════════
async function getAdmissionStatus(req, res) {
  try {
    const userId = req.user?.id;

    const { data: sRows } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);
    const student = sRows?.[0];

    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const { data: admissions, error } = await supabaseAdmin
      .from('admissions')
      .select('*')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false });
    if (error) throw error;

    res.json({ success: true, admissions: admissions || [] });
  } catch (error) {
    console.error('❌ getAdmissionStatus error:', error.message);
    res.status(500).json({ error: 'Failed to fetch admission status', details: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/admissions/:admissionId/documents
// ═══════════════════════════════════════════════════════════════
async function submitDocuments(req, res) {
  try {
    const userId = req.user?.id;
    const { admissionId } = req.params;
    const { documents } = req.body;

    if (!documents) {
      return res.status(400).json({ error: 'Documents are required' });
    }

    const { data: sRows } = await supabaseAdmin
      .from('students')
      .select('id')
      .eq('user_id', userId)
      .order('created_at', { ascending: true })
      .limit(1);
    const student = sRows?.[0];
    if (!student) {
      return res.status(404).json({ error: 'Student record not found' });
    }

    const { data: aRows } = await supabaseAdmin
      .from('admissions')
      .select('*')
      .eq('id', admissionId)
      .limit(1);
    const admission = aRows?.[0];
    if (!admission) {
      return res.status(404).json({ error: 'Admission not found' });
    }

    if (admission.student_id !== student.id) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (!['pending', 'reviewing'].includes(admission.status)) {
      return res.status(400).json({ error: 'Cannot submit documents at this stage' });
    }

    const { data: updated, error } = await supabaseAdmin
      .from('admissions')
      .update({
        documents,
        status: 'reviewing',
        updated_at: new Date().toISOString(),
      })
      .eq('id', admissionId)
      .select()
      .single();
    if (error) throw error;

    res.json({ success: true, message: 'Documents submitted', admission: updated });
  } catch (error) {
    console.error('❌ submitDocuments error:', error.message);
    res.status(500).json({ error: 'Failed to submit documents', details: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/admissions/programmes
// ═══════════════════════════════════════════════════════════════
async function getProgrammes(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('programmes')
      .select('*')
      .eq('is_active', true)
      .order('title');
    if (error) throw error;
    res.json({ success: true, programmes: data || [] });
  } catch (error) {
    console.error('❌ getProgrammes error:', error.message);
    res.status(500).json({ error: 'Failed to fetch programmes', details: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/admissions/programmes/:programmeId
// ═══════════════════════════════════════════════════════════════
async function getProgrammeById(req, res) {
  try {
    const { programmeId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('programmes')
      .select('*')
      .eq('id', programmeId)
      .limit(1);
    if (error) throw error;
    if (!data?.[0]) {
      return res.status(404).json({ error: 'Programme not found' });
    }
    res.json({ success: true, programme: data[0] });
  } catch (error) {
    console.error('❌ getProgrammeById error:', error.message);
    res.status(500).json({ error: 'Failed to fetch programme', details: error.message });
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  startAdmission,
  getAdmissionStatus,
  submitDocuments,
  getProgrammes,
  getProgrammeById,
};
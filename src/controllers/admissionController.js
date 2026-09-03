const supabaseService = require('../services/supabaseService');
const { v4: uuidv4 } = require('uuid');

class AdmissionController {
  // Start new admission
  async startAdmission(req, res) {
    try {
      const userId = req.user.id;
      const { programmeId, academicYear } = req.body;

      // Get student
      const { data: student, error: studentError } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (studentError) throw studentError;

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Check if already applied
      const { data: existing } = await supabaseService.client
        .from('admissions')
        .select('id, status')
        .eq('student_id', student.id)
        .eq('programme_id', programmeId)
        .eq('academic_year', academicYear)
        .single();

      if (existing) {
        return res.status(409).json({ 
          error: 'Admission already exists',
          admission: existing 
        });
      }

      // Generate admission number
      const admissionNumber = `ADM${Date.now()}${Math.floor(Math.random() * 1000)}`;

      // Create admission
      const { data: admission, error } = await supabaseService.client
        .from('admissions')
        .insert([{
          student_id: student.id,
          admission_number: admissionNumber,
          programme_id: programmeId,
          academic_year: academicYear,
          status: 'pending'
        }])
        .select()
        .single();

      if (error) throw error;

      res.status(201).json({
        message: 'Admission started successfully',
        admission
      });
    } catch (error) {
      console.error('Start admission error:', error);
      res.status(500).json({ error: 'Failed to start admission' });
    }
  }

  // Get admission status
  async getAdmissionStatus(req, res) {
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

      const { data: admissions, error } = await supabaseService.client
        .from('admissions')
        .select(`
          *,
          programme:programme_id (*)
        `)
        .eq('student_id', student.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      res.json(admissions);
    } catch (error) {
      console.error('Get admission status error:', error);
      res.status(500).json({ error: 'Failed to fetch admission status' });
    }
  }

  // Submit application documents
  async submitDocuments(req, res) {
    try {
      const userId = req.user.id;
      const { admissionId } = req.params;
      const { documents } = req.body;

      const { data: student } = await supabaseService.client
        .from('students')
        .select('id')
        .eq('user_id', userId)
        .single();

      if (!student) {
        return res.status(404).json({ error: 'Student record not found' });
      }

      // Verify admission belongs to student
      const { data: admission } = await supabaseService.client
        .from('admissions')
        .select('id, status')
        .eq('id', admissionId)
        .eq('student_id', student.id)
        .single();

      if (!admission) {
        return res.status(404).json({ error: 'Admission not found' });
      }

      if (admission.status !== 'pending' && admission.status !== 'reviewing') {
        return res.status(400).json({ error: 'Cannot submit documents at this stage' });
      }

      // Update documents
      const { data: updated, error } = await supabaseService.client
        .from('admissions')
        .update({
          documents: documents,
          status: 'reviewing'
        })
        .eq('id', admissionId)
        .select()
        .single();

      if (error) throw error;

      res.json({
        message: 'Documents submitted successfully',
        admission: updated
      });
    } catch (error) {
      console.error('Submit documents error:', error);
      res.status(500).json({ error: 'Failed to submit documents' });
    }
  }

  // Get available programmes for admission
  async getProgrammes(req, res) {
    try {
      const { data: programmes, error } = await supabaseService.client
        .from('programmes')
        .select('*')
        .eq('is_active', true)
        .order('title');

      if (error) throw error;

      res.json(programmes);
    } catch (error) {
      console.error('Get programmes error:', error);
      res.status(500).json({ error: 'Failed to fetch programmes' });
    }
  }
}

module.exports = new AdmissionController();
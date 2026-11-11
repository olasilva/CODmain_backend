// src/services/staffMatching.js
const { supabaseAdmin } = require('../config/supabase');
const { trackCategory } = require('./programStructure');

/**
 * Given a student's programme info, find all staff who match.
 *
 * @param {object} student
 *   {
 *     trackName: 'Regular Track' | 'Music Track' | 'Mixed Track',
 *     regularClass: 'Nursery 1' | ... | null,
 *     instrument: 'Piano' | ... | null,
 *   }
 * @returns {Array} staff rows [{ id, full_name, email, staff_category, staff_levels }]
 */
async function findMatchingStaff(student) {
  if (!student || !student.trackName) return [];

  const category = trackCategory(student.trackName);

  // What levels does this student belong to?
  const studentLevels = [];
  if (student.regularClass) studentLevels.push(String(student.regularClass));
  if (student.instrument) studentLevels.push(String(student.instrument));

  if (!studentLevels.length) return [];

  // Build list of categories that could match
  const candidateCategories = {
    music: ['music'],
    academic: ['academic', 'mixed'],
    mixed_media: ['mixed_media', 'regular'],
  }[category] || [];
  if (candidateCategories.length === 0) return [];

  // Fetch all staff in candidate categories
  const { data: staff, error } = await supabaseAdmin
    .from('users')
    .select('id, full_name, email, staff_category, staff_levels')
    .eq('role', 'staff')
    .in('staff_category', candidateCategories);

  if (error) {
    console.error('findMatchingStaff error:', error.message);
    return [];
  }

  // Filter by level overlap
  const matched = (staff || []).filter((s) => {
    const levels = Array.isArray(s.staff_levels) ? s.staff_levels : [];
    if (levels.length === 0) {
      // Staff assigned to the category but no specific levels → sees all in category
      return true;
    }
    return levels.some((lvl) =>
      studentLevels.some(
        (sl) => sl.toLowerCase() === String(lvl).toLowerCase()
      )
    );
  });

  return matched;
}

module.exports = { findMatchingStaff };
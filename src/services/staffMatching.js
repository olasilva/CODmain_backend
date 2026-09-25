// src/services/staffMatching.js
const { supabaseAdmin } = require('../config/supabase');

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

  const track = String(student.trackName).toLowerCase();
  const isRegular = track.includes('regular');
  const isMusic = track.includes('music');
  const isMixed = track.includes('mixed');

  // What levels does this student belong to?
  const studentLevels = [];
  if (student.regularClass) studentLevels.push(String(student.regularClass));
  if (student.instrument) studentLevels.push(String(student.instrument));

  if (!studentLevels.length) return [];

  // Build list of categories that could match
  const candidateCategories = [];
  if (isRegular) candidateCategories.push('regular');
  if (isMusic) candidateCategories.push('music');
  if (isMixed) candidateCategories.push('mixed', 'regular', 'music'); // mixed students can be seen by anyone

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
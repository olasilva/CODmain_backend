// scripts/reset-admin-password.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { supabaseAdmin } = require('../src/config/supabase');

(async () => {
  const email = 'olasilvaolunleke@gmail.com';
  const newPassword = 'Admin123!COD'; // ← you can change this

  try {
    const hash = await bcrypt.hash(newPassword, 12);

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ password_hash: hash })
      .eq('email', email)
      .select('id, email, role')
      .single();

    if (error) {
      console.error('❌ Update failed:', error.message);
      process.exit(1);
    }

    console.log('✅ Password reset successfully');
    console.log('   Email:    ', data.email);
    console.log('   Role:     ', data.role);
    console.log('   Password: ', newPassword);
  } catch (err) {
    console.error('❌ Script error:', err.message);
    process.exit(1);
  }
})();
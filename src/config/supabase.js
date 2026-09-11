// src/config/supabase.js
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  throw new Error('❌ Missing SUPABASE_URL in .env');
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in .env');
}

// Anon client — only useful if you use Supabase Auth on the frontend
const supabase = SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

// Admin client — bypasses RLS. Use this everywhere on the backend.
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log('🔵 Supabase admin client initialized');
console.log('🔵 Supabase URL:', SUPABASE_URL);

module.exports = { supabase, supabaseAdmin };
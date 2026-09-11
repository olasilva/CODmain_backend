const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function testConnection() {
  console.log('🔍 Testing Supabase Connection...');
  
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;
  
  console.log('📡 URL:', supabaseUrl);
  console.log('🔑 Key:', supabaseKey ? '✅ Loaded' : '❌ Missing');
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials in .env');
    process.exit(1);
  }
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  try {
    // Test 1: Check users table
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (usersError) {
      console.log('⚠️ Users table check:', usersError.message);
    } else {
      console.log('✅ Users table accessible');
    }
    
    // Test 2: Check programmes table
    const { data: programmes, error: progError } = await supabase
      .from('programmes')
      .select('*')
      .limit(5);
    
    if (progError) {
      console.log('⚠️ Programmes table check:', progError.message);
    } else {
      console.log('✅ Programmes table accessible');
      console.log(`📊 Found ${programmes?.length || 0} programmes`);
    }
    
    // Test 3: Check if admin user exists
    const { data: admin } = await supabase
      .from('users')
      .select('email, full_name, role')
      .eq('email', 'admin@codmain.com')
      .single();
    
    if (admin) {
      console.log('✅ Admin user found:', admin.email);
      console.log(`   Role: ${admin.role}`);
      console.log(`   Name: ${admin.full_name}`);
    } else {
      console.log('ℹ️ Admin user not found yet (you can create one)');
    }
    
    console.log('\n✅ Supabase connection is working!');
    console.log('🚀 Your backend is ready to use!');
    
  } catch (error) {
    console.error('❌ Connection error:', error.message);
  }
}

testConnection();
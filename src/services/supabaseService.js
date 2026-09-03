const { createClient } = require('@supabase/supabase-js');

const configured = Boolean(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_ANON_KEY &&
  !process.env.SUPABASE_URL.includes('your_') &&
  !process.env.SUPABASE_ANON_KEY.includes('your_'),
);

const client = configured
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)
  : null;

async function getUserById(id) {
  if (!client) return null;
  const { data, error } = await client.from('users').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

async function update(table, id, values) {
  if (!client) return null;
  const { data, error } = await client.from(table).update(values).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

module.exports = { client, configured, getUserById, update };

// src/controllers/newsController.js
const { supabaseAdmin } = require('../config/supabase');

async function getNews(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from('news')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ [public getNews] Supabase error:', error.message);
      return res.status(500).json({
        error: 'Failed to fetch news',
        details: error.message,
      });
    }

    console.log('🔵 [public getNews] Total rows:', data?.length || 0);
    console.log('🔵 [public getNews] titles:', (data || []).map((p) => p.title));

    // Return a plain array — no wrapper
    res.json(data || []);
  } catch (err) {
    console.error('❌ [public getNews] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch news', details: err.message });
  }
}

async function getNewsBySlug(req, res) {
  try {
    const { slug } = req.params;
    const { data, error } = await supabaseAdmin
      .from('news')
      .select('*')
      .or(`slug.eq.${slug},id.eq.${slug}`)
      .limit(1);

    if (error) {
      console.error('❌ [getNewsBySlug] Supabase error:', error.message);
      return res.status(500).json({ error: 'Failed to fetch post', details: error.message });
    }
    if (!data?.[0]) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(data[0]);
  } catch (err) {
    console.error('❌ [getNewsBySlug] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch post', details: err.message });
  }
}

module.exports = { getNews, getNewsBySlug };
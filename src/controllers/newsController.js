// src/controllers/newsController.js
const { supabaseAdmin } = require('../config/supabase');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    const slugQuery = await supabaseAdmin
      .from('news')
      .select('*')
      .eq('slug', slug)
      .limit(1);

    if (slugQuery.error) {
      console.error('❌ [getNewsBySlug] Supabase error:', slugQuery.error.message);
      return res.status(500).json({
        error: 'Failed to fetch post',
        details: slugQuery.error.message,
      });
    }

    let post = slugQuery.data?.[0];

    // Only query the UUID column when the route value is actually a UUID.
    // Passing a slug to a UUID comparison causes a PostgREST cast error.
    if (!post && UUID_PATTERN.test(slug)) {
      const idQuery = await supabaseAdmin
        .from('news')
        .select('*')
        .eq('id', slug)
        .limit(1);

      if (idQuery.error) {
        console.error('❌ [getNewsBySlug] Supabase error:', idQuery.error.message);
        return res.status(500).json({
          error: 'Failed to fetch post',
          details: idQuery.error.message,
        });
      }

      post = idQuery.data?.[0];
    }

    if (!post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(post);
  } catch (err) {
    console.error('❌ [getNewsBySlug] error:', err.message);
    res.status(500).json({ error: 'Failed to fetch post', details: err.message });
  }
}

module.exports = { getNews, getNewsBySlug };
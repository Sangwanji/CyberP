import { createClient } from '@supabase/supabase-js';

let supabase = null;

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim() ?? '';
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY?.trim() ?? '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  if (!supabase) {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
  }

  return supabase;
}

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (!token) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    const client = getSupabaseClient();
    if (!client) {
      return res.status(503).json({ success: false, error: 'Authentication service is not configured on this server.' });
    }

    const { data, error } = await client.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ success: false, error: 'Invalid or expired session.' });
    }

    req.user = data.user;
    return next();
  } catch (error) {
    return next(error);
  }
}

export default requireAuth;

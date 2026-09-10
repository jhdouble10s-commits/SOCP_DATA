module.exports = function handler(request, response) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return response.status(500).json({ error: "Supabase environment variables are not configured." });
  }

  // Supabase publishable/anon key is designed for browser use. Never expose a service-role key here.
  response.setHeader("Cache-Control", "no-store");
  return response.status(200).json({ supabaseUrl, supabasePublishableKey });
};

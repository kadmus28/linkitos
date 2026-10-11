// The publishable key is intended for browser apps. Row access is restricted by RLS.
window.LINKITOS_CONFIG = {
  supabaseUrl: "https://akyewbyhbgcvlcblkerb.supabase.co",
  supabasePublishableKey: "sb_publishable_dU4LsS18yL-zdM_3FBe7ew_ONjxhPvr",
};

window.supabaseReady = import("https://esm.sh/@supabase/supabase-js@2.57.0")
  .then(({ createClient }) => {
    window.linkitosSupabase = createClient(
      window.LINKITOS_CONFIG.supabaseUrl,
      window.LINKITOS_CONFIG.supabasePublishableKey,
      { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
    );
    return window.linkitosSupabase;
  });

/* ============================================================
   Cairn — configuration
   This is the ONLY file you need to edit to make the app yours.
   Everything here is safe to publish in public code.
   ============================================================ */
export const CONFIG = {
  appName:  'Cairn',
  tagline:  'A place to remember what God has done.',

  /* --- Supabase (login + sync across devices) -----------------
     Get these from your Supabase project: Settings -> API.
     Leave them empty and the app still works perfectly, saving
     to whatever browser you're using. Fill them in to turn on
     Google sign-in and cross-device sync.                       */
  supabaseUrl:     'https://wifzclmbhowdcafotmtb.supabase.co',
  supabaseAnonKey: 'sb_publishable_f30GNeR5Thjr9Yi7BeNQvQ_0QNC_Oa_',

  /* --- Support the creator ----------------------------------- */
  kofiUrl: 'https://ko-fi.com/gabrielnichols',

  /* --- Email list --------------------------------------------
     Paste the FORM ACTION url from your email provider.
     Buttondown free tier: https://buttondown.com/api/emails/embed-subscribe/YOURNAME
     Leave empty to hide the signup box.                         */
  emailListAction: '',

  /* --- Where feature suggestions go if cloud sync is off ------ */
  contactEmail: '',

  /* --- Optional social link (leave url empty to hide) --------- */
  social: { label: '', url: '' },
};

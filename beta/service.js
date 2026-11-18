// Plans, limits and the backend address.
// With API_BASE set, questions are written by the server (supabase/functions/generate) for the signed-in
// account, and the limits below are enforced there; this file only mirrors them for the screens.
// With API_BASE empty the app runs in trial mode: the visitor's own Claude API key, limits in the browser only.

export const SUPABASE_URL = 'https://qfuqoadlnvuivpeqkcut.supabase.co';
// Publishable key: meant to be shipped in the browser. Row-level security decides what it can read.
export const SUPABASE_KEY = 'sb_publishable_Uukn6fzIWQh0Va50s6u9OA_cUFztRsc';
export const API_BASE = `${SUPABASE_URL}/functions/v1/generate`;
export const BILLING_BASE = `${SUPABASE_URL}/functions/v1/billing`;
export const SERVER_MODEL = 'claude-sonnet-5-5';
// Turn on once the Stripe keys are set on the server (supabase/functions/billing).
const PAYMENTS_READY = true;

export const PRICE = { amount: 10, currency: 'RM', per: '月' };
export const FREE_LIMITS = { files: 1, questions: 5, perDay: 3 };
export const PRO_LIMITS = { files: 10, questions: 150 }; // questions: the monthly allowance (the server counts it too)

// The signed-in account. account.js keeps it up to date.
export const account = { ready: false, user: null, plan: 'free' };

export const usesOwnKey = () => !API_BASE;
export const checkoutReady = () => PAYMENTS_READY;

export function planOf(settings) {
  if (!API_BASE) return settings.devPro ? 'pro' : 'free';
  return account.plan;
}

// What generate() is allowed to do on this plan. Pro has no question cap.
export function limitsOf(settings) {
  return planOf(settings) === 'pro' ? { files: PRO_LIMITS.files } : { files: FREE_LIMITS.files, questions: FREE_LIMITS.questions };
}

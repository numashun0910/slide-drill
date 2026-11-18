// Sign-in (a link sent by email, no password) and the account's plan, through Supabase.

import { SUPABASE_URL, SUPABASE_KEY, API_BASE, BILLING_BASE, account } from './service.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
let sb = null;

// Lets the browser test swap in a fake client.
export const deps = {
  async createSupabase() {
    const { createClient } = await import(SUPABASE_JS);
    return createClient(SUPABASE_URL, SUPABASE_KEY);
  },
};

// An invite link (?invite=CODE) is remembered until the visitor signs in, since the sign-in link drops the query.
const INVITE_KEY = 'sd-invite';
try {
  const code = new URLSearchParams(location.search).get('invite');
  if (code) {
    localStorage.setItem(INVITE_KEY, code);
    history.replaceState(null, '', location.pathname + location.hash);
  }
} catch { /* storage blocked */ }
export function pendingInvite() {
  try { return localStorage.getItem(INVITE_KEY) || ''; } catch { return ''; }
}

async function readProfile() {
  const { data } = await sb.from('profiles').select('plan, pro_until, stripe_customer_id, stripe_subscription_id').eq('id', account.user.id).maybeSingle();
  return data;
}

async function redeem(code) {
  const res = await fetch(`${BILLING_BASE}/redeem`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  // A wrong code is dropped too, so it is not retried on every visit.
  if (res.ok || res.status === 400) { try { localStorage.removeItem(INVITE_KEY); } catch {} }
  account.inviteResult = res.ok ? 'ok' : res.status === 400 ? 'bad' : '';
}

async function load(session, onChange) {
  account.user = session && session.user ? { id: session.user.id, email: session.user.email } : null;
  account.plan = 'free';
  if (account.user) {
    let data = await readProfile();
    if (pendingInvite() && !(data && data.stripe_subscription_id)) {
      await redeem(pendingInvite()).catch(() => {});
      data = await readProfile();
    }
    if (data && data.plan === 'pro' && (!data.pro_until || new Date(data.pro_until) > new Date())) account.plan = 'pro';
    account.proUntil = data ? data.pro_until : null;
    account.invited = !!(data && data.plan === 'pro' && !data.stripe_customer_id);
  }
  account.ready = true;
  onChange();
}

export async function initAccount(onChange) {
  if (!API_BASE) { account.ready = true; return; }
  try {
    sb = await deps.createSupabase();
    // Supabase must not be called from inside this callback, so the work is put off by one tick.
    sb.auth.onAuthStateChange((_event, session) => { setTimeout(() => load(session, onChange).catch(() => {}), 0); });
  } catch (err) {
    account.ready = true;
    onChange();
  }
}

export async function signIn(email) {
  if (!sb) throw new Error('offline');
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

export async function accessToken() {
  if (!sb) return '';
  const { data } = await sb.auth.getSession();
  return data && data.session ? data.session.access_token : '';
}

// How many times this account generated in the last 24 hours (the free plan's daily limit counts these).
export async function usedToday() {
  if (!sb || !account.user) return 0;
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await sb.from('usage').select('id', { count: 'exact', head: true }).gte('created_at', since);
  return count || 0;
}

// Sends the visitor to Stripe: 'checkout' to subscribe to Pro, 'portal' to cancel or change the card.
export async function openBilling(route) {
  const res = await fetch(`${BILLING_BASE}/${route}`, { method: 'POST', headers: { Authorization: `Bearer ${await accessToken()}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error([res.status, data.error, data.detail].filter(Boolean).join(' / ') || 'billing');
  location.href = data.url;
}

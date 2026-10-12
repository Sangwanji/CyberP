import type { ScanResponse } from '../types/scan';
import { supabase } from './supabaseClient';

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');

// Returns the current session's JWT or null if the user is not signed in.
async function getAuthToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

// Builds the standard headers for every backend request.
// Always sends Content-Type; attaches Authorization when a token is available.
async function buildHeaders(token?: string | null): Promise<Record<string, string>> {
  const jwt = token !== undefined ? token : await getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (jwt) headers['Authorization'] = `Bearer ${jwt}`;
  return headers;
}

// ── Typed response helper ─────────────────────────────────────────────────────

async function apiFetch<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)['error']?.toString()
          ?? (payload as Record<string, unknown>)['message']?.toString()
          ?? `Request failed with status ${response.status}`
        : `Request failed with status ${response.status}`;
    throw new Error(errorMessage);
  }

  return payload as T;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function scanTargetUrl(url: string): Promise<ScanResponse> {
  const headers = await buildHeaders();
  const result = await apiFetch<ScanResponse>(`${apiBaseUrl}/scan`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
  });
  console.log('Scan response from backend:', result);
  return result;
}

export async function callAiSummary(
  scanResult: ScanResponse | null,
  zapAlerts: unknown[] | null,
  zapOverview: unknown | null,
  token: string,
): Promise<string> {
  const headers = await buildHeaders(token);
  const data = await apiFetch<{ success: boolean; summary: string }>(
    `${apiBaseUrl}/ai/summary`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ scanResult, zapAlerts, zapOverview }),
    },
  );
  return data.summary;
}

export async function callAiVaptReport(
  scanResult: ScanResponse | null,
  zapAlerts: unknown[] | null,
  token: string,
): Promise<unknown> {
  const headers = await buildHeaders(token);
  const data = await apiFetch<{ success: boolean; report: unknown }>(
    `${apiBaseUrl}/ai/vapt-report`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ scanResult, zapAlerts }),
    },
  );
  return data.report;
}

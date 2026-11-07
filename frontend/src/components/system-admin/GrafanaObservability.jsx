import React, { useEffect, useRef, useState } from 'react';
import { createSystemAdminGrafanaSession } from '../../services/api';
import { readSystemTheme } from '../../services/themePreference';

const dashboards = [
  { uid: 'blockgo-kubernetes-memory', label: 'Kubernetes Memory' },
  { uid: 'blockgo-api-observability', label: 'API Errors & Latency' },
  { uid: 'blockgo-fabric', label: 'Fabric Network' },
  { uid: 'blockgo-postgresql', label: 'PostgreSQL' },
  { uid: 'blockgo-workflows', label: 'BlockGO Workflows' },
  { uid: 'blockgo-logs', label: 'Logs' },
];

const normalizedTheme = (theme) => theme === 'dark' ? 'dark' : 'light';

const parseGrafanaUrl = (value) => new URL(value, window.location.origin);
const formatGrafanaUrl = (parsed, original) => /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(original)
  ? parsed.toString()
  : `${parsed.pathname}${parsed.search}${parsed.hash}`;

export function withGrafanaTheme(url, theme) {
  if (!url) return '';
  const parsed = parseGrafanaUrl(url);
  parsed.searchParams.set('theme', normalizedTheme(theme));
  return formatGrafanaUrl(parsed, url);
}

export function dashboardUrl(baseUrl, uid, theme) {
  const parsed = parseGrafanaUrl(baseUrl);
  const slug = uid.replace(/^blockgo-/, '');
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/d/${encodeURIComponent(uid)}/${encodeURIComponent(slug)}`;
  if (!parsed.searchParams.has('orgId')) parsed.searchParams.set('orgId', '1');
  if (!parsed.searchParams.has('kiosk')) parsed.searchParams.set('kiosk', '');
  parsed.searchParams.set('theme', normalizedTheme(theme));
  return formatGrafanaUrl(parsed, baseUrl);
}

function GrafanaObservability({ systemTheme = readSystemTheme() }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [frameUrl, setFrameUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [frameLoading, setFrameLoading] = useState(true);
  const systemThemeRef = useRef(systemTheme);
  systemThemeRef.current = systemTheme;

  useEffect(() => {
    let active = true;
    const openSession = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await createSystemAdminGrafanaSession();
        if (!active) return;
        const nextBaseUrl = response?.url || '/api/SystemMonitoring/grafana/';
        setBaseUrl(nextBaseUrl);
        setFrameLoading(true);
        setFrameUrl(dashboardUrl(nextBaseUrl, dashboards[0].uid, systemThemeRef.current));
      } catch (requestError) {
        if (active) setError(requestError.message || 'Grafana could not be opened.');
      } finally {
        if (active) setLoading(false);
      }
    };
    openSession();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setFrameLoading(true);
    setFrameUrl((currentUrl) => currentUrl ? withGrafanaTheme(currentUrl, systemTheme) : currentUrl);
  }, [systemTheme]);

  const selectDashboard = (uid) => {
    setFrameLoading(true);
    setFrameUrl(dashboardUrl(baseUrl, uid, systemTheme));
  };

  return (
    <div className="space-y-4 text-slate-900 dark:text-slate-100">
      <div className="border-b border-slate-300 pb-4 dark:border-slate-700">
        <p className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">System Admin Only</p>
        <h2 className="mt-1 text-2xl font-bold text-[#003366] dark:text-sky-300">Grafana Observability</h2>
        
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Grafana dashboards">
        {dashboards.map((dashboard) => (
          <button
            key={dashboard.uid}
            type="button"
            disabled={!baseUrl}
            onClick={() => selectDashboard(dashboard.uid)}
            className="rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-bold text-[#003366] transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-sky-300 dark:hover:bg-slate-800"
          >
            {dashboard.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-300">{error}</div>
      ) : loading ? (
        <div className="flex min-h-[65vh] items-center justify-center rounded-md border border-slate-200 bg-white text-sm font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          Opening protected Grafana session...
        </div>
      ) : (
        <div className="relative min-h-[640px] overflow-hidden rounded-md border border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          {frameLoading ? <div role="status" className="absolute inset-0 z-10 flex items-center justify-center bg-white text-sm font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">Loading Grafana dashboard...</div> : null}
          <iframe
            key={frameUrl}
            src={frameUrl}
            title="BlockGO Grafana observability dashboards"
            className="h-[74vh] min-h-[640px] w-full bg-white"
            referrerPolicy="same-origin"
            onLoad={() => setFrameLoading(false)}
          />
        </div>
      )}
    </div>
  );
}

export default GrafanaObservability;

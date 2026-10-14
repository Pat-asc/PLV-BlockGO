import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GrafanaObservability, { dashboardUrl, withGrafanaTheme } from './GrafanaObservability';
import { createSystemAdminGrafanaSession } from '../../services/api';

jest.mock('../../services/api', () => ({
  createSystemAdminGrafanaSession: jest.fn(),
}));

const protectedBaseUrl = '/api/SystemMonitoring/grafana/?orgId=7&refresh=30s&var-service=grade';

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  createSystemAdminGrafanaSession.mockResolvedValue({ url: protectedBaseUrl });
});

test('builds the protected dashboard URL with the initial dark theme and retained parameters', async () => {
  render(<GrafanaObservability systemTheme="dark" />);

  const frame = await screen.findByTitle('BlockGO Grafana observability dashboards');
  const url = new URL(frame.getAttribute('src'), window.location.origin);
  expect(url.pathname).toBe('/api/SystemMonitoring/grafana/d/blockgo-kubernetes-memory/kubernetes-memory');
  expect(url.searchParams.get('orgId')).toBe('7');
  expect(url.searchParams.get('refresh')).toBe('30s');
  expect(url.searchParams.get('var-service')).toBe('grade');
  expect(url.searchParams.get('theme')).toBe('dark');
  expect(url.searchParams.getAll('theme')).toHaveLength(1);
  expect(createSystemAdminGrafanaSession).toHaveBeenCalledTimes(1);
});

test('initializes Grafana in light mode when the system preference is light', async () => {
  render(<GrafanaObservability systemTheme="light" />);

  const frame = await screen.findByTitle('BlockGO Grafana observability dashboards');
  expect(new URL(frame.getAttribute('src'), window.location.origin).searchParams.get('theme')).toBe('light');
});

test('live theme changes retain the selected dashboard and do not recreate the authenticated session', async () => {
  const { rerender } = render(<GrafanaObservability systemTheme="light" />);
  await screen.findByTitle('BlockGO Grafana observability dashboards');
  fireEvent.click(screen.getByRole('button', { name: 'API Errors & Latency' }));
  let frame = screen.getByTitle('BlockGO Grafana observability dashboards');
  expect(frame.getAttribute('src')).toContain('/d/blockgo-api-observability/api-observability');

  rerender(<GrafanaObservability systemTheme="dark" />);
  await waitFor(() => expect(new URL(screen.getByTitle('BlockGO Grafana observability dashboards').getAttribute('src'), window.location.origin).searchParams.get('theme')).toBe('dark'));
  frame = screen.getByTitle('BlockGO Grafana observability dashboards');
  expect(frame.getAttribute('src')).toContain('/d/blockgo-api-observability/api-observability');
  expect(frame.getAttribute('src')).toContain('refresh=30s');

  rerender(<GrafanaObservability systemTheme="light" />);
  await waitFor(() => expect(new URL(screen.getByTitle('BlockGO Grafana observability dashboards').getAttribute('src'), window.location.origin).searchParams.get('theme')).toBe('light'));
  expect(createSystemAdminGrafanaSession).toHaveBeenCalledTimes(1);
});

test('theme URL helpers replace duplicate theme parameters without changing path, filters, or fragment', () => {
  const original = '/api/SystemMonitoring/grafana/d/blockgo-logs/logs?orgId=2&theme=light&theme=dark&from=now-6h&to=now&var-node=node-a#panel-4';
  const themed = withGrafanaTheme(original, 'dark');
  const parsed = new URL(themed, window.location.origin);

  expect(parsed.pathname).toBe('/api/SystemMonitoring/grafana/d/blockgo-logs/logs');
  expect(parsed.searchParams.getAll('theme')).toEqual(['dark']);
  expect(parsed.searchParams.get('orgId')).toBe('2');
  expect(parsed.searchParams.get('from')).toBe('now-6h');
  expect(parsed.searchParams.get('to')).toBe('now');
  expect(parsed.searchParams.get('var-node')).toBe('node-a');
  expect(parsed.hash).toBe('#panel-4');

  const dashboard = new URL(dashboardUrl('/api/SystemMonitoring/grafana/?orgId=3&refresh=10s', 'blockgo-fabric', 'dark'), window.location.origin);
  expect(dashboard.pathname).toBe('/api/SystemMonitoring/grafana/d/blockgo-fabric/fabric');
  expect(dashboard.searchParams.get('orgId')).toBe('3');
  expect(dashboard.searchParams.get('refresh')).toBe('10s');
  expect(dashboard.searchParams.get('theme')).toBe('dark');
});

test('uses the existing loading surface while a themed iframe reloads', async () => {
  const { rerender } = render(<GrafanaObservability systemTheme="light" />);
  const frame = await screen.findByTitle('BlockGO Grafana observability dashboards');
  expect(screen.getByRole('status')).toHaveTextContent('Loading Grafana dashboard...');
  fireEvent.load(frame);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();

  rerender(<GrafanaObservability systemTheme="dark" />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading Grafana dashboard...');
});

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import RegistrarHeader from '../registrar/RegistrarHeader';
import ChairpersonHeader from '../chairperson/ChairpersonHeader';
import FacultyHeader from '../faculty/FacultyHeader';
import StudentNavbar from '../student/StudentNavbar';
import SystemAdminPortal from '../system-admin/SystemAdminPortal';

jest.mock('../../services/api', () => ({ fetchSupportTickets: jest.fn().mockResolvedValue({ data: [] }) }));
jest.mock('../system-admin/SystemMonitoring', () => () => <div>Monitoring</div>);
jest.mock('../system-admin/RegistrarAccountManagement', () => () => <div>Registrars</div>);
jest.mock('../system-admin/SupportTicketManagement', () => () => <div>Tickets</div>);
jest.mock('../system-admin/GrafanaObservability', () => () => <div>Grafana</div>);
jest.mock('../system-admin/SystemAdminTransactions', () => () => <div>Transactions</div>);
jest.mock('../system-admin/CouchDbBrowser', () => () => <div>CouchDB</div>);

const portalHeaders = [
  ['System Administrator', <SystemAdminPortal adminData={{}} onLogout={() => {}} />],
  ['Registrar', <RegistrarHeader registrarData={{}} onLogout={() => {}} />],
  ['Chairperson', <ChairpersonHeader chairpersonData={{}} onLogout={() => {}} />],
  ['Faculty', <FacultyHeader facultyData={{}} onLogout={() => {}} />],
  ['Student', <StudentNavbar onLogout={() => {}} onOpenSettings={() => {}} />],
];

test.each(portalHeaders)('%s header exposes exactly one shared Settings action', (_role, header) => {
  render(header);
  expect(screen.getAllByRole('button', { name: /^Settings$/i })).toHaveLength(1);
  cleanup();
});

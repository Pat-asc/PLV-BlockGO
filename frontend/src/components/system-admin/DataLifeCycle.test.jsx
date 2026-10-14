import { render, screen } from '@testing-library/react';
import DataLifeCycle, { storageMapping } from './DataLifeCycle';

test('renders a verified lifecycle that separates PostgreSQL, blockchain, and world state', () => {
  render(<DataLifeCycle />);
  expect(screen.getByText('BlockGo Data Life Cycle')).toBeInTheDocument();
  expect(screen.getAllByText(/PostgreSQL/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Hyperledger Fabric/i).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/CouchDB/i).length).toBeGreaterThan(0);
  const draft = storageMapping.find(([type]) => type.startsWith('Draft'));
  expect(draft[3]).toContain('PostgreSQL');
  expect(draft[4]).toBe('No');
  expect(screen.getByText(/Fabric Version 1/i)).toBeInTheDocument();
  expect(screen.getByText(/immutable prior versions remain/i)).toBeInTheDocument();
});

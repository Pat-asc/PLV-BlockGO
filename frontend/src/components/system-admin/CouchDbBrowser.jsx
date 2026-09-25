import React, { useCallback, useEffect, useState } from 'react';
import { fetchCouchDbDatabases, fetchCouchDbDocuments } from '../../services/api';

const targets = [{ id: 'registrar', label: 'Registrar State' }, { id: 'faculty', label: 'Faculty State' }, { id: 'department', label: 'Department State' }];

function CouchDbBrowser() {
  const [target, setTarget] = useState('registrar');
  const [databases, setDatabases] = useState([]);
  const [database, setDatabase] = useState('');
  const [documents, setDocuments] = useState([]);
  const [page, setPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setDatabase(''); setDocuments([]); setPage(1); setError('');
    fetchCouchDbDatabases(target, { signal: controller.signal })
      .then((response) => setDatabases(Array.isArray(response?.data) ? response.data : []))
      .catch((requestError) => { if (requestError.name !== 'AbortError') setError(requestError.message || 'CouchDB databases could not be loaded.'); });
    return () => controller.abort();
  }, [target]);

  const loadDocuments = useCallback(async (nextPage = page) => {
    if (!database) return;
    setError('');
    try {
      const response = await fetchCouchDbDocuments(target, database, nextPage);
      setDocuments(Array.isArray(response?.data) ? response.data : []);
      setHasNextPage(Boolean(response?.hasNextPage));
      setPage(nextPage);
    } catch (requestError) { setError(requestError.message || 'CouchDB documents could not be loaded.'); }
  }, [database, page, target]);

  return <section className="space-y-5">
    <div className="border-b border-slate-300 pb-5"><p className="text-xs font-bold uppercase text-slate-500">Protected Data Inspection</p><h2 className="mt-1 text-2xl font-bold text-[#003366]">Read-only CouchDB Browser</h2><p className="mt-2 text-sm text-slate-600">Only internal application-state databases are available. Credentials, wallets, system databases, and sensitive document fields are never returned.</p></div>
    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
      <label className="text-sm font-semibold">Campus state target<select aria-label="CouchDB target" value={target} onChange={(event) => setTarget(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3">{targets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label className="text-sm font-semibold">Database<select aria-label="CouchDB database" value={database} onChange={(event) => { setDatabase(event.target.value); setDocuments([]); setPage(1); }} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 px-3"><option value="">Select a database</option>{databases.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <button type="button" disabled={!database} onClick={() => loadDocuments(1)} className="min-h-11 rounded-md bg-[#003366] px-5 text-sm font-bold text-white disabled:bg-slate-400">Load documents</button>
    </div>
    {error ? <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-red-800">{error}</div> : null}
    <div className="space-y-3">{documents.map((item) => <article key={item.id} className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm"><h3 className="border-b bg-slate-50 px-4 py-3 font-mono text-sm font-bold text-[#003366]">{item.id}</h3><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all p-4 text-xs text-slate-700">{JSON.stringify(item.document, null, 2)}</pre></article>)}{database && !documents.length && !error ? <p className="rounded-md border border-dashed p-8 text-center text-slate-500">Load the selected database to inspect its documents.</p> : null}</div>
    {documents.length ? <div className="flex items-center justify-end gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => loadDocuments(page - 1)} className="min-h-11 rounded-md border px-4 disabled:opacity-40">Previous</button><span>Page {page}</span><button type="button" disabled={!hasNextPage} onClick={() => loadDocuments(page + 1)} className="min-h-11 rounded-md border px-4 disabled:opacity-40">Next</button></div> : null}
  </section>;
}

export default CouchDbBrowser;

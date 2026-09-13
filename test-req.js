async function test() {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjIsImVtYWlsIjoicmVnaXN0cmFyQHBsdi5lZHUucGgiLCJ1c2VybmFtZSI6InJlZ2lzdHJhckBwbHYuZWR1LnBoIiwicm9sZSI6InJlZ2lzdHJhciIsImRiUm9sZSI6InJlZ2lzdHJhciIsImRlcGFydG1lbnQiOiIiLCJpYXQiOjE3ODkxOTg1MTIsImV4cCI6MTc4OTI4NDkxMn0.KSiOz4SunTL_5locGAyY_hZgSiKPQ7TFGTuEsXfTO6o';
    const res = await fetch('http://localhost:8080/api/password-reset-requests', {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    console.log('Status:', res.status);
    console.log('Result:', await res.text());
}
test().catch(console.error);

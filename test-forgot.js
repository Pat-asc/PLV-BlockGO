async function test() {
    console.log('Sending forgot password request...');
    const res = await fetch('http://localhost:8080/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'system-admin@plv.edu.ph' })
    });
    console.log('Status:', res.status);
    console.log('Result:', await res.text());
}
test().catch(console.error);

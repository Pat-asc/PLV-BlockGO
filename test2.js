async function test() {
    console.log('Testing native fetch...');
    const loginRes = await fetch('http://localhost:8080/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'registrar@plv.edu.ph', password: 'password' })
    });
    console.log('Login Status:', loginRes.status);
    const loginData = await loginRes.json();
    console.log('Login Result:', loginData);
}

test().catch(console.error);

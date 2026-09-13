const bcrypt = require('bcryptjs');
console.log(bcrypt.hashSync('password123', 10));

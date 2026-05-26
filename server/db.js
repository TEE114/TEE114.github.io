var mysql = require('mysql2/promise');

var pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'QWas114514+',
  database: 'chat_app',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4'
});

module.exports = pool;

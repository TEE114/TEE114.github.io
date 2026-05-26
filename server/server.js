var express = require('express');
var http = require('http');
var socketIO = require('socket.io');
var cors = require('cors');
var path = require('path');
var bcrypt = require('bcryptjs');
var pool = require('./db');

var authRoutes = require('./routes/auth');
var groupRoutes = require('./routes/groups');
var adminRoutes = require('./routes/admin');
var initChat = require('./socket/chat');

var app = express();
var server = http.createServer(app);
var io = new socketIO.Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// 将 io 注入 app，供路由使用
app.set('io', io);

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/admin', adminRoutes);

// 初始化 Socket.io
initChat(io);

// 初始化数据库：建表 + ROOT 账户 + 默认群聊
async function initDB() {
  try {
    // 建表（如果不存在）
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role ENUM('admin','user') DEFAULT 'user',
        is_online TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_groups (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id INT, user_id INT,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id),
        FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        group_id INT, sender_id INT, text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES chat_groups(id) ON DELETE CASCADE,
        FOREIGN KEY (sender_id) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
    console.log('[Init] 数据库表已就绪');

    // 创建 ROOT 账户
    var [rows] = await pool.query('SELECT id FROM users WHERE username = ?', ['ROOT']);
    if (rows.length === 0) {
      var hashed = await bcrypt.hash('114514', 10);
      await pool.query(
        'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
        ['ROOT', hashed, 'admin']
      );
      console.log('[Init] ROOT 账户已创建 (密码: 114514)');
    }

    // 创建默认群聊
    var [groups] = await pool.query('SELECT id FROM chat_groups LIMIT 1');
    if (groups.length === 0) {
      await pool.query("INSERT INTO chat_groups (name, created_by) VALUES ('综合大厅', 1)");
      console.log('[Init] 默认群聊"综合大厅"已创建');
    }
  } catch (err) {
    console.error('[Init] 数据库初始化失败:', err.message);
  }
}

var PORT = process.env.PORT || 3000;
server.listen(PORT, async function() {
  await initDB();
  console.log('聊天室服务已启动: http://localhost:' + PORT);
});

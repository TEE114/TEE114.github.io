var express = require('express');
var router = express.Router();
var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
var pool = require('../db');

var JWT_SECRET = 'chat_app_jwt_secret_2024';
var TOKEN_EXPIRES = '7d';

// 登录
router.post('/login', async function(req, res) {
  try {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';

    if (!username || !password) {
      return res.json({ code: 400, msg: '用户名和密码不能为空' });
    }

    var [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    if (rows.length === 0) {
      return res.json({ code: 401, msg: '账户不存在' });
    }

    var user = rows[0];
    var match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.json({ code: 401, msg: '密码错误' });
    }

    // 更新在线状态
    await pool.query('UPDATE users SET is_online = 1 WHERE id = ?', [user.id]);

    var token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES }
    );

    res.json({
      code: 200,
      msg: '登录成功',
      data: {
        token: token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          created_at: user.created_at
        }
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 注册
router.post('/register', async function(req, res) {
  try {
    var username = (req.body.username || '').trim();
    var password = req.body.password || '';

    if (!username || !password) {
      return res.json({ code: 400, msg: '用户名和密码不能为空' });
    }
    if (username.length < 2 || username.length > 20) {
      return res.json({ code: 400, msg: '用户名需要 2-20 个字符' });
    }
    if (password.length < 4) {
      return res.json({ code: 400, msg: '密码至少 4 个字符' });
    }

    var [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) {
      return res.json({ code: 409, msg: '用户名已被注册' });
    }

    var hashed = await bcrypt.hash(password, 10);
    var [result] = await pool.query(
      'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
      [username, hashed, 'user']
    );

    // 自动加入默认群聊
    var [groups] = await pool.query('SELECT id FROM chat_groups LIMIT 1');
    if (groups.length > 0) {
      await pool.query('INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)',
        [groups[0].id, result.insertId]
      );
    }

    var token = jwt.sign(
      { id: result.insertId, username: username, role: 'user' },
      JWT_SECRET,
      { expiresIn: TOKEN_EXPIRES }
    );

    res.json({
      code: 200,
      msg: '注册成功',
      data: {
        token: token,
        user: {
          id: result.insertId,
          username: username,
          role: 'user',
          created_at: new Date()
        }
      }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 验证 token / 获取当前用户
router.get('/me', authMiddleware, async function(req, res) {
  try {
    var [rows] = await pool.query(
      'SELECT id, username, role, is_online, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.json({ code: 404, msg: '用户不存在' });
    }
    res.json({ code: 200, data: rows[0] });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// JWT 中间件
function authMiddleware(req, res, next) {
  var authHeader = req.headers.authorization || '';
  var token = authHeader.replace('Bearer ', '');

  if (!token) {
    return res.json({ code: 401, msg: '未登录' });
  }

  try {
    var decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.json({ code: 401, msg: '登录已过期，请重新登录' });
  }
}

// 导出中间件供其他路由使用
router.authMiddleware = authMiddleware;
router.JWT_SECRET = JWT_SECRET;

module.exports = router;

var express = require('express');
var router = express.Router();
var pool = require('../db');
var auth = require('./auth');

// 中间件：仅 ROOT
function rootOnly(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.json({ code: 403, msg: '仅 ROOT 账户可执行此操作' });
  }
  next();
}

// 获取所有用户（含密码明文 — ROOT 专有）
router.get('/users', auth.authMiddleware, rootOnly, async function(req, res) {
  try {
    var [users] = await pool.query(
      `SELECT id, username, password, role, is_online, created_at
       FROM users ORDER BY id`
    );
    res.json({ code: 200, data: users });
  } catch (err) {
    console.error('Admin users error:', err);
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 删除用户
router.delete('/users/:id', auth.authMiddleware, rootOnly, async function(req, res) {
  try {
    var userId = parseInt(req.params.id);
    if (userId === req.user.id) {
      return res.json({ code: 400, msg: '不能删除自己' });
    }
    await pool.query('DELETE FROM users WHERE id = ?', [userId]);
    var io = req.app.get('io');
    if (io) io.emit('user_kicked', userId);
    res.json({ code: 200, msg: '用户已删除' });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 修改用户角色
router.put('/users/:id/role', auth.authMiddleware, rootOnly, async function(req, res) {
  try {
    var role = req.body.role;
    if (role !== 'admin' && role !== 'user') {
      return res.json({ code: 400, msg: '角色值无效' });
    }
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ code: 200, msg: '角色已更新' });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 重置用户密码
router.put('/users/:id/password', auth.authMiddleware, rootOnly, async function(req, res) {
  try {
    var newPassword = (req.body.password || '').trim();
    if (!newPassword || newPassword.length < 4) {
      return res.json({ code: 400, msg: '密码至少 4 个字符' });
    }
    var bcrypt = require('bcryptjs');
    var hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = ? WHERE id = ?', [hashed, req.params.id]);
    res.json({ code: 200, msg: '密码已重置' });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

module.exports = router;

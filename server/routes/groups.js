var express = require('express');
var router = express.Router();
var pool = require('../db');
var auth = require('./auth');

// 获取当前用户的所有群聊
router.get('/', auth.authMiddleware, async function(req, res) {
  try {
    var [groups] = await pool.query(
      `SELECT g.id, g.name, g.created_by, g.created_at,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
       FROM chat_groups g
       JOIN group_members gm ON g.id = gm.group_id
       WHERE gm.user_id = ?
       ORDER BY g.id`,
      [req.user.id]
    );

    // 获取每个群的最后一条消息
    for (var i = 0; i < groups.length; i++) {
      var [msgs] = await pool.query(
        `SELECT m.text, m.created_at, u.username
         FROM messages m JOIN users u ON m.sender_id = u.id
         WHERE m.group_id = ? ORDER BY m.id DESC LIMIT 1`,
        [groups[i].id]
      );
      groups[i].last_msg = msgs.length > 0 ? msgs[0] : null;
    }

    res.json({ code: 200, data: groups });
  } catch (err) {
    console.error('Get groups error:', err);
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// ROOT 创建群聊
router.post('/', auth.authMiddleware, async function(req, res) {
  try {
    if (req.user.role !== 'admin') {
      return res.json({ code: 403, msg: '仅 ROOT 账户可以创建群聊' });
    }
    var name = (req.body.name || '').trim();
    if (!name) {
      return res.json({ code: 400, msg: '群聊名称不能为空' });
    }
    var [result] = await pool.query(
      'INSERT INTO chat_groups (name, created_by) VALUES (?, ?)',
      [name, req.user.id]
    );
    // 创建者自动加入
    await pool.query('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)',
      [result.insertId, req.user.id]
    );

    // 通知所有在线客户端刷新群列表
    var io = req.app.get('io');
    if (io) io.emit('group_update');

    res.json({ code: 200, msg: '创建成功', data: { id: result.insertId, name: name } });
  } catch (err) {
    console.error('Create group error:', err);
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// ROOT 删除群聊
router.delete('/:id', auth.authMiddleware, async function(req, res) {
  try {
    if (req.user.role !== 'admin') {
      return res.json({ code: 403, msg: '仅 ROOT 账户可以删除群聊' });
    }
    await pool.query('DELETE FROM chat_groups WHERE id = ?', [req.params.id]);
    var io = req.app.get('io');
    if (io) io.emit('group_update');
    res.json({ code: 200, msg: '删除成功' });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 加入群聊
router.post('/:id/join', auth.authMiddleware, async function(req, res) {
  try {
    await pool.query('INSERT IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)',
      [req.params.id, req.user.id]
    );
    var io = req.app.get('io');
    if (io) io.emit('group_update');
    res.json({ code: 200, msg: '加入成功' });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 退出群聊
router.post('/:id/leave', auth.authMiddleware, async function(req, res) {
  try {
    await pool.query('DELETE FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    var io = req.app.get('io');
    if (io) io.emit('group_update');
    res.json({ code: 200, msg: '已退出群聊' });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 获取群聊历史消息
router.get('/:id/messages', auth.authMiddleware, async function(req, res) {
  try {
    // 验证是否为群成员
    var [member] = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (member.length === 0 && req.user.role !== 'admin') {
      return res.json({ code: 403, msg: '你不是该群成员' });
    }

    var limit = parseInt(req.query.limit) || 100;
    var offset = parseInt(req.query.offset) || 0;

    var [messages] = await pool.query(
      `SELECT m.id, m.text, m.created_at, m.sender_id, u.username, u.role
       FROM messages m JOIN users u ON m.sender_id = u.id
       WHERE m.group_id = ?
       ORDER BY m.id ASC
       LIMIT ? OFFSET ?`,
      [req.params.id, String(limit), String(offset)]
    );
    res.json({ code: 200, data: messages });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

// 获取群成员及在线状态
router.get('/:id/members', auth.authMiddleware, async function(req, res) {
  try {
    var [members] = await pool.query(
      `SELECT u.id, u.username, u.role, u.is_online
       FROM users u JOIN group_members gm ON u.id = gm.user_id
       WHERE gm.group_id = ?`,
      [req.params.id]
    );
    res.json({ code: 200, data: members });
  } catch (err) {
    res.json({ code: 500, msg: '服务器错误' });
  }
});

module.exports = router;

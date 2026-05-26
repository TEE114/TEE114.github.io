var pool = require('../db');
var jwt = require('jsonwebtoken');
var auth = require('../routes/auth');

// 存储 socket id → user 映射
var onlineUsers = {};  // userId → { socketId, username }

module.exports = function(io) {

  // 鉴权中间件
  io.use(async function(socket, next) {
    try {
      var token = socket.handshake.auth.token || '';
      if (!token) return next(new Error('未登录'));

      var decoded = jwt.verify(token, auth.JWT_SECRET);
      socket.userId = decoded.id;
      socket.username = decoded.username;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error('登录已过期'));
    }
  });

  io.on('connection', async function(socket) {
    var uid = socket.userId;
    var username = socket.username;

    console.log('[Socket] ' + username + ' 上线 (socket: ' + socket.id + ')');

    // 记录在线
    onlineUsers[uid] = { socketId: socket.id, username: username };
    await pool.query('UPDATE users SET is_online = 1 WHERE id = ?', [uid]);
    io.emit('user_online', { userId: uid, username: username, online: true });

    // 加入群聊
    socket.on('join_group', function(groupId) {
      socket.join('group_' + groupId);
      // 通知群内其他人
      socket.to('group_' + groupId).emit('user_joined_group', {
        userId: uid,
        username: username,
        groupId: groupId
      });
    });

    // 离开群聊
    socket.on('leave_group', function(groupId) {
      socket.leave('group_' + groupId);
    });

    // 发送消息
    socket.on('send_message', async function(data) {
      try {
        var groupId = data.groupId;
        var text = (data.text || '').trim();
        if (!text || !groupId) return;

        // 插入数据库
        var [result] = await pool.query(
          'INSERT INTO messages (group_id, sender_id, text) VALUES (?, ?, ?)',
          [groupId, uid, text]
        );

        var [rows] = await pool.query(
          `SELECT m.id, m.text, m.created_at, m.sender_id, u.username, u.role
           FROM messages m JOIN users u ON m.sender_id = u.id
           WHERE m.id = ?`,
          [result.insertId]
        );

        var msg = rows[0];
        // 广播给群内所有人（含发送者自己，以保持多标签页同步）
        io.to('group_' + groupId).emit('new_message', msg);
      } catch (err) {
        console.error('Send message error:', err);
      }
    });

    // 断开连接
    socket.on('disconnect', async function() {
      console.log('[Socket] ' + username + ' 离线');

      delete onlineUsers[uid];
      await pool.query('UPDATE users SET is_online = 0 WHERE id = ?', [uid]);
      io.emit('user_online', { userId: uid, username: username, online: false });

      // 通知各群
      socket.rooms.forEach(function(room) {
        if (room.startsWith('group_')) {
          socket.to(room).emit('user_left_group', {
            userId: uid,
            username: username
          });
        }
      });
    });
  });

  return {
    getOnlineUsers: function() { return onlineUsers; }
  };
};

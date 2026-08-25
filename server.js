/**
 * 小鸡餐厅智能客服 - 后端代理服务
 *
 * 功能：
 *   1. /api/chat            - 接收用户问题，转发给 Dify 并流式返回答案
 *   2. /api/conversations/:id - 删除指定会话（清空对话）
 *   3. /api/messages        - 获取指定会话的历史消息（可选）
 *
 * 使用方法：
 *   1. npm install express cors axios
 *   2. 把下面的 DIFY_API_URL 和 API_KEY 改成你自己的
 *   3. node server.js
 *   4. 浏览器打开 ui.html 即可对话
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

// ============== 配置区（改成你自己的） ==============

// Dify API 地址（自部署用 http://your-ip:port/v1，云端用 https://api.dify.ai/v1）
const DIFY_API_URL = process.env.DIFY_API_URL || 'https://api.dify.ai/v1';

// 你的 Dify 应用 API Key（在 Dify 应用的"访问 API"页面获取）
const API_KEY = process.env.API_KEY || 'app-yv7Y5CnBe9zPxmIzFoJIH5xW';

// 服务监听端口
const PORT = process.env.PORT || 3000;

// ====================================================

// 中间件
app.use(cors());                                    // 允许跨域
app.use(express.json());                            // 解析 JSON 请求体
app.use(express.urlencoded({ extended: true }));

// 简单的内存级用户标识（生产环境应改为真实鉴权）
function getUserId(req) {
  return req.ip || req.headers['x-forwarded-for'] || 'anonymous';
}

// ============== 接口 1：发送消息（流式） ==============
app.post('/api/chat', async (req, res) => {
  const { message, conversation_id } = req.body;

  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: '缺少 message 参数' });
  }

  console.log(`[CHAT] user=${getUserId(req)} conv=${conversation_id || '(new)'} msg="${message.slice(0, 50)}"`);

  try {
    const response = await axios.post(
      `${DIFY_API_URL}/chat-messages`,
      {
        inputs: {},
        query: message,
        response_mode: 'streaming',          // 流式输出
        conversation_id: conversation_id || '',
        user: getUserId(req)
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: 'stream',
        timeout: 60000                        // 60 秒超时
      }
    );

    // 把 Dify 的 SSE 流原样转发给前端
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Nginx 部署时禁用缓冲

    response.data.pipe(res);

    // 客户端断开连接时清理
    req.on('close', () => {
      response.data.destroy();
    });

  } catch (err) {
    console.error('[CHAT ERROR]', err.message);
    console.error('[REQUEST URL]', `${DIFY_API_URL}/chat-messages`);
    console.error('[API KEY 前12位]', API_KEY.slice(0, 12) + '...');
    if (err.response) {
      const status = err.response.status;
      // 读取错误流（流式响应的错误体需要异步读取）
      let errData = '';
      try {
        for await (const chunk of err.response.data) {
          errData += chunk.toString();
        }
      } catch (e) {
        errData = String(err.response.data);
      }
      console.error('[DIFY 返回状态码]', status);
      console.error('[DIFY 返回内容]', errData.slice(0, 500));
      res.status(status).json({
        error: `Dify API 错误 (${status})`,
        detail: errData,
        request_url: `${DIFY_API_URL}/chat-messages`
      });
    } else {
      res.status(500).json({ error: '服务暂时不可用', detail: err.message });
    }
  }
});

// ============== 接口 2：清空对话（删除会话） ==============
app.delete('/api/conversations/:conversation_id', async (req, res) => {
  const { conversation_id } = req.params;

  if (!conversation_id) {
    return res.status(400).json({ error: '缺少 conversation_id' });
  }

  console.log(`[DELETE] user=${getUserId(req)} conv=${conversation_id}`);

  try {
    await axios.delete(
      `${DIFY_API_URL}/conversations/${conversation_id}`,
      {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        data: { user: getUserId(req) }
      }
    );
    res.json({ status: 'ok', message: '会话已删除' });
  } catch (err) {
    console.error('[DELETE ERROR]', err.message);
    // 即使 Dify 删除失败，前端也会清空本地状态，所以返回 200
    res.status(200).json({ status: 'ok', message: '本地已清空（远端可能仍存在）' });
  }
});

// ============== 接口 3：获取会话历史消息（可选） ==============
app.get('/api/messages/:conversation_id', async (req, res) => {
  const { conversation_id } = req.params;
  const { limit = 20, cursor = '' } = req.query;

  try {
    const response = await axios.get(
      `${DIFY_API_URL}/messages`,
      {
        params: {
          conversation_id,
          user: getUserId(req),
          limit: parseInt(limit),
          first_id: cursor || undefined
        },
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('[MESSAGES ERROR]', err.message);
    res.status(500).json({ error: '获取历史消息失败', detail: err.message });
  }
});

// ============== 接口 4：获取会话列表（可选） ==============
app.get('/api/conversations', async (req, res) => {
  const { limit = 20, last_id = '' } = req.query;

  try {
    const response = await axios.get(
      `${DIFY_API_URL}/conversations`,
      {
        params: {
          user: getUserId(req),
          limit: parseInt(limit),
          last_id: last_id || undefined
        },
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('[CONVERSATIONS ERROR]', err.message);
    res.status(500).json({ error: '获取会话列表失败', detail: err.message });
  }
});

// ============== 接口 5：重命名会话（可选） ==============
app.post('/api/conversations/:conversation_id/name', async (req, res) => {
  const { conversation_id } = req.params;
  const { name } = req.body;

  if (!name) {
    return res.status(400).json({ error: '缺少 name 参数' });
  }

  try {
    const response = await axios.post(
      `${DIFY_API_URL}/conversations/${conversation_id}/name`,
      {
        name,
        user: getUserId(req)
      },
      {
        headers: { 'Authorization': `Bearer ${API_KEY}` }
      }
    );
    res.json(response.data);
  } catch (err) {
    console.error('[RENAME ERROR]', err.message);
    res.status(500).json({ error: '重命名失败', detail: err.message });
  }
});

// ============== 健康检查 ==============
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: '小鸡餐厅智能客服后端',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// ============== 启动服务 ==============
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  小鸡餐厅智能客服后端已启动');
  console.log('========================================');
  console.log(`  服务监听:  http://0.0.0.0:${PORT}`);
  console.log(`  健康检查:  /api/health`);
  console.log(`  Dify API: ${DIFY_API_URL}`);
  console.log('----------------------------------------');
  console.log('  Railway 会自动分配公网域名');
  console.log('  按 Ctrl+C 停止服务');
  console.log('========================================');
});

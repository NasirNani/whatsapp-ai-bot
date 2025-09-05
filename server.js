require('dotenv').config();
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const winston = require('winston');
const sqlite3 = require('sqlite3').verbose();
const cron = require('node-cron');

const app = express();
const port = process.env.PORT || 3000;

// Configuration
const config = {
  maxRetries: 3,
  rateLimit: {
    windowMs: 60000, // 1 minute
    maxRequests: 10 // 10 messages per minute per user
  },
  adminNumbers: process.env.ADMIN_NUMBERS ? process.env.ADMIN_NUMBERS.split(',') : [],
  logLevel: process.env.LOG_LEVEL || 'info'
};

// Initialize Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Initialize Logger
const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'whatsapp-ai-bot' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Initialize Database
const db = new sqlite3.Database('./bot.db', (err) => {
  if (err) {
    logger.error('Failed to connect to database:', err);
  } else {
    logger.info('Connected to SQLite database');
    initializeDatabase();
  }
});

// Database initialization
function initializeDatabase() {
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_id TEXT UNIQUE,
      name TEXT,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      message_count INTEGER DEFAULT 0,
      is_blocked BOOLEAN DEFAULT 0
    )`);

    // Messages table
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      message_text TEXT,
      message_type TEXT DEFAULT 'text',
      direction TEXT, -- 'inbound' or 'outbound'
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);

    // Analytics table
    db.run(`CREATE TABLE IF NOT EXISTS analytics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE,
      total_messages INTEGER DEFAULT 0,
      unique_users INTEGER DEFAULT 0,
      ai_responses INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0
    )`);

    // Rate limiting table
    db.run(`CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      whatsapp_id TEXT,
      window_start DATETIME,
      request_count INTEGER DEFAULT 0
    )`);

    logger.info('Database tables initialized');
  });
}

// CPU and Memory optimization
const os = require('os');
const v8 = require('v8');

// Force garbage collection if available
if (global.gc) {
  setInterval(() => {
    global.gc();
  }, 30000); // Run GC every 30 seconds
}

// Monitor CPU usage
setInterval(() => {
  const cpuUsage = process.cpuUsage();
  const memUsage = process.memoryUsage();
  logger.debug(`CPU Usage: ${JSON.stringify(cpuUsage)}, Memory: ${JSON.stringify(memUsage)}`);
}, 60000); // Log every minute

// Initialize WhatsApp Client with ultra-low CPU settings
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: 'new', // Use new headless mode for better performance
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=TranslateUI',
      '--disable-ipc-flooding-protection',
      '--disable-extensions',
      '--disable-plugins',
      '--disable-images',
      '--disable-javascript-harmony-shipping',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--hide-scrollbars',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-crash-upload',
      '--disable-logging',
      '--disable-login-animations',
      '--disable-notifications',
      '--disable-permissions-api',
      '--disable-session-crashed-bubble',
      '--disable-infobars',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor',
      '--disable-blink-features=AutomationControlled',
      '--disable-component-extensions-with-background-pages',
      '--disable-features=VizDisplayCompositor,VizHitTestSurfaceLayer',
      '--disable-ipc-flooding-protection',
      '--max_old_space_size=512', // Limit memory usage
      '--memory-pressure-off', // Reduce memory pressure handling
      '--disable-low-end-device-mode',
      '--disable-new-content-rendering-timeout',
      '--disable-background-media-download',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-client-side-phishing-detection',
      '--disable-background-networking',
      '--no-default-browser-check',
      '--no-pings',
      '--password-store=basic',
      '--use-mock-keychain'
    ],
    ignoreHTTPSErrors: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    // Additional performance settings
    timeout: 60000,
    protocolTimeout: 60000,
    defaultViewport: {
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
    }
  },
  webVersionCache: {
    type: 'remote',
    remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
  },
  // Additional client optimizations
  restartOnAuthFail: true,
  takeOverOnConflict: true,
  bypassCSP: true,
  // Extended QR code timeout for easier scanning
  qrTimeout: 600000, // 10 minutes (600,000 ms) instead of default 60 seconds
  qrMaxRetries: 50
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store conversation history (in production, use a database)
const conversationHistory = new Map();

// Function to generate AI response
async function generateAIResponse(message, senderId) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    // Get conversation history for this user
    const history = conversationHistory.get(senderId) || [];

    // Add current message to history
    history.push({ role: 'user', content: message });

    // Keep only last 10 messages to avoid token limits
    const recentHistory = history.slice(-10);

    // Create prompt with context
    const prompt = `You are a helpful AI assistant responding to WhatsApp messages.
Previous conversation:
${recentHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n')}

User's latest message: ${message}

Please provide a helpful, concise response:`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text();

    // Add AI response to history
    history.push({ role: 'assistant', content: aiResponse });
    conversationHistory.set(senderId, history);

    return aiResponse;
  } catch (error) {
    console.error('Error generating AI response:', error);
    return 'Sorry, I encountered an error. Please try again later.';
  }
}

// Enhanced message processing functions
async function checkRateLimit(whatsappId) {
  return new Promise((resolve, reject) => {
    const windowStart = new Date(Date.now() - config.rateLimit.windowMs);

    db.get(
      'SELECT request_count FROM rate_limits WHERE whatsapp_id = ? AND window_start > ?',
      [whatsappId, windowStart],
      (err, row) => {
        if (err) {
          logger.error('Rate limit check error:', err);
          return resolve(false);
        }

        if (!row) {
          // First request in window
          db.run(
            'INSERT INTO rate_limits (whatsapp_id, window_start, request_count) VALUES (?, ?, 1)',
            [whatsappId, new Date(), 1]
          );
          return resolve(true);
        }

        if (row.request_count >= config.rateLimit.maxRequests) {
          return resolve(false);
        }

        // Increment counter
        db.run(
          'UPDATE rate_limits SET request_count = request_count + 1 WHERE whatsapp_id = ? AND window_start > ?',
          [whatsappId, windowStart]
        );
        resolve(true);
      }
    );
  });
}

async function getOrCreateUser(whatsappId, name = null) {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE whatsapp_id = ?', [whatsappId], (err, user) => {
      if (err) {
        logger.error('User lookup error:', err);
        return resolve(null);
      }

      if (user) {
        // Update last seen
        db.run('UPDATE users SET last_seen = CURRENT_TIMESTAMP, message_count = message_count + 1 WHERE id = ?', [user.id]);
        return resolve(user);
      }

      // Create new user
      db.run(
        'INSERT INTO users (whatsapp_id, name) VALUES (?, ?)',
        [whatsappId, name],
        function(err) {
          if (err) {
            logger.error('User creation error:', err);
            return resolve(null);
          }
          resolve({ id: this.lastID, whatsapp_id: whatsappId, name, message_count: 1 });
        }
      );
    });
  });
}

async function saveMessage(userId, messageText, direction, messageType = 'text') {
  db.run(
    'INSERT INTO messages (user_id, message_text, direction, message_type) VALUES (?, ?, ?, ?)',
    [userId, messageText, direction, messageType]
  );
}

async function handleAdminCommand(message, senderId) {
  const command = message.body.toLowerCase().trim();

  if (!config.adminNumbers.includes(senderId)) {
    return '❌ You are not authorized to use admin commands.';
  }

  switch (command) {
    case '/stats':
      return new Promise((resolve) => {
        db.get('SELECT COUNT(*) as total_users FROM users', [], (err, users) => {
          db.get('SELECT COUNT(*) as total_messages FROM messages', [], (err, messages) => {
            db.get('SELECT COUNT(*) as today_messages FROM messages WHERE DATE(timestamp) = DATE("now")', [], (err, today) => {
              resolve(`📊 Bot Statistics:
👥 Total Users: ${users['COUNT(*)']}
💬 Total Messages: ${messages['COUNT(*)']}
📅 Today's Messages: ${today['COUNT(*)']}
⏰ Uptime: ${process.uptime().toFixed(2)} seconds`);
            });
          });
        });
      });

    case '/restart':
      setTimeout(() => {
        logger.info('Admin requested restart');
        process.exit(0);
      }, 1000);
      return '🔄 Restarting bot...';

    case '/help':
      return `🤖 Admin Commands:
/stats - Show bot statistics
/restart - Restart the bot
/help - Show this help message`;

    default:
      return '❓ Unknown command. Use /help for available commands.';
  }
}

// Store QR code for web display
let currentQR = null;

// WhatsApp client event handlers
client.on('qr', (qr) => {
  currentQR = qr;
  logger.info('QR Code generated for authentication');
  console.log('🔗 QR Code received. Scan with WhatsApp:');
  console.log('QR Data:', qr.substring(0, 50) + '...'); // Log first 50 chars for debugging
  qrcode.generate(qr, { small: true });
  console.log(`🌐 Or visit: https://whatsapp-ai-bot-6u59.onrender.com/qr`);
});

client.on('loading_screen', (percent, message) => {
  console.log('WhatsApp loading:', percent + '%', message);
});

client.on('authenticated', () => {
  console.log('✅ WhatsApp authenticated!');
});

client.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp authentication failed:', msg);
});

client.on('ready', () => {
  logger.info('WhatsApp client is ready and authenticated');
  console.log('✅ WhatsApp client is ready!');

  // Schedule daily analytics update
  cron.schedule('0 0 * * *', () => {
    updateAnalytics();
  });
});

client.on('message', async (message) => {
  try {
    const senderId = message.from;
    const messageText = message.body;
    const messageType = message.type;

    // Skip status broadcasts and group messages
    if (message.from === 'status@broadcast' || message.author) {
      return;
    }

    // Skip empty messages
    if (!messageText && !message.hasMedia) {
      return;
    }

    logger.info(`Message received from ${senderId}: ${messageText || '[Media]'}`);

    // Get or create user
    const user = await getOrCreateUser(senderId, message.author || 'Unknown');

    // Check rate limit
    const withinLimit = await checkRateLimit(senderId);
    if (!withinLimit) {
      await message.reply('⚠️ Too many messages! Please wait a minute before sending another message.');
      return;
    }

    // Handle admin commands
    if (messageText && messageText.startsWith('/')) {
      const response = await handleAdminCommand(message, senderId);
      await message.reply(response);
      await saveMessage(user.id, messageText, 'inbound', 'command');
      await saveMessage(user.id, response, 'outbound', 'command');
      return;
    }

    // Handle different message types
    let response = '';

    if (message.hasMedia) {
      // Handle media messages
      const media = await message.downloadMedia();
      response = `📎 I received a ${messageType} file. I'm primarily a text-based AI assistant, but I can help you describe or analyze content if you provide more details!`;
      await saveMessage(user.id, `[${messageType} file]`, 'inbound', messageType);
    } else {
      // Handle text messages
      await saveMessage(user.id, messageText, 'inbound', 'text');

      // Generate AI response
      response = await generateAIResponse(messageText, senderId);
      await saveMessage(user.id, response, 'outbound', 'text');
    }

    // Send response
    await message.reply(response);
    logger.info(`Response sent to ${senderId}`);

  } catch (error) {
    logger.error('Error processing WhatsApp message:', error);
    try {
      await message.reply('❌ Sorry, I encountered an error. Please try again later.');
    } catch (replyError) {
      logger.error('Failed to send error message:', replyError);
    }
  }
});

client.on('disconnected', (reason) => {
  logger.warn('WhatsApp client disconnected:', reason);
  console.log('⚠️ WhatsApp disconnected. Restarting...');

  // Auto-restart after 5 seconds
  setTimeout(() => {
    client.initialize();
  }, 5000);
});

// Analytics function
async function updateAnalytics() {
  const today = new Date().toISOString().split('T')[0];

  db.get('SELECT COUNT(*) as total_messages FROM messages WHERE DATE(timestamp) = ?', [today], (err, messages) => {
    db.get('SELECT COUNT(DISTINCT user_id) as unique_users FROM messages WHERE DATE(timestamp) = ?', [today], (err, users) => {
      db.get('SELECT COUNT(*) as ai_responses FROM messages WHERE direction = "outbound" AND DATE(timestamp) = ?', [today], (err, responses) => {
        db.run(
          'INSERT OR REPLACE INTO analytics (date, total_messages, unique_users, ai_responses) VALUES (?, ?, ?, ?)',
          [today, messages['COUNT(*)'], users['COUNT(DISTINCT user_id)'], responses['COUNT(*)']]
        );
        logger.info(`Analytics updated for ${today}`);
      });
    });
  });
}

// API endpoints
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage()
  });
});

app.get('/stats', (req, res) => {
  db.get('SELECT COUNT(*) as total_users FROM users', [], (err, users) => {
    db.get('SELECT COUNT(*) as total_messages FROM messages', [], (err, messages) => {
      db.get('SELECT COUNT(*) as today_messages FROM messages WHERE DATE(timestamp) = DATE("now")', [], (err, today) => {
        res.json({
          total_users: users['COUNT(*)'],
          total_messages: messages['COUNT(*)'],
          today_messages: today['COUNT(*)'],
          uptime_seconds: process.uptime()
        });
      });
    });
  });
});

app.get('/analytics', (req, res) => {
  db.all('SELECT * FROM analytics ORDER BY date DESC LIMIT 30', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: 'Database error' });
    } else {
      res.json(rows);
    }
  });
});

// QR Code web page
app.get('/qr', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WhatsApp AI Bot - QR Code</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            margin: 0;
            padding: 0;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .container {
            background: white;
            border-radius: 20px;
            padding: 40px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.1);
            text-align: center;
            max-width: 500px;
            width: 90%;
        }
        .logo {
            font-size: 3em;
            margin-bottom: 20px;
        }
        h1 {
            color: #333;
            margin-bottom: 10px;
            font-size: 2em;
        }
        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 1.1em;
        }
        .qr-container {
            margin: 30px 0;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 10px;
            border: 2px dashed #dee2e6;
        }
        .qr-placeholder {
            font-size: 4em;
            color: #6c757d;
            margin-bottom: 20px;
        }
        .status {
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            font-weight: bold;
        }
        .waiting {
            background: #fff3cd;
            color: #856404;
            border: 1px solid #ffeaa7;
        }
        .ready {
            background: #d1ecf1;
            color: #0c5460;
            border: 1px solid #bee5eb;
        }
        .instructions {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 10px;
            margin-top: 20px;
            text-align: left;
        }
        .instructions h3 {
            margin-top: 0;
            color: #333;
        }
        .instructions ol {
            padding-left: 20px;
        }
        .instructions li {
            margin: 10px 0;
            color: #555;
        }
        .refresh-btn {
            background: #007bff;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 16px;
            margin-top: 20px;
            transition: background 0.3s;
        }
        .refresh-btn:hover {
            background: #0056b3;
        }
        .footer {
            margin-top: 30px;
            color: #666;
            font-size: 0.9em;
        }
    </style>
    <script>
        let qrDisplayed = false;

        async function checkQRStatus() {
            try {
                const response = await fetch('/qr-status');
                const data = await response.json();

                if (data.qr && !qrDisplayed) {
                    displayQR(data.qr);
                    qrDisplayed = true;
                }

                if (data.ready) {
                    document.querySelector('.status').className = 'status ready';
                    document.querySelector('.status').textContent = '✅ WhatsApp Connected! Bot is ready to receive messages.';
                    document.querySelector('.qr-container').style.display = 'none';
                }
            } catch (error) {
                console.log('Checking QR status...');
            }
        }

        function displayQR(qrData) {
            document.querySelector('.qr-placeholder').textContent = '📱';
            document.querySelector('.qr-container').innerHTML = \`
                <div style="font-family: monospace; white-space: pre; background: white; padding: 20px; border-radius: 8px; border: 1px solid #dee2e6; font-size: 12px; line-height: 1.2; overflow-x: auto;">\${qrData}</div>
                <p style="margin-top: 15px; color: #28a745; font-weight: bold;">🔗 QR Code Ready! Scan with WhatsApp</p>
            \`;
        }

        function refreshPage() {
            window.location.reload();
        }

        // Check QR status every 2 seconds
        setInterval(checkQRStatus, 2000);
        checkQRStatus(); // Initial check
    </script>
</head>
<body>
    <div class="container">
        <div class="logo">🤖</div>
        <h1>WhatsApp AI Bot</h1>
        <p class="subtitle">Scan the QR code to connect your WhatsApp</p>

        <div class="status waiting">
            🔄 Waiting for QR code...
        </div>

        <div class="qr-container">
            <div class="qr-placeholder">⏳</div>
            <p>QR code will appear here automatically</p>
        </div>

        <div class="instructions">
            <h3>📱 How to Connect:</h3>
            <ol>
                <li>Open WhatsApp on your phone</li>
                <li>Go to <strong>Settings → Linked Devices</strong></li>
                <li>Tap <strong>"Link a Device"</strong></li>
                <li>Scan the QR code above</li>
                <li>Your bot is connected! 🎉</li>
            </ol>
        </div>

        <button class="refresh-btn" onclick="refreshPage()">🔄 Refresh Page</button>

        <div class="footer">
            <p>💡 <strong>Tip:</strong> The QR code is valid for 10 minutes</p>
            <p>🔒 Your WhatsApp messages are processed securely</p>
        </div>
    </div>
</body>
</html>`;
  res.send(html);
});

// QR status API
app.get('/qr-status', (req, res) => {
  res.json({
    qr: currentQR,
    ready: client.info ? true : false
  });
});

app.get('/cpu', (req, res) => {
  const cpuUsage = process.cpuUsage();
  const memUsage = process.memoryUsage();
  const osLoad = os.loadavg();

  res.json({
    process_cpu: cpuUsage,
    memory: memUsage,
    system_load: osLoad,
    uptime: process.uptime(),
    platform: process.platform,
    node_version: process.version
  });
});

// Initialize WhatsApp client
client.initialize();

// Start server
app.listen(port, () => {
  console.log(`WhatsApp AI Bot server running on port ${port}`);
  console.log('Scan the QR code with WhatsApp to authenticate!');
});

module.exports = app;

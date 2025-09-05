# WhatsApp AI Bot

A **100% FREE** advanced AI-powered WhatsApp chatbot with enterprise features using Google Gemini AI.

## 🚀 Features

- 🤖 **AI-Powered Responses** using Google Gemini (FREE)
- 💬 **WhatsApp Integration** (100% FREE)
- 📊 **Analytics Dashboard** with usage statistics
- 👥 **User Management** with persistent storage
- ⚡ **Rate Limiting** to prevent spam
- 🛠️ **Admin Commands** for bot management
- 📁 **Message History** stored in SQLite database
- 🔄 **Auto-Restart** on disconnection
- 📝 **Advanced Logging** with Winston
- 🎯 **Multi-Media Support** (images, documents, etc.)
- 📈 **Real-time Analytics** and reporting
- 🛡️ **Error Handling** and recovery

## Prerequisites

- Node.js (v16 or higher)
- Google Cloud account with Gemini API enabled (FREE)
- WhatsApp account (FREE)

## Setup Instructions

### 1. Clone and Install Dependencies

```bash
npm install
```

### 2. Google AI Setup

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key (FREE)
3. Copy the API key

### 3. Environment Configuration

Update the `.env` file with your credentials:

```env
# Google AI API Configuration
GOOGLE_API_KEY=your_google_api_key_here

# Server Configuration
PORT=3000
```

### 4. Run the Application

For development:
```bash
npm run dev
```

For production:
```bash
npm start
```

### 5. Authenticate WhatsApp

1. When you run the server, a QR code will be displayed in the terminal
2. Open WhatsApp on your phone
3. Go to Settings → Linked Devices → Link a Device
4. Scan the QR code displayed in the terminal
5. Your WhatsApp will be connected!

### 6. Test Your Bot

1. Send a message to your WhatsApp number from any other device
2. Watch the AI respond automatically!

## Admin Commands

Send these commands to your bot from admin WhatsApp numbers:

- `/stats` - Show bot statistics and analytics
- `/restart` - Restart the bot server
- `/help` - Show available admin commands

## API Endpoints

- `GET /health` - Health check with system info
- `GET /stats` - Bot statistics (JSON format)
- `GET /analytics` - Daily analytics data (last 30 days)
- `GET /cpu` - CPU and memory usage monitoring

## Database Schema

The bot uses SQLite with the following tables:

- **users**: User information and message counts
- **messages**: All message history with timestamps
- **analytics**: Daily usage statistics
- **rate_limits**: Rate limiting data

## How It Works

1. User sends a WhatsApp message to your number
2. WhatsApp Web forwards the message to your server
3. Server processes the message with Google Gemini AI
4. AI generates a contextual response
5. Server sends the response back via WhatsApp Web
6. User receives the AI response in WhatsApp

## Conversation Memory

The bot maintains conversation history for each user (last 10 messages) to provide context-aware responses.

## Deployment

### ❌ Netlify Limitations

**Netlify is NOT suitable for WhatsApp bots because:**
- WhatsApp bots require **continuous running** (24/7)
- Netlify functions have **10-second timeout** limit
- WhatsApp Web needs **persistent browser connection**
- No support for **WebSocket connections**
- No **persistent file storage** for session data

### ✅ Recommended Deployment Platforms

#### 🚂 **Railway** (Easiest for WhatsApp bots - FREE tier available)
```bash
# Quick deployment with provided script
./deploy.sh

# Or manual deployment:
# 1. Install Railway CLI
npm install -g @railway/cli

# 2. Login to Railway
railway login

# 3. Initialize project
railway init

# 4. Set environment variables
railway variables set GOOGLE_API_KEY=your_google_api_key_here

# 5. Deploy
railway up
```

#### 🐳 **Docker** (Most flexible)
```bash
# 1. Build and run with Docker Compose
docker-compose up -d

# 2. Or build manually
docker build -t whatsapp-bot .
docker run -p 3000:3000 -e GOOGLE_API_KEY=your_key whatsapp-bot
```

#### 🎨 **Render** (Free tier available)
```bash
# 1. Connect your GitHub repo to Render
# 2. Use the render.yaml configuration provided
# 3. Set environment variables in Render dashboard:
#    - GOOGLE_API_KEY
# 4. Deploy automatically on git push
```

#### 🟣 **Heroku** (Paid but reliable)
```bash
# 1. Install Heroku CLI
npm install -g heroku

# 2. Login and create app
heroku login
heroku create your-whatsapp-bot

# 3. Set environment variables
heroku config:set GOOGLE_API_KEY=your_google_api_key_here

# 4. Deploy
git push heroku main
```

#### ⚠️ **Vercel/Netlify** (NOT RECOMMENDED)
```bash
# These platforms are NOT suitable for WhatsApp bots
# They have execution time limits and don't support persistent connections
```

### Local Development
```bash
npm run dev
```

### Production Deployment Steps
1. Choose a platform from above
2. Set up environment variables
3. Deploy your code
4. Configure domain (if needed)
5. Test the bot

## Cost Breakdown

- ✅ **Google Gemini AI**: FREE (up to certain limits)
- ✅ **WhatsApp Web**: 100% FREE
- ✅ **Hosting**: Only your server costs (can be free on Heroku/AWS free tier)

## CPU Optimization & Monitoring

### 🚀 Performance Optimizations Applied

The bot includes extensive CPU optimizations:

- **Ultra-low CPU Puppeteer settings** with 40+ optimization flags
- **Memory limiting** (`--max_old_space_size=512`)
- **Automatic garbage collection** every 30 seconds
- **New headless mode** for better performance
- **Disabled unnecessary browser features** (images, extensions, etc.)

### 📊 Monitor CPU Usage

Check CPU usage via API endpoint:
```bash
curl http://localhost:3000/cpu
```

Or monitor logs in the `logs/` directory for CPU usage reports.

### 💡 If CPU Usage is Still High

**Alternative Solutions:**

1. **Use Telegram Instead** (much lower CPU):
   ```bash
   npm uninstall whatsapp-web.js qrcode-terminal
   npm install node-telegram-bot-api
   # Then modify server.js for Telegram
   ```

2. **Use a VPS with more resources** instead of local machine

3. **Run in Docker container** with resource limits:
   ```yaml
   # docker-compose.yml
   services:
     whatsapp-bot:
       build: .
       deploy:
         resources:
           limits:
             cpus: '0.50'
             memory: 512M
   ```

4. **Use PM2 process manager** with CPU limits:
   ```bash
   npm install -g pm2
   pm2 start server.js --name whatsapp-bot --max-memory-restart 500M
   ```

## Troubleshooting

### Common Issues

1. **High CPU Usage**
   - Check `http://localhost:3000/cpu` for usage stats
   - Consider using Telegram bot instead (much lower CPU)
   - Run on a machine with more resources
   - Use PM2 with CPU limits

2. **QR Code not appearing**
   - Make sure you have WhatsApp installed on your phone
   - Ensure your phone and computer are on the same network
   - Try restarting the server

3. **Bot not responding to messages**
   - Verify WhatsApp is properly authenticated
   - Ensure the server is running and connected to internet
   - Check that messages are being received (check server logs)

4. **AI not responding**
   - Verify Google API key is correct
   - Check API quota limits on Google AI Studio
   - Ensure Gemini API is enabled

5. **Connection issues**
   - Make sure your server has internet access
   - Check firewall settings if deploying to a server
   - Ensure WhatsApp Web session hasn't expired

## Security Notes

- Never commit `.env` file to version control
- Use environment variables for all sensitive data
- Consider implementing rate limiting for production
- Add authentication for webhook verification

## License

ISC

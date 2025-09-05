#!/bin/bash

echo "🚀 WhatsApp AI Bot Deployment Script"
echo "===================================="

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "📦 Installing Railway CLI..."
    npm install -g @railway/cli
fi

# Login to Railway
echo "🔐 Logging into Railway..."
railway login

# Initialize project
echo "📁 Initializing Railway project..."
railway init

# Set environment variables
echo "🔧 Setting up environment variables..."
read -p "Enter your Google AI API Key: " google_api_key
railway variables set GOOGLE_API_KEY=$google_api_key

# Deploy
echo "🚀 Deploying to Railway..."
railway up

echo "✅ Deployment complete!"
echo "🌐 Your bot will be available at the Railway URL shown above"
echo "📱 Don't forget to scan the QR code when the bot starts!"

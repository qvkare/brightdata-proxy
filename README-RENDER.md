# Deploying Bright Data Proxy to Render.com

This guide explains how to deploy the Bright Data Proxy service to Render.com.

## Steps

### 1. Create Render.com Account

Sign up for a free account at [Render.com](https://render.com).

### 2. Connect GitHub Repository

Connect your GitHub account and select the repository containing the Bright Data Proxy.

### 3. Create a New Web Service

1. Click "New" and select "Web Service"
2. Select the repository
3. Configure the service with these settings:
   - Name: `mirror-search-proxy` (or your preferred name)
   - Runtime: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: `Free` (for testing) or `Starter` (for production)

### 4. Configure Environment Variables

Add these environment variables:

- `BRIGHT_DATA_API_TOKEN`: Your Bright Data API token
- `BRIGHT_DATA_ZONE`: `serp_api1` (or your preferred zone)
- `PORT`: `3000` (Render automatically assigns this, but configure it anyway)

### 5. Deploy

Click "Create Web Service" and wait for the deployment to complete.

### Manual Deployment

If you prefer to deploy manually:

```bash
# Install Render CLI
npm install -g @render/cli

# Login to Render
render login

# Deploy
render deploy
```

## After Deployment

Once deployed, the following endpoints will be available:

- `https://your-app-name.onrender.com/health` - Health check endpoint
- `https://your-app-name.onrender.com/api/brightdata` - Main API endpoint

## Monitoring and Logs

Monitor your service's performance and view logs from the Render dashboard.

## Scaling

For production use, consider upgrading to a paid plan for better performance and reliability.

## Troubleshooting

If you encounter any issues:

1. Check the logs in the Render dashboard
2. Verify environment variables are set correctly
3. Test the health endpoint
4. Check for errors in the server code 
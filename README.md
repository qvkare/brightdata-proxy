# Bright Data SERP API Proxy

Bright Data SERP API proxy server for Mirror Search. This server is designed to bypass the authentication limitations of the WASM runtime.

## Features

- Proxies requests to Bright Data SERP API
- Handles authentication
- Parses HTML responses from Google
- CORS enabled for Bless Network and other origins
- Secure headers using Helmet
- Health check endpoint
- Error handling and validation

## Setup

### Prerequisites

- Node.js 16+
- npm or yarn
- Bright Data SERP API token

### Installation

1. Clone the repository:

```bash
git clone https://github.com/yourusername/brightdata-proxy.git
cd brightdata-proxy
```

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

## Configuration

Create a `.env` file with the following variables:

```
BRIGHT_DATA_API_TOKEN=your_api_token
BRIGHT_DATA_ZONE=serp_api1
PORT=3001
```

## API Endpoints

### `GET /health`

Health check endpoint to verify the service is running.

#### Response

```json
{
  "status": "healthy",
  "service": "Bright Data Proxy",
  "version": "1.0.0",
  "timestamp": "2023-05-15T12:34:56.789Z"
}
```

### `POST /api/brightdata`

Proxies requests to Bright Data SERP API and returns Google search results.

#### Request

```json
{
  "query": "search query",
  "num": 10,
  "hl": "en",
  "gl": "us"
}
```

#### Response

```json
{
  "success": true,
  "query": "search query",
  "results": [
    {
      "title": "Result title",
      "url": "https://example.com",
      "snippet": "Result description...",
      "source": "Bright Data SERP"
    }
  ],
  "totalResults": 10,
  "source": "Bright Data SERP",
  "timestamp": "2023-05-15T12:34:56.789Z"
}
```

## Deployment

This server can be deployed to Render.com, Vercel, or any Node.js hosting service.

### Render.com Deployment

1. Push the repository to GitHub
2. Connect to Render.com
3. Create a new Web Service with the Node.js environment
4. Set the environment variables for API token and zone
5. Deploy

## Integration with Mirror Search

Used for the search engine integration of Mirror Search running on Bless Network. See `mirror-search/DEPLOYMENT.md` for more details.

## Notes

- This proxy server is only a solution for the WASM runtime
- The Bright Data API token must be set as an environment variable
- CORS is configured for Bless Network origins 
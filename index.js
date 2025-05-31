import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

// ---- START NEW TOP-LEVEL MIDDLEWARE ----
app.use((req, res, next) => {
  console.log(`TOP_LEVEL_MW: Method: ${req.method}, Path: ${req.path}, Headers: ${JSON.stringify(req.headers)}`);
  next();
});
// ---- END NEW TOP-LEVEL MIDDLEWARE ----

const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: false
}));

// CORS configuration for Bless Network
app.use(cors({
  origin: [
    'https://coffee-cockroach-rachelle-6byahvr4.bls.dev',
    'http://localhost:3000',
    'http://localhost:8080',
    /^https:\/\/.*\.bls\.dev$/,
    /^https:\/\/.*\.vercel\.app$/,
    /^https:\/\/.*\.onrender\.com$/
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true
}));

// Manually handle OPTIONS requests for all routes
app.options('*', cors()); // This will use the above cors configuration for OPTIONS pre-flight checks

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Bright Data configuration
const BRIGHT_DATA_CONFIG = {
  apiToken: process.env.BRIGHT_DATA_API_TOKEN || '',
  zone: process.env.BRIGHT_DATA_ZONE || 'serp_api1',
  apiUrl: 'https://api.brightdata.com/request'
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Bright Data Proxy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    brightDataConfig: {
      hasApiToken: !!BRIGHT_DATA_CONFIG.apiToken,
      zone: BRIGHT_DATA_CONFIG.zone,
      endpoint: BRIGHT_DATA_CONFIG.apiUrl
    }
  });
});

// Main proxy endpoint for Bright Data SERP API
app.post('/api/brightdata', async (req, res) => {
  // Log incoming request details immediately
  const incomingContentType = req.get('Content-Type');
  const bodyAsReceivedByExpress = JSON.stringify(req.body); // Capture body as parsed by express.json()
  console.log(`PROXY_DEBUG: Path /api/brightdata. Content-Type: '${incomingContentType}'. Body from express.json(): ${bodyAsReceivedByExpress}`);

  try {
    // Destructure with defaults from req.body (which should be populated by express.json)
    const { query, num = 10, hl = 'en', gl = 'us' } = req.body || {};

    // For debugging: Capture the state of the extracted query
    const queryValueDebug = String(query); 
    const queryTypeDebug = typeof query;

    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      // This is the error path, log what was extracted from the (potentially empty) body
      console.error(`PROXY_ERROR: Invalid query parameter. Extracted Query: '${queryValueDebug}', Type: ${queryTypeDebug}. Original req.body by express.json: ${bodyAsReceivedByExpress}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid query parameter',
        message: 'Query must be a non-empty string.',
        debug_proxy_received_body: bodyAsReceivedByExpress, // Send back what express.json() provided
        debug_proxy_extracted_query_value: queryValueDebug,
        debug_proxy_extracted_query_type: queryTypeDebug
      });
    }
    
    // Validate configuration
    if (!BRIGHT_DATA_CONFIG.apiToken) {
      console.error('PROXY_ERROR: Bright Data API token not configured on server.');
      return res.status(500).json({
        success: false,
        error: 'Configuration error',
        message: 'Bright Data API token not configured'
      });
    }
    
    // Prepare Bright Data API request
    const brightDataRequest = {
      zone: BRIGHT_DATA_CONFIG.zone,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${num}&hl=${hl}&gl=${gl}`,
      format: 'raw'
    };
    
    // Call Bright Data API
    const brightDataResponse = await fetch(BRIGHT_DATA_CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${BRIGHT_DATA_CONFIG.apiToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mirror Search Proxy v1.0'
      },
      body: JSON.stringify(brightDataRequest)
    });

    if (!brightDataResponse.ok) {
      const errorText = await brightDataResponse.text();
      console.error(`PROXY_ERROR: Bright Data API call failed. Status: ${brightDataResponse.status}, Details: ${errorText.substring(0,200)}`);
      return res.status(502).json({
        success: false,
        error: 'Bright Data API error',
        status: brightDataResponse.status,
        statusText: brightDataResponse.statusText,
        details: errorText.substring(0, 200)
      });
    }

    const htmlContent = await brightDataResponse.text();

    // Parse Google HTML results
    const results = parseGoogleHTML(htmlContent, query);

    // Return structured response with error handling
    if (!results || results.length === 0) {
      return res.json({
        success: true,
        query: query,
        results: [
          {
            title: `No results for "${query}"`,
            url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
            snippet: "No search results were found. Try using different keywords or check your search terms.",
            source: "Bright Data SERP"
          }
        ],
        totalResults: 1,
        source: 'Bright Data SERP',
        timestamp: new Date().toISOString()
      });
    }

    return res.json({
      success: true,
      query: query,
      results: results,
      totalResults: results.length,
      source: 'Bright Data SERP',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('PROXY_ERROR: Unhandled error in /api/brightdata:', error);
    return res.status(500).json({
      success: false,
      error: 'Proxy server error',
      message: error.message || 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Google HTML parser function
function parseGoogleHTML(html, query) {
  if (!html || typeof html !== 'string') {
    return [];
  }
  
  const results = [];
  
  try {
    // Pattern for Google search results
    const titlePattern = /<h3[^>]*class="[^"]*LC20lb[^"]*"[^>]*>([^<]*)<\/h3>/g;
    const titles = [];
    let titleMatch;
    
    while ((titleMatch = titlePattern.exec(html)) !== null) {
      titles.push(titleMatch[1].replace(/&amp;/g, '&').trim());
    }
    
    // Pattern for links
    const linkPattern = /<a[^>]*href="([^"]*)"[^>]*>/g;
    const links = [];
    let linkMatch;
    
    while ((linkMatch = linkPattern.exec(html)) !== null) {
      const url = linkMatch[1];
      
      // Filter external links only
      if (url.startsWith('http') && 
          !url.includes('google.com/url') && 
          !url.includes('google.com/search') &&
          !url.includes('webcache.googleusercontent.com') &&
          !url.includes('accounts.google') &&
          !url.includes('policies.google')) {
        links.push(url);
      }
    }
    
    // Pattern for snippets
    const snippetPattern = /<div class="[^"]*VwiC3b[^"]*"[^>]*>(.*?)<\/div>/g;
    const snippets = [];
    let snippetMatch;
    
    while ((snippetMatch = snippetPattern.exec(html)) !== null) {
      // Clean up HTML tags and entities
      let snippet = snippetMatch[1]
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
        
      if (snippet && snippet.length > 5) {
        snippets.push(snippet);
      }
    }
    
    // Match titles with links and snippets
    const maxResults = Math.min(titles.length, links.length, 10);
    
    for (let i = 0; i < maxResults; i++) {
      if (titles[i] && links[i]) {
        results.push({
          title: titles[i],
          url: links[i],
          snippet: snippets[i] || `Result for "${query}" from Google search`,
          source: 'Bright Data SERP'
        });
      }
    }
    
    // Fallback if no results found
    if (results.length === 0) {
      results.push({
        title: `Search results for "${query}"`,
        url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        snippet: "No specific results extracted. Try using different keywords.",
        source: "Bright Data SERP"
      });
    }
    
  } catch (error) {
    // Provide a fallback result on parser error
    results.push({
      title: `Search results for "${query}"`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      snippet: "Error parsing results. Try again with different keywords.",
      source: "Bright Data SERP"
    });
  }
  
  return results;
}

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    availableEndpoints: [
      'GET /health',
      'POST /api/brightdata'
    ]
  });
});

// Error handler
app.use((error, req, res, next) => {
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message || 'Unknown error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Bright Data Proxy Server running on port ${PORT}`);
});

export default app; 

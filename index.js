import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import * as cheerio from 'cheerio';

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
    const results = parseGoogleHTMLWithCheerio(htmlContent, query);

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

// ---- START NEW GET ROUTE FOR TEMPORARY WORKAROUND ----
app.get('/api/brightdataget', async (req, res) => {
  const incomingHeaders = JSON.stringify(req.headers);
  // Using a slightly different log prefix to distinguish from TOP_LEVEL_MW for POST
  console.log(`GET_ROUTE_ENTRY: Path /api/brightdataget. Headers: ${incomingHeaders}`);

  const { query, num = '10', hl = 'en', gl = 'us' } = req.query; // num, hl, gl can also be query params
  const queryParamsForDebug = JSON.stringify(req.query);
  console.log(`PROXY_DEBUG_GET: Path /api/brightdataget. Extracted Query from URL: '${query}'. All query params: ${queryParamsForDebug}`);

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    console.error(`PROXY_ERROR_GET: Invalid query parameter. Extracted Query: '${query}', Type: ${typeof query}.`);
    return res.status(400).json({
      success: false,
      error: 'Invalid query parameter',
      message: 'Query must be a non-empty string (from GET).',
      debug_proxy_received_query_params: queryParamsForDebug,
    });
  }

  try {
    if (!BRIGHT_DATA_CONFIG.apiToken) {
      console.error('PROXY_ERROR_GET: Bright Data API token not configured on server.');
      return res.status(500).json({
        success: false,
        error: 'Configuration error',
        message: 'Bright Data API token not configured'
      });
    }
    
    const brightDataRequest = {
      zone: BRIGHT_DATA_CONFIG.zone,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}&num=${encodeURIComponent(num)}&hl=${encodeURIComponent(hl)}&gl=${encodeURIComponent(gl)}`,
      format: 'raw'
    };
    
    console.log(`PROXY_INTERNAL_POST_TO_BRIGHTDATA_GET_ROUTE: Request to BrightData: ${JSON.stringify(brightDataRequest)}`);

    const brightDataResponse = await fetch(BRIGHT_DATA_CONFIG.apiUrl, {
      method: 'POST', // This remains POST to Bright Data
      headers: {
        'Authorization': `Bearer ${BRIGHT_DATA_CONFIG.apiToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mirror Search Proxy v1.0 (via GET->POST)'
      },
      body: JSON.stringify(brightDataRequest)
    });

    if (!brightDataResponse.ok) {
      const errorText = await brightDataResponse.text();
      console.error(`PROXY_ERROR_GET: Bright Data API call failed. Status: ${brightDataResponse.status}, Details: ${errorText.substring(0,200)}`);
      return res.status(502).json({
        success: false,
        error: 'Bright Data API error (via GET->POST)',
        status: brightDataResponse.status,
        statusText: brightDataResponse.statusText,
        details: errorText.substring(0, 200)
      });
    }

    const htmlContent = await brightDataResponse.text();
    const results = parseGoogleHTMLWithCheerio(htmlContent, query);

    if (!results || results.length === 0) {
        return res.json({
            success: true,
            query: query,
            results: [
              {
                title: `No results for \\"${query}\\"`,
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                snippet: "No search results were found. Try using different keywords.",
                source: "Bright Data SERP (via GET->POST Proxy)"
              }
            ],
            totalResults: 1,
            source: 'Bright Data SERP (via GET->POST Proxy)',
            timestamp: new Date().toISOString()
        });
    }
    
    return res.json({
      success: true,
      query: query,
      results: results,
      totalResults: results.length,
      source: 'Bright Data SERP (via GET->POST Proxy)',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('PROXY_ERROR_GET: Unhandled error in /api/brightdataget:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      error: 'Proxy server error (via GET->POST)',
      message: error.message || 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});
// ---- END NEW GET ROUTE FOR TEMPORARY WORKAROUND ----

// Google HTML parser function with Cheerio
function parseGoogleHTMLWithCheerio(html, query) {
  if (!html || typeof html !== 'string') {
    console.warn('PROXY_PARSE_WARN: HTML content is missing or not a string.');
    return [];
  }
  
  const $ = cheerio.load(html);
  const results = [];
  const seenUrls = new Set(); // Yinelenen URL'leri engellemek için

  // Google'ın organik sonuçlarını içeren genel bir konteyner seçicisi.
  // Bu seçici, Google'ın A/B testleri ve güncellemeleri nedeniyle değişebilir.
  // Genellikle `#search .g`, `div.g`, `div.hlcw0c`, `div.kvH3mc`, `div.Ww4FFb` gibi sınıflar kullanılır.
  // Birden fazla potansiyel seçiciyi deneyebiliriz.
  const resultContainers = $('#search .g, div.g, div.hlcw0c, div.kvH3mc, div.Ww4FFb');
  
  // console.log(`PROXY_PARSE_INFO: Found ${resultContainers.length} potential result containers.`);

  resultContainers.each((i, el) => {
    if (results.length >= 10) return false; // En fazla 10 sonuç al

    const resultElement = $(el);

    // Reklamları ve bazı özel blokları atla
    // Bilinen reklam seçicileri veya içeren metinler
    if (resultElement.closest('[data-text-ad="1"]').length > 0 ||
        resultElement.find('span:contains("Ad"), span:contains("Sponsored")').length > 0 ||
        resultElement.find('div[role="region"][aria-label*="Ads"]').length > 0 ||
        resultElement.css('display') === 'none' || // Görünmeyen elementleri atla
        resultElement.find('[data-hveid][data-ved]').text().trim() === "" // Bazen boş konteynerler olabilir
    ) {
      // console.log('PROXY_PARSE_INFO: Skipping ad or irrelevant block.');
      return; // Bu bir reklam veya alakasız blok, atla
    }

    // "People also ask", "Related searches" gibi özel blokları atlama girişimleri
    if (resultElement.find('div[data-nosnippet="true"]').length > 0 ||
        resultElement.find('g-accordion-expander').length > 0 || // "People also ask" için yaygın
        resultElement.find('div[role="heading"][aria-level="2"]:contains("People also ask")').length > 0 ||
        resultElement.find('div[role="heading"][aria-level="2"]:contains("Related searches")').length > 0 ||
        resultElement.find('div[role="heading"][aria-level="2"]:contains("Top stories")').length > 0 ||
        resultElement.find('div[role="heading"][aria-level="2"]:contains("Videos")').length > 0 ) {
        // console.log('PROXY_PARSE_INFO: Skipping special block (PAA, Related, etc.).');
      return;
    }
    
    // Boş veya çok kısa blokları atla
    if (resultElement.text().trim().length < 50) { // Eşik değeri ayarlanabilir
        // console.log('PROXY_PARSE_INFO: Skipping short/empty block.');
        return;
    }

    const titleElement = resultElement.find('h3').first(); // Genellikle başlık h3 içindedir
    let title = titleElement.text().trim();
    
    // Bazen başlık h3'ün içindeki bir linkin metni olabilir
    if (!title && titleElement.find('a').length > 0) {
        title = titleElement.find('a').first().text().trim();
    }
    // Alternatif başlık seçicileri (Google yapısı değişirse)
    if (!title) {
        title = resultElement.find('a[h="ID=SERP"] h3').first().text().trim();
    }
     if (!title) {
        title = resultElement.find('div[role="heading"][aria-level="3"]').first().text().trim();
    }


    const linkElement = resultElement.find('a[href]').first(); // İlk anlamlı linki al
    let url = linkElement.attr('href');

    if (url && url.startsWith('/url?q=')) {
      const urlParams = new URLSearchParams(url.substring(url.indexOf('?')));
      url = urlParams.get('q') || url;
    }

    // URL'leri doğrula ve filtrele
    if (!url || !url.startsWith('http') || 
        url.includes('google.com/search') || 
        url.includes('google.com/imgres') ||
        url.includes('google.com/maps') ||
        url.includes('google.com/preferences') ||
        url.includes('accounts.google.com') ||
        url.includes('support.google.com') ||
        url.includes('policies.google.com') ||
        url.includes('webcache.googleusercontent.com') ||
        seenUrls.has(url) // Yinelenenleri atla
       ) {
      // console.log(`PROXY_PARSE_INFO: Skipping invalid or Google-internal URL: ${url}`);
      return;
    }

    // Snippet'i al (çeşitli potansiyel seçiciler)
    let snippet = resultElement.find('div.VwiC3b, div.s, div.st, div[data-sncf="1"], div.Uroaid').first().text().trim();
    // Bazen snippet birden fazla span içinde bölünebilir
    if (!snippet) {
        snippet = resultElement.find('div[style="-webkit-line-clamp:2"], div[style="-webkit-line-clamp:3"]').first().text().trim();
    }
     if (!snippet) {
        // En genel fallback, blok içindeki metin
        let potentialSnippet = "";
        resultElement.find('span').each((idx, spanEl) => {
            const spanText = $(spanEl).text().trim();
            if (spanText.length > 20) { // Çok kısa spanları atla
                potentialSnippet += spanText + " ";
            }
        });
        snippet = potentialSnippet.trim();
    }


    if (title && url && title.length > 5 && snippet.length > 10) { // Temel geçerlilik kontrolü
      results.push({
        title: title,
        url: url,
        snippet: snippet,
        source: 'Bright Data SERP (Cheerio)'
      });
      seenUrls.add(url); // Görülen URL'lere ekle
    } else {
      // console.log(`PROXY_PARSE_WARN: Missing title, URL, or snippet for a block. Title: "${title}", URL: "${url}"`);
    }
  });
  
  // console.log(`PROXY_PARSE_INFO: Extracted ${results.length} results using Cheerio.`);

  if (results.length === 0) {
    // console.warn(`PROXY_PARSE_WARN: No results extracted for query "${query}". Returning fallback.`);
    return [{
      title: `No organic results found for "${query}"`,
      url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      snippet: "Could not extract organic search results. Google\'s HTML structure might have changed or no relevant results were found.",
      source: "Bright Data SERP (Cheerio Fallback)"
    }];
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

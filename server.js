const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const marked = require('marked');
const fixedScraper = require('./scraper');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Configure marked for better image handling
marked.setOptions({
  breaks: true,
  gfm: true,
  sanitize: false
});

// In-memory storage
const chatHistories = new Map();
const activeStreams = new Map();

// SSE endpoint
app.get('/api/chat-stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const clientId = Date.now().toString();
  activeStreams.set(clientId, res);

  // Initialize chat history
  if (!chatHistories.has(clientId)) {
    chatHistories.set(clientId, []);
  }

  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);

  req.on('close', () => {
    activeStreams.delete(clientId);
    console.log(`Client ${clientId} disconnected`);
  });
});

// Stream chat endpoint
app.post('/api/chat-stream', async (req, res) => {
  const { message, clientId } = req.body;
  
  if (!message || !clientId) {
    return res.status(400).json({ error: 'Message and clientId are required' });
  }

  const clientRes = activeStreams.get(clientId);
  if (!clientRes) {
    return res.status(404).json({ error: 'Client stream not found' });
  }

  try {
    // Get chat history
    const chatHistory = chatHistories.get(clientId) || [];
    
    // Add user message to history
    chatHistory.push({
      type: 'user',
      message: message,
      timestamp: new Date().toISOString()
    });

    // Send events
    clientRes.write(`data: ${JSON.stringify({ type: 'typing_started' })}\n\n`);
    clientRes.write(`data: ${JSON.stringify({ type: 'message_received', message })}\n\n`);

    // Analyze and process request
    const analysis = analyzeUserMessage(message);
    
    if (analysis.isVehicleSearch) {
      await processVehicleSearch(message, analysis, clientRes, chatHistory);
    } else {
      await streamQuickResponse(message, clientRes, chatHistory);
    }

    clientRes.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);

  } catch (error) {
    console.error('Stream processing error:', error);
    clientRes.write(`data: ${JSON.stringify({ 
      type: 'error', 
      error: 'Processing failed. Please try again.' 
    })}\n\n`);
  }
});

// Process vehicle search
async function processVehicleSearch(userMessage, analysis, clientRes, chatHistory) {
  try {
    clientRes.write(`data: ${JSON.stringify({ 
      type: 'analysis_started',
      analysis: analysis
    })}\n\n`);

    clientRes.write(`data: ${JSON.stringify({ 
      type: 'search_started',
      analysis: analysis
    })}\n\n`);

    // Perform actual search with error handling
    let searchData;
    try {
      searchData = await fixedScraper.searchVehiclesWithDetails(analysis.searchParams);
    } catch (scrapeError) {
      console.error('Scraping failed:', scrapeError);
      clientRes.write(`data: ${JSON.stringify({ 
        type: 'search_error', 
        error: 'Search failed. Using sample data instead.' 
      })}\n\n`);
      
      // Use sample data as fallback
      searchData = getSampleData(analysis);
    }
    
    clientRes.write(`data: ${JSON.stringify({ 
      type: 'search_completed',
      resultsCount: searchData.results.length,
      detailedCount: searchData.detailedResults.length
    })}\n\n`);

    // Stream individual results
    for (let i = 0; i < searchData.detailedResults.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      clientRes.write(`data: ${JSON.stringify({ 
        type: 'vehicle_detail',
        vehicle: searchData.detailedResults[i],
        index: i,
        total: searchData.detailedResults.length
      })}\n\n`);
    }

    // Generate and stream recommendations
    await streamRecommendations(userMessage, searchData, clientRes, chatHistory);

  } catch (error) {
    console.error('Search processing error:', error);
    clientRes.write(`data: ${JSON.stringify({ 
      type: 'search_error', 
      error: 'Search processing failed' 
    })}\n\n`);
  }
}

// Stream recommendations
async function streamRecommendations(userMessage, searchData, clientRes, chatHistory) {
  try {
    clientRes.write(`data: ${JSON.stringify({ type: 'recommendation_started' })}\n\n`);

    const prompt = `
    User Request: "${userMessage}"
    
    Search Parameters:
    - Make: ${searchData.searchParams.make || 'Any'}
    - Model: ${searchData.searchParams.model || 'Any'} 
    - Type: ${searchData.searchParams.type || 'cars'}
    - Price Range: ${searchData.searchParams.priceMin ? `LKR ${searchData.searchParams.priceMin.toLocaleString()}` : 'Min'} - ${searchData.searchParams.priceMax ? `LKR ${searchData.searchParams.priceMax.toLocaleString()}` : 'Max'}
    
    Search Results: ${searchData.results.length} vehicles found
    
    Detailed Vehicle Information:
    ${searchData.detailedResults.map((vehicle, index) => `
    VEHICLE ${index + 1}:
    - Title: ${vehicle.title}
    - Price: ${vehicle.price}
    - Location: ${vehicle.location}
    - Year: ${vehicle.year || 'N/A'}
    - Mileage: ${vehicle.mileage}
    - Features: ${vehicle.features.join(', ') || 'Standard'}
    - Image: ${vehicle.image ? 'Available' : 'Not available'}
    - Link: ${vehicle.link}
    ${vehicle.isPromoted ? '    - 🚀 PROMOTED LISTING' : ''}
    `).join('\n')}

    Provide a COMPREHENSIVE recommendation in SINHALA that includes:

    1. INTRODUCTION: Greet and acknowledge the user's request
    2. SEARCH SUMMARY: Briefly summarize what was searched for
    3. TOP RECOMMENDATIONS: Analyze the results and recommend the best 2-3 options with SPECIFIC reasons
    4. COMPARISON: Compare the recommended vehicles (price, features, value)
    5. PRACTICAL ADVICE: Provide Sri Lankan context advice
    6. NEXT STEPS: Suggest concrete next actions

    Format in MARKDOWN with:
    - Use headers (##, ###)
    - Use bullet points and lists
    - Include vehicle images using: ![${searchData.detailedResults[0]?.title || 'Vehicle'}](${searchData.detailedResults[0]?.image || ''})
    - Use **bold** for important points
    - Include direct links to listings

    Be VERY specific about why each vehicle is recommended.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const fullText = response.text();

    // Stream recommendation in chunks
    const words = fullText.split(' ');
    let accumulatedText = '';

    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 30 + Math.random() * 50));
      
      accumulatedText += (i === 0 ? '' : ' ') + words[i];
      
      clientRes.write(`data: ${JSON.stringify({ 
        type: 'recommendation_chunk',
        text: accumulatedText,
        isComplete: i === words.length - 1
      })}\n\n`);
    }

    // Add to chat history
    const updatedHistory = chatHistories.get(clientRes.clientId) || [];
    updatedHistory.push({
      type: 'ai',
      message: userMessage,
      response: fullText,
      searchData: searchData,
      timestamp: new Date().toISOString()
    });
    chatHistories.set(clientRes.clientId, updatedHistory);

  } catch (error) {
    console.error('Recommendation streaming error:', error);
    clientRes.write(`data: ${JSON.stringify({ 
      type: 'recommendation_error', 
      error: 'Recommendation generation failed' 
    })}\n\n`);
  }
}

// Stream quick response
async function streamQuickResponse(userMessage, clientRes, chatHistory) {
  try {
    clientRes.write(`data: ${JSON.stringify({ type: 'response_started' })}\n\n`);

    const prompt = `
    User Message: "${userMessage}"
    
    Provide a helpful response in SINHALA about vehicle search in Sri Lanka.
    If this seems like a vehicle search request, ask for specific details (make, model, budget, location).
    Otherwise, provide general vehicle advice.
    
    Use friendly, conversational Sinhala with markdown formatting.
    `;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const fullText = response.text();
    
    const words = fullText.split(' ');
    let accumulatedText = '';

    for (let i = 0; i < words.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 40 + Math.random() * 60));
      
      accumulatedText += (i === 0 ? '' : ' ') + words[i];
      
      clientRes.write(`data: ${JSON.stringify({ 
        type: 'response_chunk',
        text: accumulatedText,
        isComplete: i === words.length - 1
      })}\n\n`);
    }

    // Add to chat history
    const updatedHistory = chatHistories.get(clientRes.clientId) || [];
    updatedHistory.push({
      type: 'ai',
      message: userMessage,
      response: fullText,
      timestamp: new Date().toISOString()
    });
    chatHistories.set(clientRes.clientId, updatedHistory);

  } catch (error) {
    console.error('Quick response error:', error);
    clientRes.write(`data: ${JSON.stringify({ 
      type: 'response_error', 
      error: 'Response generation failed' 
    })}\n\n`);
  }
}

// Simple message analysis
function analyzeUserMessage(message) {
  const messageLower = message.toLowerCase();
  
  // Vehicle makes
  const makes = {
    'suzuki': 'Suzuki',
    'toyota': 'Toyota', 
    'honda': 'Honda',
    'nissan': 'Nissan',
    'mitsubishi': 'Mitsubishi',
    'micro': 'Micro',
    'bmw': 'BMW',
    'mercedes': 'Mercedes-Benz'
  };

  // Vehicle types
  const types = {
    'car': 'cars',
    'van': 'vans', 
    'suv': 'suvs',
    'jeep': 'suvs',
    'motor': 'motorcycles',
    'bike': 'motorcycles',
    'three wheel': 'three-wheels',
    'lorry': 'lorries'
  };

  // Extract make
  let foundMake = null;
  for (const [key, value] of Object.entries(makes)) {
    if (messageLower.includes(key)) {
      foundMake = value;
      break;
    }
  }

  // Extract type
  let foundType = 'cars';
  for (const [key, value] of Object.entries(types)) {
    if (messageLower.includes(key)) {
      foundType = value;
      break;
    }
  }

  // Extract price range
  let priceMin = null, priceMax = null;
  const priceMatch = messageLower.match(/(\d+)\s*ත්\s*(\d+)\s*ලක්ෂ/);
  if (priceMatch) {
    priceMin = parseInt(priceMatch[1]) * 100000;
    priceMax = parseInt(priceMatch[2]) * 100000;
  } else {
    const singlePriceMatch = messageLower.match(/(\d+)\s*ලක්ෂ/);
    if (singlePriceMatch) {
      priceMin = parseInt(singlePriceMatch[1]) * 100000 * 0.8;
      priceMax = parseInt(singlePriceMatch[1]) * 100000 * 1.2;
    }
  }

  const isVehicleSearch = foundMake || foundType !== 'cars' || priceMin;

  return {
    isVehicleSearch: isVehicleSearch,
    searchParams: {
      make: foundMake,
      type: foundType,
      priceMin: priceMin,
      priceMax: priceMax,
      model: extractModel(message)
    }
  };
}

function extractModel(message) {
  const models = ['aqua', 'prius', 'premio', 'axio', 'vezel', 'wagon r', 'swift', 'alto', 'mirage'];
  const messageLower = message.toLowerCase();
  
  for (const model of models) {
    if (messageLower.includes(model)) {
      return model;
    }
  }
  return null;
}

// Sample data fallback
function getSampleData(analysis) {
  const sampleVehicles = [
    {
      id: 'sample_1',
      title: 'Suzuki Wagon R FX 2023',
      price: 'Rs. 7,500,000',
      location: 'Colombo',
      mileage: '15,000 km',
      date: '2024-01-15',
      link: 'https://riyasewana.com/buy/suzuki-wagon-r-2023',
      image: 'https://riyasewana.com/images/vehicle-placeholder.jpg',
      numericPrice: 7500000,
      year: 2023,
      isPromoted: true,
      features: ['Automatic', 'Petrol', 'Safety Package'],
      description: 'Brand new condition, full option package, maintained by agents'
    },
    {
      id: 'sample_2', 
      title: 'Toyota Aqua 2015',
      price: 'Rs. 5,200,000',
      location: 'Kandy',
      mileage: '85,000 km',
      date: '2024-01-14',
      link: 'https://riyasewana.com/buy/toyota-aqua-2015',
      image: 'https://riyasewana.com/images/vehicle-placeholder.jpg',
      numericPrice: 5200000,
      year: 2015,
      isPromoted: false,
      features: ['Hybrid', 'Automatic'],
      description: 'Well maintained hybrid vehicle, good fuel efficiency'
    }
  ];

  return {
    results: sampleVehicles,
    detailedResults: sampleVehicles,
    searchParams: analysis.searchParams,
    timestamp: new Date().toISOString(),
    totalCount: sampleVehicles.length
  };
}

// Get chat history
app.get('/api/chat-history/:clientId', (req, res) => {
  const { clientId } = req.params;
  const history = chatHistories.get(clientId) || [];
  res.json(history);
});

// Clear chat history
app.delete('/api/chat-history/:clientId', (req, res) => {
  const { clientId } = req.params;
  chatHistories.set(clientId, []);
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    activeConnections: activeStreams.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'fixed-chat.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Fixed Stream Chat Server running on http://localhost:${PORT}`);
  console.log(`📊 Features: Real data scraping, Images, Recommendations, Chat History`);
});
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
class RecommendationAI {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
  }

  async generateRecommendations(userMessage, searchData, chatHistory = []) {
    const { results, detailedResults, searchParams } = searchData;
    
    const prompt = `
    User Request: "${userMessage}"
    
    Search Parameters Used:
    - Make: ${searchParams.make || 'Any'}
    - Model: ${searchParams.model || 'Any'} 
    - Type: ${searchParams.type || 'cars'}
    - Price Range: ${searchParams.priceMin ? `LKR ${searchParams.priceMin.toLocaleString()}` : 'Min'} - ${searchParams.priceMax ? `LKR ${searchParams.priceMax.toLocaleString()}` : 'Max'}
    - Location: ${searchParams.city || 'Any'}
    
    Search Results Found: ${results.length} vehicles
    
    Detailed Vehicle Information:
    ${detailedResults.map((vehicle, index) => `
    VEHICLE ${index + 1}:
    - Title: ${vehicle.title}
    - Price: ${vehicle.price}
    - Location: ${vehicle.location}
    - Year: ${vehicle.year || 'N/A'}
    - Mileage: ${vehicle.mileage}
    - Features: ${vehicle.features.join(', ') || 'Standard'}
    - Description: ${vehicle.description || 'No detailed description available'}
    - Image: ${vehicle.image ? 'Available' : 'Not available'}
    - Link: ${vehicle.link}
    ${vehicle.isPromoted ? '    - 🚀 PROMOTED LISTING' : ''}
    `).join('\n')}

    Chat History Context:
    ${chatHistory.slice(-3).map(chat => `User: ${chat.message} | AI: ${chat.response.substring(0, 100)}...`).join('\n')}

    Provide a COMPREHENSIVE recommendation in SINHALA that includes:

    1. INTRODUCTION: Greet and acknowledge the user's specific request
    2. SEARCH SUMMARY: Briefly summarize what was searched for
    3. TOP RECOMMENDATIONS: Analyze the detailed results and recommend the best 2-3 options with SPECIFIC reasons
    4. COMPARISON: Compare the recommended vehicles (price, features, value)
    5. PRACTICAL ADVICE: Provide Sri Lankan context advice (financing, inspection, negotiation)
    6. NEXT STEPS: Suggest concrete next actions

    Format the response in MARKDOWN with:
    - Use headers (##, ###)
    - Use bullet points and lists
    - Include vehicle images using markdown format: ![alt text](image_url)
    - Use **bold** for important points
    - Include direct links to vehicle listings

    Be VERY specific about why each vehicle is recommended based on its actual features and price.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      
      return {
        recommendations: response.text(),
        recommendedVehicles: detailedResults.slice(0, 3),
        summary: {
          totalVehicles: results.length,
          priceRange: this.calculatePriceRange(results),
          averagePrice: this.calculateAveragePrice(results),
          bestValue: this.findBestValueVehicle(results)
        }
      };
    } catch (error) {
      console.error('Recommendation generation error:', error);
      throw error;
    }
  }

  calculatePriceRange(vehicles) {
    const prices = vehicles.filter(v => v.numericPrice).map(v => v.numericPrice);
    if (prices.length === 0) return null;
    
    return {
      min: Math.min(...prices),
      max: Math.max(...prices),
      average: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
    };
  }

  calculateAveragePrice(vehicles) {
    const prices = vehicles.filter(v => v.numericPrice).map(v => v.numericPrice);
    return prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  }

  findBestValueVehicle(vehicles) {
    const vehiclesWithPrice = vehicles.filter(v => v.numericPrice && v.year);
    if (vehiclesWithPrice.length === 0) return null;
    
    // Simple value calculation: newer and cheaper is better
    return vehiclesWithPrice.reduce((best, current) => {
      const bestScore = (best.year || 2000) / (best.numericPrice || 1000000);
      const currentScore = (current.year || 2000) / (current.numericPrice || 1000000);
      return currentScore > bestScore ? current : best;
    });
  }

  async generateQuickResponse(userMessage, chatHistory = []) {
    const prompt = `
    User Message: "${userMessage}"
    
    Recent Chat History:
    ${chatHistory.slice(-2).map(chat => `User: ${chat.message}`).join('\n')}
    
    Provide a helpful response in SINHALA about vehicle search in Sri Lanka.
    If this seems like a vehicle search request, ask for specific details (make, model, budget, location).
    Otherwise, provide general vehicle advice.
    
    Use friendly, conversational Sinhala with markdown formatting.
    `;

    const result = await this.model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }
}

module.exports = new RecommendationAI();
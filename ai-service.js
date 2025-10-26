const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
class VehicleAnalysisAI {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is required');
    }
    
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-pro' });
  }

  async analyzeVehicleDetails(vehicleData, userContext = null) {
    const {
      basicInfo,
      specifications,
      media,
      additionalInfo
    } = vehicleData;

    const prompt = `
    VEHICLE ANALYSIS REQUEST

    VEHICLE DETAILS:
    ================
    Title: ${basicInfo.title}
    Price: ${basicInfo.price}
    Location: ${additionalInfo.location}
    Posted Date: ${additionalInfo.postedDate}
    ${basicInfo.isPremium ? '🚀 PREMIUM ADVERTISEMENT' : ''}
    
    SPECIFICATIONS:
    ==============
    Make: ${specifications.make}
    Model: ${specifications.model}
    Year: ${specifications.year}
    Mileage: ${specifications.mileage}
    Transmission: ${specifications.transmission}
    Fuel Type: ${specifications.fuelType}
    Engine: ${specifications.engineCC}
    Options: ${specifications.options}
    Additional Details: ${specifications.details}

    CONTACT & VIEWS:
    ===============
    Contact: ${basicInfo.contact}
    Views: ${basicInfo.views}
    Images Available: ${media.allImages.length}

    USER CONTEXT:
    ============
    ${userContext ? userContext : 'No specific user context provided'}

    ANALYZE THIS VEHICLE AND PROVIDE:

    1. PRICE ANALYSIS:
       - Is the price reasonable for this vehicle?
       - Market comparison with similar vehicles
       - Price negotiation suggestions

    2. VEHICLE CONDITION ASSESSMENT:
       - Mileage evaluation
       - Year vs condition analysis
       - Feature assessment

    3. VALUE FOR MONEY:
       - Overall value proposition
       - Pros and cons
       - Long-term considerations

    4. RECOMMENDATIONS:
       - Should user consider this vehicle?
       - What to check before buying
       - Negotiation points
       - Alternative suggestions

    5. SRI LANKAN MARKET CONTEXT:
       - Local market trends
       - Maintenance costs
       - Resale value potential

    Respond in SINHALA with MARKDOWN formatting.
    Be detailed, practical, and provide specific advice.
    Include actual numbers and comparisons where possible.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      
      return {
        analysis: response.text(),
        summary: this.generateSummary(vehicleData),
        recommendations: this.extractRecommendations(response.text()),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Vehicle analysis error:', error);
      throw error;
    }
  }

  async compareVehicles(vehiclesData, userPreferences = {}) {
    const vehiclesInfo = vehiclesData.map((vehicle, index) => `
      VEHICLE ${index + 1}:
      - Title: ${vehicle.basicInfo.title}
      - Price: ${vehicle.basicInfo.price}
      - Year: ${vehicle.specifications.year}
      - Mileage: ${vehicle.specifications.mileage}
      - Transmission: ${vehicle.specifications.transmission}
      - Fuel: ${vehicle.specifications.fuelType}
      - Location: ${vehicle.additionalInfo.location}
      - Features: ${vehicle.specifications.options}
      - Details: ${vehicle.specifications.details}
    `).join('\n');

    const prompt = `
    VEHICLE COMPARISON REQUEST

    USER PREFERENCES:
    ================
    ${userPreferences.budget ? `Budget: ${userPreferences.budget}` : 'No budget specified'}
    ${userPreferences.priority ? `Priority: ${userPreferences.priority}` : 'No specific priority'}
    ${userPreferences.usage ? `Usage: ${userPreferences.usage}` : 'No usage specified'}

    VEHICLES TO COMPARE:
    ===================
    ${vehiclesInfo}

    PROVIDE A DETAILED COMPARISON:

    1. PRICE COMPARISON:
       - Value for money analysis
       - Price vs features
       - Budget alignment

    2. FEATURE COMPARISON:
       - Key differences
       - Missing/extra features
       - Practical benefits

    3. CONDITION ASSESSMENT:
       - Mileage comparison
       - Year vs condition
       - Maintenance history indicators

    4. RECOMMENDATION RANKING:
       - Rank vehicles from best to worst
       - Specific reasons for ranking
       - Best overall choice

    5. NEGOTIATION STRATEGY:
       - Price negotiation points for each
       - What to prioritize
       - Deal-breakers

    Respond in SINHALA with MARKDOWN formatting.
    Use tables or clear comparisons.
    Be objective and practical.
    `;

    try {
      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      
      return {
        comparison: response.text(),
        ranking: this.extractRanking(response.text()),
        bestChoice: this.identifyBestChoice(response.text(), vehiclesData),
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Vehicle comparison error:', error);
      throw error;
    }
  }

  generateSummary(vehicleData) {
    const { basicInfo, specifications, additionalInfo } = vehicleData;
    
    return {
      keyPoints: {
        price: basicInfo.price,
        year: specifications.year,
        mileage: specifications.mileage,
        transmission: specifications.transmission,
        fuelType: specifications.fuelType,
        location: additionalInfo.location,
        isPremium: basicInfo.isPremium
      },
      quickAssessment: this.quickAssessVehicle(vehicleData),
      riskFactors: this.identifyRiskFactors(vehicleData)
    };
  }

  quickAssessVehicle(vehicleData) {
    const { specifications, basicInfo } = vehicleData;
    const assessment = {
      score: 0,
      positives: [],
      concerns: []
    };

    // Year assessment
    const currentYear = new Date().getFullYear();
    const vehicleAge = currentYear - parseInt(specifications.year);
    
    if (vehicleAge <= 5) {
      assessment.score += 2;
      assessment.positives.push('නවතම ආකෘතිය');
    } else if (vehicleAge <= 10) {
      assessment.score += 1;
      assessment.positives.push('පිරිසිදු භාවිතය');
    } else {
      assessment.concerns.push('පැරණි ආකෘතිය');
    }

    // Mileage assessment
    const mileage = parseInt(specifications.mileage);
    if (mileage < 50000) {
      assessment.score += 2;
      assessment.positives.push('අඩු ගමන් දුර');
    } else if (mileage < 100000) {
      assessment.score += 1;
      assessment.positives.push('සාමාන්‍ය ගමන් දුර');
    } else {
      assessment.concerns.push('ඉහළ ගමන් දුර');
    }

    // Premium ad bonus
    if (basicInfo.isPremium) {
      assessment.score += 1;
      assessment.positives.push('විශ්වසනීය දැන්වීම');
    }

    return assessment;
  }

  identifyRiskFactors(vehicleData) {
    const { specifications, basicInfo } = vehicleData;
    const risks = [];

    // High mileage risk
    const mileage = parseInt(specifications.mileage);
    if (mileage > 150000) {
      risks.push('ඉහළ ගමන් දුර - යාන්ත්‍රික ගැටළු ඇති විය හැක');
    }

    // Old vehicle risk
    const currentYear = new Date().getFullYear();
    const vehicleAge = currentYear - parseInt(specifications.year);
    if (vehicleAge > 15) {
      risks.push('පැරණි රථය - කොටස් සොයාගැනීමට අපහසු විය හැක');
    }

    // Missing key information
    if (!specifications.mileage) {
      risks.push('ගමන් දුර තොරතුරු නොමැත');
    }
    if (!specifications.transmission) {
      risks.push('ට්‍රාන්ස්මිෂන් තොරතුරු නොමැත');
    }

    return risks;
  }

  extractRecommendations(analysisText) {
    // Simple keyword-based extraction (can be enhanced)
    const recommendations = [];
    
    if (analysisText.includes('නරක')) {
      recommendations.push('මෙම වාහනය නරක තේරීමක් විය හැක');
    }
    if (analysisText.includes('හොඳ') || analysisText.includes('ඉතා හොඳ')) {
      recommendations.push('හොඳ තේරීමක් ලෙස සලකනු ලැබේ');
    }
    if (analysisText.includes('සාමාන්‍ය')) {
      recommendations.push('සාමාන්‍ය තේරීමකි');
    }

    return recommendations.length > 0 ? recommendations : ['විස්තරාත්මක විශ්ලේෂණය අවශ්‍යයි'];
  }

  extractRanking(comparisonText) {
    // Extract ranking from comparison text
    const lines = comparisonText.split('\n');
    const ranking = [];
    
    lines.forEach(line => {
      if (line.includes('1.') || line.includes('පළමු')) {
        ranking.push({ position: 1, description: line });
      } else if (line.includes('2.') || line.includes('දෙවන')) {
        ranking.push({ position: 2, description: line });
      } else if (line.includes('3.') || line.includes('තෙවන')) {
        ranking.push({ position: 3, description: line });
      }
    });

    return ranking;
  }

  identifyBestChoice(comparisonText, vehiclesData) {
    const ranking = this.extractRanking(comparisonText);
    if (ranking.length > 0 && vehiclesData[0]) {
      return {
        vehicle: vehiclesData[0].basicInfo.title,
        reason: ranking[0].description,
        position: 1
      };
    }
    return null;
  }
}

module.exports = new VehicleAnalysisAI();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class FixedScraper {
  constructor() {
    this.baseURL = 'https://riyasewana.com';
    this.dataDir = path.join(__dirname, 'data');
  }

  async searchVehiclesWithDetails(searchParams) {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      const searchURL = this.buildSearchURL(searchParams);
      console.log('🔍 Searching:', searchURL);
      
      await page.goto(searchURL, { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      });

      // Wait for results
      await page.waitForSelector('.item, .results', { timeout: 15000 });

      // Extract features function as string to pass to evaluate
      const extractFeatures = `
        function extractFeatures(title) {
          const features = [];
          const titleLower = title.toLowerCase();
          
          if (titleLower.includes('hybrid')) features.push('Hybrid');
          if (titleLower.includes('auto') || titleLower.includes('automatic')) features.push('Automatic');
          if (titleLower.includes('manual')) features.push('Manual');
          if (titleLower.includes('diesel')) features.push('Diesel');
          if (titleLower.includes('petrol')) features.push('Petrol');
          if (titleLower.includes('turbo')) features.push('Turbo');
          if (titleLower.includes('safety')) features.push('Safety Package');
          if (titleLower.includes('led')) features.push('LED Lights');
          if (titleLower.includes('sunroof') || titleLower.includes('moonroof')) features.push('Sunroof');
          if (titleLower.includes('leather')) features.push('Leather Seats');
          if (titleLower.includes('navigation') || titleLower.includes('navi')) features.push('Navigation');
          
          return features;
        }
      `;

      const results = await page.evaluate((baseURL, extractFeaturesFn) => {
        // Define the extractFeatures function in the browser context
        eval(extractFeaturesFn);
        
        const items = document.querySelectorAll('.item');
        const searchResults = [];
        
        items.forEach((item, index) => {
          try {
            const titleElement = item.querySelector('h2.more a, h2 a');
            const imageElement = item.querySelector('.imgbox img, img');
            const locationElement = item.querySelector('.boxintxt:first-child');
            const priceElement = item.querySelector('.boxintxt.b');
            const mileageElement = item.querySelector('.boxintxt:nth-child(3)');
            const dateElement = item.querySelector('.boxintxt.s');
            const promoted = item.querySelector('img[alt*="Promoted"], img[src*="top-f"]');
            
            if (titleElement) {
              const title = titleElement.textContent.trim();
              let link = titleElement.href;
              let image = imageElement ? imageElement.src : null;
              
              // Fix URLs
              if (link && !link.startsWith('http')) {
                link = `${baseURL}${link.startsWith('/') ? '' : '/'}${link}`;
              }
              
              if (image && !image.startsWith('http')) {
                image = `${baseURL}${image.startsWith('/') ? '' : '/'}${image}`;
              }
              
              const location = locationElement ? locationElement.textContent.trim() : 'N/A';
              const price = priceElement ? priceElement.textContent.trim() : 'Price not listed';
              const mileage = mileageElement ? mileageElement.textContent.trim() : 'N/A';
              const date = dateElement ? dateElement.textContent.trim() : 'N/A';
              const isPromoted = promoted !== null;
              
              // Extract numeric price
              let numericPrice = null;
              const priceMatch = price.match(/Rs\.?\s*([\d,]+)/);
              if (priceMatch) {
                numericPrice = parseInt(priceMatch[1].replace(/,/g, ''));
              }
              
              // Extract vehicle details from title
              const yearMatch = title.match(/(\d{4})/);
              const year = yearMatch ? parseInt(yearMatch[1]) : null;
              
              searchResults.push({
                id: `vehicle_${Date.now()}_${index}`,
                title,
                link,
                image,
                location,
                price,
                numericPrice,
                mileage,
                date,
                year,
                isPromoted,
                features: extractFeatures(title)
              });
            }
          } catch (e) {
            console.log('Error parsing item:', e);
          }
        });
        
        return searchResults;
      }, this.baseURL, extractFeatures);

      console.log(`✅ Found ${results.length} vehicles`);
      
      // Get additional details for top results
      const detailedResults = await this.getDetailedVehicleInfo(results.slice(0, 3), browser);
      
      return {
        results: results,
        detailedResults: detailedResults,
        searchParams: searchParams,
        timestamp: new Date().toISOString(),
        totalCount: results.length
      };

    } catch (error) {
      console.error('Scraping error:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async getDetailedVehicleInfo(vehicles, browser) {
    const detailedVehicles = [];
    
    for (const vehicle of vehicles) {
      try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        
        console.log(`🔍 Getting details for: ${vehicle.title}`);
        await page.goto(vehicle.link, { 
          waitUntil: 'networkidle2', 
          timeout: 15000 
        });

        const details = await page.evaluate(() => {
          // Try to extract additional details from the vehicle page
          const descriptionElement = document.querySelector('.description, .details, .content, .ad-details');
          const description = descriptionElement ? descriptionElement.textContent.trim().substring(0, 500) : '';
          
          // Extract contact info
          const contactElement = document.querySelector('.contact, .phone, .tel, [class*="phone"], [class*="contact"]');
          const contact = contactElement ? contactElement.textContent.trim() : '';
          
          // Extract additional images
          const imageElements = document.querySelectorAll('img[src*="/images/"], .gallery img, .ad-images img');
          const additionalImages = Array.from(imageElements)
            .slice(0, 5)
            .map(img => img.src)
            .filter(src => src && !src.includes('logo'));
          
          return {
            description: description,
            contact: contact,
            additionalImages: additionalImages,
            hasDetails: description.length > 0
          };
        });

        await page.close();
        
        detailedVehicles.push({
          ...vehicle,
          ...details
        });
        
        // Add delay to avoid being blocked
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.log(`⚠️ Could not get details for ${vehicle.title}:`, error.message);
        detailedVehicles.push(vehicle);
      }
    }
    
    return detailedVehicles;
  }

  buildSearchURL(params) {
    const { make, model, type, priceMin, priceMax, city, condition } = params;
    
    // Clean parameters
    const cleanMake = (make || '').toLowerCase().trim();
    const cleanModel = (model || '').toLowerCase().trim();
    const cleanType = (type || 'cars').toLowerCase().trim();
    
    if (cleanMake && cleanModel) {
      return `${this.baseURL}/search/${cleanType}/${cleanMake}/${cleanModel}`;
    } else if (cleanMake) {
      return `${this.baseURL}/search/${cleanType}/${cleanMake}`;
    } else if (cleanType) {
      return `${this.baseURL}/search/${cleanType}`;
    } else {
      return `${this.baseURL}/search`;
    }
  }
}

module.exports = new FixedScraper();
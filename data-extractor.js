const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

class RiyasewanaDataExtractor {
  constructor() {
    this.baseURL = 'https://riyasewana.com';
    this.dataDir = path.join(__dirname, 'data');
    
    // Create data directory if it doesn't exist
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async extractAllData() {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
      
      console.log('Navigating to Riyasewana search page...');
      await page.goto(`${this.baseURL}/search`, { 
        waitUntil: 'networkidle2', 
        timeout: 30000 
      });

      // Wait for the search form to load
      await page.waitForSelector('form[name="search_from"]', { timeout: 10000 });

      // Extract all form data
      const formData = await page.evaluate(() => {
        const getSelectOptions = (selectName) => {
          const select = document.querySelector(`select[name="${selectName}"]`);
          if (!select) return null;
          
          const options = [];
          const optgroups = select.querySelectorAll('optgroup');
          
          if (optgroups.length > 0) {
            optgroups.forEach(optgroup => {
              const group = {
                label: optgroup.getAttribute('label'),
                options: []
              };
              
              Array.from(optgroup.querySelectorAll('option')).forEach(option => {
                group.options.push({
                  value: option.value,
                  text: option.textContent.trim(),
                  selected: option.selected
                });
              });
              
              options.push(group);
            });
          } else {
            Array.from(select.querySelectorAll('option')).forEach(option => {
              options.push({
                value: option.value,
                text: option.textContent.trim(),
                selected: option.selected
              });
            });
          }
          
          return options;
        };

        return {
          makes: getSelectOptions('make'),
          models: document.querySelector('input[name="model"]') ? {
            placeholder: document.querySelector('input[name="model"]').placeholder || 'Model',
            hasInput: true
          } : null,
          vehicleTypes: getSelectOptions('vtype'),
          conditions: getSelectOptions('vcat'),
          cities: getSelectOptions('city'),
          years: {
            min: getSelectOptions('year'),
            max: getSelectOptions('year_max')
          },
          price: {
            hasMinMax: true,
            minField: document.querySelector('input[name="pricemmin"]') ? {
              placeholder: document.querySelector('input[name="pricemmin"]').placeholder || 'Min Price'
            } : null,
            maxField: document.querySelector('input[name="pricemmax"]') ? {
              placeholder: document.querySelector('input[name="pricemmax"]').placeholder || 'Max Price'
            } : null
          },
          transmission: getSelectOptions('trans'),
          fuel: getSelectOptions('fuel')
        };
      });

      // Save individual JSON files
      await this.saveDataToFiles(formData);
      
      console.log('✅ All data extracted and saved successfully!');
      return formData;

    } catch (error) {
      console.error('Data extraction error:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  async saveDataToFiles(formData) {
    const files = {
      'vehicle-makes.json': formData.makes,
      'vehicle-types.json': formData.vehicleTypes,
      'conditions.json': formData.conditions,
      'cities.json': formData.cities,
      'years.json': formData.years,
      'transmission-types.json': formData.transmission,
      'fuel-types.json': formData.fuel,
      'search-fields.json': {
        models: formData.models,
        price: formData.price
      }
    };

    for (const [filename, data] of Object.entries(files)) {
      const filePath = path.join(this.dataDir, filename);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
      console.log(`📁 Saved: ${filename}`);
    }

    // Also save combined data
    const combinedPath = path.join(this.dataDir, 'combined-search-data.json');
    fs.writeFileSync(combinedPath, JSON.stringify(formData, null, 2), 'utf8');
    console.log('📁 Saved: combined-search-data.json');
  }

  // Load data from saved files
  loadData() {
    const data = {};
    const files = [
      'vehicle-makes.json',
      'vehicle-types.json', 
      'conditions.json',
      'cities.json',
      'years.json',
      'transmission-types.json',
      'fuel-types.json',
      'search-fields.json'
    ];

    for (const filename of files) {
      const filePath = path.join(this.dataDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          data[filename.replace('.json', '')] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (error) {
          console.error(`Error loading ${filename}:`, error);
        }
      }
    }

    return data;
  }

  // Get popular makes for quick access
  getPopularMakes() {
    const makesData = this.loadData().vehicleMakes;
    if (!makesData) return [];
    
    const popularGroup = makesData.find(group => group.label === 'Most Popular Makes');
    return popularGroup ? popularGroup.options : [];
  }

  // Search for vehicles using the extracted data
  async searchWithExtractedData(searchParams, browser) {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    // Build search URL with form data
    const searchURL = this.buildSearchURL(searchParams);
    console.log('Searching URL:', searchURL);
    
    await page.goto(searchURL, { 
      waitUntil: 'networkidle2', 
      timeout: 30000 
    });

    // Extract search results
    const results = await page.evaluate(() => {
      const items = document.querySelectorAll('.item');
      const searchResults = [];
      
      items.forEach(item => {
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
            const link = titleElement.href;
            const image = imageElement ? imageElement.src : null;
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
            
            searchResults.push({
              title,
              link: link.startsWith('http') ? link : `https://riyasewana.com${link}`,
              image: image ? (image.startsWith('http') ? image : `https://riyasewana.com${image}`) : null,
              location,
              price,
              numericPrice,
              mileage,
              date,
              isPromoted
            });
          }
        } catch (e) {
          console.log('Error parsing item:', e);
        }
      });
      
      return searchResults;
    });

    await page.close();
    return results.slice(0, 15);
  }

  buildSearchURL(params) {
    const { make, model, type, condition, city, yearMin, yearMax, priceMin, priceMax, transmission, fuel } = params;
    
    const urlParams = new URLSearchParams();
    
    if (make && make !== 'Any') urlParams.append('make', make);
    if (model) urlParams.append('model', model);
    if (type && type !== 'Any') urlParams.append('vtype', type);
    if (condition && condition !== 'Any') urlParams.append('vcat', condition);
    if (city && city !== 'Any') urlParams.append('city', city);
    if (yearMin) urlParams.append('year', yearMin);
    if (yearMax) urlParams.append('year_max', yearMax);
    if (priceMin) urlParams.append('pricemmin', priceMin);
    if (priceMax) urlParams.append('pricemmax', priceMax);
    if (transmission && transmission !== 'Any') urlParams.append('trans', transmission);
    if (fuel && fuel !== 'Any') urlParams.append('fuel', fuel);
    
    return `${this.baseURL}/search.php?${urlParams.toString()}`;
  }
}

module.exports = new RiyasewanaDataExtractor();
const puppeteer = require('puppeteer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');

// Create output folder if it doesn't exist
const outputFolder = path.join(__dirname, 'output');
if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
}

// Helper function to delay (replacement for deprecated waitForTimeout)
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeAmazon(url, maxPages = 1, headless = true) {
    console.log('Launching browser...');
    console.log(`Headless mode: ${headless ? 'ON' : 'OFF'}`);
    const browser = await puppeteer.launch({
        headless: headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        
        // Set a realistic viewport
        await page.setViewport({ width: 1920, height: 1080 });
        
        // Set user agent to avoid detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const allProducts = [];
        
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            console.log(`\nScraping page ${pageNum}...`);
            
            let currentUrl = url;
            if (pageNum === 1) {
                console.log(`Navigating to: ${currentUrl}`);
                await page.goto(currentUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 60000 
                });
            } else {
                // For page 2+, click the next page button
                try {
                    // Scroll to bottom to ensure pagination buttons are visible
                    await page.evaluate(() => {
                        window.scrollTo(0, document.body.scrollHeight);
                    });
                    await delay(1000);
                    
                    // Try multiple selectors for next button
                    const nextButtonSelectors = [
                        'a.s-pagination-next:not(.s-pagination-disabled)',
                        'a.s-pagination-next',
                        '[aria-label="Go to next page"]',
                        'a[aria-label*="next"]'
                    ];
                    
                    let nextButton = null;
                    for (const selector of nextButtonSelectors) {
                        nextButton = await page.$(selector);
                        if (nextButton) {
                            // Check if button is disabled
                            const isDisabled = await page.evaluate((el) => {
                                return el.classList.contains('s-pagination-disabled') || 
                                       el.getAttribute('aria-disabled') === 'true';
                            }, nextButton);
                            
                            if (!isDisabled) {
                                break;
                            } else {
                                nextButton = null;
                            }
                        }
                    }
                    
                    if (nextButton) {
                        console.log('Clicking next page button...');
                        // Scroll to the button
                        await nextButton.scrollIntoView();
                        await delay(500);
                        await nextButton.click();
                        await delay(2000);
                        // Wait for navigation
                        try {
                            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                        } catch (e) {
                            // Sometimes navigation doesn't trigger, just wait a bit
                            await delay(3000);
                        }
                        currentUrl = page.url();
                        console.log(`Navigated to: ${currentUrl}`);
                    } else {
                        console.log('No next page button found or next page is disabled. Stopping pagination.');
                        break;
                    }
                } catch (error) {
                    console.log('Error navigating to next page:', error.message);
                    break;
                }
            }
            
            // Wait for product results to load
            try {
                await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 30000 });
                console.log('Found products with s-search-result selector');
            } catch (error) {
                console.log('Products not found with s-search-result, trying alternative selector...');
                try {
                    await page.waitForSelector('[data-asin]:not([data-asin=""])', { timeout: 10000 });
                    console.log('Found products with data-asin selector');
                } catch (e) {
                    console.log('No products found, waiting additional time...');
                }
                await delay(3000);
            }
            
            // Scroll to load all products
            await autoScroll(page);
            await delay(3000); // Wait for any lazy-loaded content
            
            // Debug: Check how many products we can find
            const productCount = await page.evaluate(() => {
                return {
                    sSearchResult: document.querySelectorAll('[data-component-type="s-search-result"]').length,
                    dataAsin: document.querySelectorAll('[data-asin]:not([data-asin=""])').length
                };
            });
            console.log(`Product count check: s-search-result=${productCount.sSearchResult}, data-asin=${productCount.dataAsin}`);
            
            // Extract products from current page
            const products = await page.evaluate(() => {
                // Try multiple selectors to find products
                let productElements = document.querySelectorAll('[data-component-type="s-search-result"]');
                
                // If no results, try alternative selector
                if (productElements.length === 0) {
                    productElements = document.querySelectorAll('[data-asin]:not([data-asin=""])');
                }
                
                const results = [];
                let skippedNoAsin = 0;
                let skippedNoData = 0;
                let added = 0;
                
                productElements.forEach((element) => {
                    try {
                        // Skip if no ASIN (not a real product)
                        const asin = element.getAttribute('data-asin');
                        if (!asin || asin === '') {
                            skippedNoAsin++;
                            return;
                        }
                        
                        // Name - try multiple selectors
                        let name = 'N/A';
                        const nameSelectors = [
                            'h2.a-size-mini a span',
                            'h2 a span',
                            'h2 a',
                            'a.a-text-normal span',
                            '[data-cy="title-recipe"] span',
                            '.a-text-normal span',
                            'h2 span'
                        ];
                        
                        for (const selector of nameSelectors) {
                            const nameElement = element.querySelector(selector);
                            if (nameElement && nameElement.textContent.trim()) {
                                name = nameElement.textContent.trim();
                                break;
                            }
                        }
                        
                        // If still not found, try getting text from h2
                        if (name === 'N/A') {
                            const h2 = element.querySelector('h2');
                            if (h2) {
                                name = h2.textContent.trim();
                            }
                        }
                        
                        // URL - try multiple selectors
                        let productUrl = '';
                        const linkSelectors = [
                            'a.a-text-normal',
                            'h2 a',
                            'a[href*="/dp/"]',
                            'a[href*="/gp/product/"]',
                            'a.a-text-normal[href*="/dp/"]',
                            'h2 a[href*="/dp/"]'
                        ];
                        
                        for (const selector of linkSelectors) {
                            const linkElement = element.querySelector(selector);
                            if (linkElement) {
                                const href = linkElement.getAttribute('href');
                                if (href) {
                                    // Check if it's a product link
                                    if (href.includes('/dp/') || href.includes('/gp/product/') || href.includes('/product/')) {
                                        productUrl = href.startsWith('http') ? href : `https://www.amazon.in${href}`;
                                        // Remove query parameters from URL
                                        try {
                                            const urlObj = new URL(productUrl);
                                            productUrl = `${urlObj.origin}${urlObj.pathname}`;
                                        } catch (e) {
                                            // If URL parsing fails, use as is
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // If still no URL but we have ASIN, construct it
                        if (!productUrl && asin) {
                            productUrl = `https://www.amazon.in/dp/${asin}`;
                        }
                        
                        // Price - try multiple methods
                        let price = 'N/A';
                        
                        // Method 1: Try to get price from hidden offscreen element (most reliable)
                        const offscreenPrice = element.querySelector('.a-price .a-offscreen');
                        if (offscreenPrice && offscreenPrice.textContent.trim()) {
                            price = offscreenPrice.textContent.trim();
                        } else {
                            // Method 2: Try to construct price from parts
                            const priceWhole = element.querySelector('.a-price-whole');
                            if (priceWhole) {
                                const whole = priceWhole.textContent.trim().replace(/[^0-9]/g, '');
                                const priceSymbol = element.querySelector('.a-price-symbol');
                                const priceFraction = element.querySelector('.a-price-fraction');
                                const symbol = priceSymbol ? priceSymbol.textContent.trim() : '₹';
                                const fraction = priceFraction ? priceFraction.textContent.trim() : '00';
                                price = `${symbol}${whole}.${fraction}`;
                            } else {
                                // Method 3: Try other price selectors
                                const priceSelectors = [
                                    '[data-a-color="price"] .a-offscreen',
                                    '.a-price',
                                    '.a-price-range',
                                    'span.a-price'
                                ];
                                
                                for (const selector of priceSelectors) {
                                    const altPrice = element.querySelector(selector);
                                    if (altPrice && altPrice.textContent.trim()) {
                                        price = altPrice.textContent.trim();
                                        break;
                                    }
                                }
                            }
                        }
                        
                        // Delivery date
                        let deliveryDate = 'N/A';
                        const deliverySelectors = [
                            '[data-testid="delivery-date"]',
                            '.a-color-base',
                            '.a-text-bold',
                            'span.a-color-base',
                            '.s-align-children-center'
                        ];
                        
                        for (const selector of deliverySelectors) {
                            const deliveryElement = element.querySelector(selector);
                            if (deliveryElement) {
                                const deliveryText = deliveryElement.textContent.trim();
                                if (deliveryText && (deliveryText.includes('Delivery') || 
                                    deliveryText.includes('Get it') || 
                                    deliveryText.match(/\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i) ||
                                    deliveryText.match(/Get it\s+(by|on|before)/i))) {
                                    deliveryDate = deliveryText;
                                    break;
                                }
                            }
                        }
                        
                        // Check all text elements for delivery date pattern
                        if (deliveryDate === 'N/A') {
                            const allTextElements = element.querySelectorAll('span, div, a');
                            for (let el of allTextElements) {
                                const text = el.textContent.trim();
                                if (text && (text.match(/Get it\s+(by|on|before)\s+\w+,\s+\w+\s+\d+/i) || 
                                    text.match(/\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i) ||
                                    (text.includes('Delivery') && text.length < 100))) {
                                    deliveryDate = text;
                                    break;
                                }
                            }
                        }
                        
                        // Sponsored or not
                        const isSponsored = element.getAttribute('data-component-type') === 'sp-sponsored-result' ||
                                           element.closest('[data-component-type="sp-sponsored-result"]') !== null ||
                                           element.textContent.toLowerCase().includes('sponsored') ||
                                           element.querySelector('.s-label-popover-default') !== null;
                        
                        // Rating
                        let rating = 'N/A';
                        const ratingSelectors = [
                            '.a-icon-alt',
                            '[aria-label*="star"]',
                            '.a-icon-star',
                            'i.a-icon-star',
                            'span.a-icon-alt'
                        ];
                        
                        for (const selector of ratingSelectors) {
                            const ratingElement = element.querySelector(selector);
                            if (ratingElement) {
                                const ratingText = ratingElement.getAttribute('aria-label') || ratingElement.textContent || '';
                                const ratingMatch = ratingText.match(/(\d+\.?\d*)\s*(?:out of|stars?)/i);
                                if (ratingMatch) {
                                    rating = ratingMatch[1];
                                    break;
                                }
                            }
                        }
                        
                        // Number of ratings - look for the ratings link or text near rating
                        let numRatings = 'N/A';
                        const ratingsLink = element.querySelector('a[href*="#customerReviews"]');
                        if (ratingsLink) {
                            const ratingsText = ratingsLink.textContent.trim();
                            const ratingsMatch = ratingsText.match(/([\d,]+)/);
                            if (ratingsMatch) {
                                numRatings = ratingsMatch[1].replace(/,/g, '');
                            }
                        }
                        
                        // Try to find rating count in nearby elements
                        if (numRatings === 'N/A') {
                            const ratingContainer = element.querySelector('.a-row.a-size-small') ||
                                                   element.querySelector('.a-size-base');
                            if (ratingContainer) {
                                const allText = ratingContainer.textContent;
                                const ratingsMatch = allText.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
                                if (ratingsMatch) {
                                    numRatings = ratingsMatch[1].replace(/,/g, '');
                                }
                            }
                        }
                        
                        // Try to find in span elements near rating
                        if (numRatings === 'N/A') {
                            const spans = element.querySelectorAll('span.a-size-base, span.a-color-base');
                            for (const span of spans) {
                                const text = span.textContent.trim();
                                const match = text.match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
                                if (match) {
                                    numRatings = match[1].replace(/,/g, '');
                                    break;
                                }
                            }
                        }
                        
                        // Number of units sold
                        let unitsSold = 'N/A';
                        const unitsSoldElement = element.querySelector('[data-testid="units-sold"]');
                        if (unitsSoldElement) {
                            const unitsText = unitsSoldElement.textContent.trim();
                            const unitsMatch = unitsText.match(/([\d,]+)/);
                            if (unitsMatch) {
                                unitsSold = unitsMatch[1].replace(/,/g, '');
                            }
                        }
                        
                        // Check all span elements for units sold pattern
                        if (unitsSold === 'N/A') {
                            const spans = element.querySelectorAll('span');
                            for (const span of spans) {
                                const text = span.textContent.trim();
                                // Match patterns like "700+ bought in past month", "500 bought", "1K+ bought", etc.
                                const unitsPattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)\s*(?:in\s+(?:past|last)\s+(?:month|week|day))?/i;
                                const match = text.match(unitsPattern);
                                if (match) {
                                    unitsSold = match[1].replace(/,/g, '');
                                    break;
                                }
                                // Also try pattern without "in past month"
                                const simplePattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)/i;
                                const simpleMatch = text.match(simplePattern);
                                if (simpleMatch) {
                                    unitsSold = simpleMatch[1].replace(/,/g, '');
                                    break;
                                }
                            }
                        }
                        
                        // Check all text for units sold pattern as fallback
                        if (unitsSold === 'N/A') {
                            const allText = element.textContent;
                            // Match patterns like "700+ bought in past month", "500 bought", etc.
                            const unitsPattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)\s*(?:in\s+(?:past|last)\s+(?:month|week|day))?/i;
                            const match = allText.match(unitsPattern);
                            if (match) {
                                unitsSold = match[1].replace(/,/g, '');
                            } else {
                                // Try simpler pattern
                                const simplePattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)/i;
                                const simpleMatch = allText.match(simplePattern);
                                if (simpleMatch) {
                                    unitsSold = simpleMatch[1].replace(/,/g, '');
                                }
                            }
                        }
                        
                        // Always add if we have ASIN (we can construct URL from it)
                        if (asin) {
                            // If no URL found, construct from ASIN
                            if (!productUrl) {
                                productUrl = `https://www.amazon.in/dp/${asin}`;
                            }
                            
                            results.push({
                                name: name || 'N/A',
                                price,
                                url: productUrl,
                                deliveryDate,
                                sponsored: isSponsored ? 'Yes' : 'No',
                                rating,
                                numRatings,
                                unitsSold
                            });
                            added++;
                        } else {
                            skippedNoData++;
                        }
                    } catch (error) {
                        // Silently skip errors
                        skippedNoData++;
                    }
                });
                
                return {
                    products: results,
                    stats: {
                        total: productElements.length,
                        skippedNoAsin,
                        skippedNoData,
                        added
                    }
                };
            });
            
            // Log extraction stats
            const extractedProducts = products.products || products;
            if (products.stats) {
                console.log(`Extraction stats: Total=${products.stats.total}, Added=${products.stats.added}, Skipped (no ASIN)=${products.stats.skippedNoAsin}, Skipped (no data)=${products.stats.skippedNoData}`);
            }
            console.log(`Found ${extractedProducts.length} products on page ${pageNum}`);
            allProducts.push(...extractedProducts);
            
            
            // Wait a bit before going to next page
            if (pageNum < maxPages) {
                await delay(2000);
            }
        }
        
        console.log(`\nTotal products scraped: ${allProducts.length}`);
        
        // Save to CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const csvPath = path.join(outputFolder, `amazon_products_${timestamp}.csv`);
        
        const csvWriter = createCsvWriter({
            path: csvPath,
            header: [
                { id: 'name', title: 'Name' },
                { id: 'price', title: 'Price' },
                { id: 'url', title: 'URL' },
                { id: 'deliveryDate', title: 'Delivery Date' },
                { id: 'sponsored', title: 'Sponsored' },
                { id: 'rating', title: 'Rating' },
                { id: 'numRatings', title: 'Number of Ratings' },
                { id: 'unitsSold', title: 'Units Sold' }
            ]
        });
        
        await csvWriter.writeRecords(allProducts);
        console.log(`\nData saved to: ${csvPath}`);
        
        return allProducts;
        
    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await browser.close();
    }
}

// Helper function to auto-scroll the page
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;
                
                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

// Main execution
const url = process.argv[2];
let maxPages = 1;
let headless = true; // Default to headless for server use

// Parse command line arguments
for (let i = 3; i < process.argv.length; i++) {
    const arg = process.argv[i];
    
    // Check for headless flag
    if (arg === '--headless' || arg === '--no-headless') {
        headless = arg === '--headless';
    } else if (arg === '--headless=false' || arg === '--headless=off') {
        headless = false;
    } else if (arg === '--headless=true' || arg === '--headless=on') {
        headless = true;
    }
    // Check if it's a number (pages)
    else {
        const pagesArg = parseInt(arg, 10);
        if (!isNaN(pagesArg) && pagesArg > 0) {
            maxPages = pagesArg;
        } else if (i === 3) {
            // Only warn if it's the first non-URL argument
            console.warn(`Invalid argument "${arg}". Using default: 1 page`);
        }
    }
}

if (!url) {
    console.error('Please provide an Amazon URL as an argument.');
    console.log('Usage: node scraper.js <amazon-url> [number-of-pages] [--headless|--no-headless]');
    console.log('');
    console.log('Examples:');
    console.log('  node scraper.js "https://www.amazon.in/s?k=metal+furniture"');
    console.log('  node scraper.js "https://www.amazon.in/s?k=metal+furniture" 2');
    console.log('  node scraper.js "https://www.amazon.in/s?k=metal+furniture" 5 --headless');
    console.log('  node scraper.js "https://www.amazon.in/s?k=metal+furniture" 2 --no-headless');
    process.exit(1);
}

console.log(`Starting scraper for: ${url}`);
console.log(`Number of pages to scrape: ${maxPages}`);
scrapeAmazon(url, maxPages, headless)
    .then(() => {
        console.log('\nScraping completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nScraping failed:', error);
        process.exit(1);
    });


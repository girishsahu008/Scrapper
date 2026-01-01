const puppeteer = require('puppeteer');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const fs = require('fs');

// Create output folder if it doesn't exist
const outputFolder = path.join(__dirname, 'output');
if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
}

// Helper function to delay
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeAmazonWithProgress(url, maxPages = 1, progressCallback = null) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const allProducts = [];
        
        const updateProgress = (pageCompleted, productsCount, isComplete = false) => {
            if (progressCallback) {
                // Simple progress calculation: based on pages completed
                let progress;
                if (isComplete) {
                    progress = 100;
                } else {
                    // Each page contributes (90/maxPages)% to total progress
                    // Page 1 done = 90/maxPages%, Page 2 done = 2*90/maxPages%, etc.
                    progress = Math.round((pageCompleted / maxPages) * 90);
                    // Cap at 90% until CSV is written
                    if (progress >= 90) progress = 90;
                    if (progress < 0) progress = 0;
                }
                
                progressCallback({
                    status: isComplete ? 'completed' : 'scraping',
                    progress,
                    currentPage: pageCompleted,
                    totalPages: maxPages,
                    productsScraped: productsCount
                });
            }
        };
        
        // Initial progress
        updateProgress(0, 0, false);
        
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            let currentUrl = url;
            if (pageNum === 1) {
                await page.goto(currentUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 60000 
                });
            } else {
                try {
                    await page.evaluate(() => {
                        window.scrollTo(0, document.body.scrollHeight);
                    });
                    await delay(1000);
                    
                    const nextButtonSelectors = [
                        'a.s-pagination-next:not(.s-pagination-disabled)',
                        'a.s-pagination-next',
                        '[aria-label="Go to next page"]'
                    ];
                    
                    let nextButton = null;
                    for (const selector of nextButtonSelectors) {
                        nextButton = await page.$(selector);
                        if (nextButton) {
                            const isDisabled = await page.evaluate((el) => {
                                return el.classList.contains('s-pagination-disabled') || 
                                       el.getAttribute('aria-disabled') === 'true';
                            }, nextButton);
                            
                            if (!isDisabled) break;
                            nextButton = null;
                        }
                    }
                    
                    if (nextButton) {
                        await nextButton.scrollIntoView();
                        await delay(500);
                        await nextButton.click();
                        await delay(2000);
                        try {
                            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
                        } catch (e) {
                            await delay(3000);
                        }
                    } else {
                        break;
                    }
                } catch (error) {
                    break;
                }
            }
            
            try {
                await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 30000 });
            } catch (error) {
                await delay(3000);
            }
            
            await autoScroll(page);
            await delay(3000);
            
            const products = await page.evaluate(() => {
                let productElements = document.querySelectorAll('[data-component-type="s-search-result"]');
                if (productElements.length === 0) {
                    productElements = document.querySelectorAll('[data-asin]:not([data-asin=""])');
                }
                
                const results = [];
                
                productElements.forEach((element) => {
                    try {
                        const asin = element.getAttribute('data-asin');
                        if (!asin || asin === '') return;
                        
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
                        
                        if (name === 'N/A') {
                            const h2 = element.querySelector('h2');
                            if (h2) {
                                name = h2.textContent.trim();
                            }
                        }
                        
                        let productUrl = '';
                        const linkSelectors = [
                            'a.a-text-normal',
                            'h2 a',
                            'a[href*="/dp/"]',
                            'a[href*="/gp/product/"]'
                        ];
                        
                        for (const selector of linkSelectors) {
                            const linkElement = element.querySelector(selector);
                            if (linkElement) {
                                const href = linkElement.getAttribute('href');
                                if (href && (href.includes('/dp/') || href.includes('/gp/product/'))) {
                                    productUrl = href.startsWith('http') ? href : `https://www.amazon.in${href}`;
                                    try {
                                        const urlObj = new URL(productUrl);
                                        productUrl = `${urlObj.origin}${urlObj.pathname}`;
                                    } catch (e) {}
                                    break;
                                }
                            }
                        }
                        
                        if (!productUrl && asin) {
                            productUrl = `https://www.amazon.in/dp/${asin}`;
                        }
                        
                        let price = 'N/A';
                        const offscreenPrice = element.querySelector('.a-price .a-offscreen');
                        if (offscreenPrice && offscreenPrice.textContent.trim()) {
                            price = offscreenPrice.textContent.trim();
                        } else {
                            const priceWhole = element.querySelector('.a-price-whole');
                            if (priceWhole) {
                                const whole = priceWhole.textContent.trim().replace(/[^0-9]/g, '');
                                const priceSymbol = element.querySelector('.a-price-symbol');
                                const priceFraction = element.querySelector('.a-price-fraction');
                                const symbol = priceSymbol ? priceSymbol.textContent.trim() : '₹';
                                const fraction = priceFraction ? priceFraction.textContent.trim() : '00';
                                price = `${symbol}${whole}.${fraction}`;
                            } else {
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
                        
                        let deliveryDate = 'N/A';
                        const deliverySelectors = [
                            '[data-testid="delivery-date"]',
                            '.a-color-base',
                            '.a-text-bold',
                            'span.a-color-base'
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
                        
                        const isSponsored = element.getAttribute('data-component-type') === 'sp-sponsored-result' ||
                                           element.closest('[data-component-type="sp-sponsored-result"]') !== null ||
                                           element.textContent.toLowerCase().includes('sponsored');
                        
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
                        
                        let numRatings = 'N/A';
                        const ratingsLink = element.querySelector('a[href*="#customerReviews"]');
                        if (ratingsLink) {
                            const ratingsText = ratingsLink.textContent.trim();
                            const ratingsMatch = ratingsText.match(/([\d,]+)/);
                            if (ratingsMatch) {
                                numRatings = ratingsMatch[1].replace(/,/g, '');
                            }
                        }
                        
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
                        
                        let unitsSold = 'N/A';
                        const unitsSoldElement = element.querySelector('[data-testid="units-sold"]');
                        if (unitsSoldElement) {
                            const unitsText = unitsSoldElement.textContent.trim();
                            const unitsMatch = unitsText.match(/([\d,]+)/);
                            if (unitsMatch) {
                                unitsSold = unitsMatch[1].replace(/,/g, '');
                            }
                        }
                        
                        if (unitsSold === 'N/A') {
                            const spans = element.querySelectorAll('span');
                            for (const span of spans) {
                                const text = span.textContent.trim();
                                const unitsPattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)\s*(?:in\s+(?:past|last)\s+(?:month|week|day))?/i;
                                const match = text.match(unitsPattern);
                                if (match) {
                                    unitsSold = match[1].replace(/,/g, '');
                                    break;
                                }
                                const simplePattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)/i;
                                const simpleMatch = text.match(simplePattern);
                                if (simpleMatch) {
                                    unitsSold = simpleMatch[1].replace(/,/g, '');
                                    break;
                                }
                            }
                        }
                        
                        if (unitsSold === 'N/A') {
                            const allText = element.textContent;
                            const unitsPattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)\s*(?:in\s+(?:past|last)\s+(?:month|week|day))?/i;
                            const match = allText.match(unitsPattern);
                            if (match) {
                                unitsSold = match[1].replace(/,/g, '');
                            } else {
                                const simplePattern = /([\d,]+)\+?\s*(?:bought|sold|purchased)/i;
                                const simpleMatch = allText.match(simplePattern);
                                if (simpleMatch) {
                                    unitsSold = simpleMatch[1].replace(/,/g, '');
                                }
                            }
                        }
                        
                        if (asin) {
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
                        }
                    } catch (error) {
                        // Skip errors
                    }
                });
                
                return results;
            });
            
            // Update progress after scraping each page
            allProducts.push(...products);
            updateProgress(pageNum, allProducts.length, false);
            
            if (pageNum < maxPages) {
                await delay(2000);
            }
        }
        
        // Write CSV file - show 95% progress
        updateProgress(maxPages, allProducts.length, false);
        
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
        
        // Final update with completion status - only now show 100%
        updateProgress(maxPages, allProducts.length, true);
        
        return {
            totalProducts: allProducts.length,
            csvFile: csvPath
        };
        
    } catch (error) {
        throw error;
    } finally {
        await browser.close();
    }
}

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

module.exports = { scrapeAmazonWithProgress };


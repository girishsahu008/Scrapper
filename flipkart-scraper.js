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

async function scrapeFlipkartWithProgress(url, maxPages = 1, progressCallback = null) {
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
                let progress;
                if (isComplete) {
                    progress = 100;
                } else {
                    if (pageCompleted === 0) {
                        progress = 0;
                    } else {
                        progress = Math.round((pageCompleted / maxPages) * 100);
                    }
                    if (progress > 100) progress = 100;
                    if (progress < 0) progress = 0;
                }
                
                progressCallback({
                    status: isComplete ? 'completed' : 'scraping',
                    progress,
                    currentPage: pageCompleted,
                    totalPages: maxPages,
                    productsScraped: productsCount,
                    totalProducts: productsCount,
                    platform: 'flipkart'
                });
            }
        };
        
        // Initial progress
        updateProgress(0, 0, false);
        
        for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
            let currentUrl = url;
            
            // Handle pagination for Flipkart
            // Flipkart uses &page=N parameter usually, but sometimes different
            if (pageNum > 1) {
                if (url.includes('page=')) {
                    currentUrl = url.replace(/page=\d+/, `page=${pageNum}`);
                } else {
                    currentUrl = `${url}&page=${pageNum}`;
                }
            }
            
            console.log(`Navigating to: ${currentUrl}`);
            
            try {
                await page.goto(currentUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 60000 
                });
            } catch (error) {
                console.error(`Error navigating to page ${pageNum}:`, error);
                // If the first page fails, we should probably stop
                if (pageNum === 1) throw error;
            }
            
            // Wait for product results to load
            try {
                // Try waiting for common product containers
                await Promise.race([
                    page.waitForSelector('div._1AtVbE', { timeout: 20000 }),
                    page.waitForSelector('div[data-id]', { timeout: 20000 }),
                    page.waitForSelector('a.s1Q9rs', { timeout: 20000 }),
                    page.waitForSelector('div._4rR01T', { timeout: 20000 })
                ]);
            } catch (error) {
                console.log('Timeout waiting for selector, proceeding anyway...');
            }
            
            await autoScroll(page);
            await delay(2000);
            
            const products = await page.evaluate(() => {
                const results = [];
                
                // Strategy 1: Grid View (common for electronics, mobiles)
                // Container: div._1AtVbE -> div._13oc-S
                // Title: div._4rR01T
                // Price: div._30jeq3
                
                // Strategy 2: List/Tile View (common for groceries, general items)
                // Container: div._4ddWZP or just div[data-id]
                // Title: a.s1Q9rs
                // Price: div._30jeq3
                
                // Strategy: Use data-id as the primary container
                const productElements = document.querySelectorAll('div[data-id]');
                
                productElements.forEach((element) => {
                    try {
                        const dataId = element.getAttribute('data-id');
                        if (!dataId) return;
                        
                        // Extract Name/Title
                        // Verified selector: a.pIpigb (has title attribute)
                        // Fallback: s1Q9rs (older grids), _4rR01T (list view)
                        let name = 'N/A';
                        let nameElement = element.querySelector('a.pIpigb');
                        if (nameElement) {
                            name = nameElement.getAttribute('title') || nameElement.textContent.trim();
                        } else {
                            // Fallbacks
                            const titleSelectors = ['a.s1Q9rs', 'div._4rR01T', 'a.IRpwTa'];
                            for (const s of titleSelectors) {
                                nameElement = element.querySelector(s);
                                if (nameElement) {
                                    name = nameElement.getAttribute('title') || nameElement.textContent.trim();
                                    break;
                                }
                            }
                        }
                        
                        // Extract URL
                        let productUrl = '';
                        // Usually same as name element for grid items
                        const linkElement = element.querySelector('a.pIpigb') || 
                                          element.querySelector('a.s1Q9rs') || 
                                          element.querySelector('a._1fQZEK') ||
                                          element.querySelector('a[href*="/p/itm"]');
                                          
                        if (linkElement) {
                            const href = linkElement.getAttribute('href');
                            if (href) {
                                productUrl = href.startsWith('http') ? href : `https://www.flipkart.com${href}`;
                            }
                        }
                        
                        if (!productUrl) return; // Skip if no URL found
                        
                        // Extract Price
                        // Verified selector: div.hZ3P6w (grid)
                        // Fallback: div._30jeq3 (older)
                        let price = 'N/A';
                        const priceElement = element.querySelector('div.hZ3P6w') || element.querySelector('div._30jeq3');
                        if (priceElement) {
                            price = priceElement.textContent.trim();
                        }
                        
                        // Extract Rating
                        // Verified selector: div.MKiFS6
                        // Fallback: div._3LWZlK
                        let rating = 'N/A';
                        const ratingElement = element.querySelector('div.MKiFS6') || element.querySelector('div._3LWZlK');
                        if (ratingElement) {
                            rating = ratingElement.textContent.trim();
                        }
                        
                        // Extract Number of Ratings
                        // Verified selector: span.PvbNMB -> contains "(1,234)"
                        // Fallback: span._2_R_DZ
                        let numRatings = 'N/A';
                        const numRatingsElement = element.querySelector('span.PvbNMB') || element.querySelector('span._2_R_DZ');
                        if (numRatingsElement) {
                            const text = numRatingsElement.textContent.trim();
                            // Handle format like "(36,417)" or "36,417 Ratings"
                            const match = text.match(/[\d,]+/);
                            if (match) {
                                numRatings = match[0].replace(/,/g, '');
                            }
                        }
                        
                        // Sponsored
                        // Look for typical "Sponsored" or "Ad" text/labels
                        const isSponsored = element.textContent.toLowerCase().includes('sponsored') || 
                                           element.querySelector('div._2I5qvP') !== null ||
                                           !!element.querySelector('span.y178-5'); // Some ad label class
                        
                        // Delivery Date
                        // Hard on grid view, often missing or in random spots.
                        let deliveryDate = 'N/A';
                        
                        results.push({
                            name,
                            price,
                            url: productUrl,
                            deliveryDate,
                            sponsored: isSponsored ? 'Yes' : 'No',
                            rating,
                            numRatings,
                            unitsSold: 'N/A' // Not available on search pages
                        });
                        
                    } catch (e) {
                        // Skip error
                    }
                });
                
                return results;
            });
            
            allProducts.push(...products);
            
            updateProgress(pageNum, allProducts.length, false);
            
            // Check if we reached the last page or if there are no more products
            if (products.length === 0) {
                console.log('No products found on this page, stopping.');
                break;
            }
            
            if (pageNum < maxPages) {
                await delay(2000);
            }
        }
        
        // Save to CSV
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const fileName = `flipkart_products_${timestamp}.csv`;
        const csvPath = path.join(outputFolder, fileName);
        
        const csvWriter = createCsvWriter({
            path: csvPath,
            header: [
                { id: 'name', title: 'Name' },
                { id: 'price', title: 'Price' },
                { id: 'url', title: 'URL' },
                { id: 'rating', title: 'Rating' },
                { id: 'numRatings', title: 'Number of Ratings' },
                { id: 'sponsored', title: 'Sponsored' },
                { id: 'deliveryDate', title: 'Delivery Date' },
                { id: 'unitsSold', title: 'Units Sold' }
            ]
        });
        
        await csvWriter.writeRecords(allProducts);
        
        // Final update
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

module.exports = { scrapeFlipkartWithProgress };

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { scrapeAmazonWithProgress } = require('./scraper-api');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
// Serve output folder as static files
app.use('/output', express.static('output'));

// Store active scraping jobs
const activeJobs = new Map();

// Serve the UI
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start scraping endpoint
app.post('/api/scrape', async (req, res) => {
    const { url, pages } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    const jobId = Date.now().toString();
    const maxPages = parseInt(pages) || 1;
    
    // Start scraping in background
    scrapeAmazonWithProgress(url, maxPages, (progress) => {
        const currentJob = activeJobs.get(jobId) || {};
        activeJobs.set(jobId, {
            ...currentJob,
            ...progress
        });
    }).then((result) => {
        console.log('Scraping completed, CSV file path:', result.csvFile);
        const currentJob = activeJobs.get(jobId) || {};
        // Get just the filename from the full path
        const fileName = path.basename(result.csvFile);
        // Create the public URL
        const csvUrl = `/output/${fileName}`;
        
        const finalJob = {
            ...currentJob,
            status: 'completed',
            progress: 100,
            csvFile: result.csvFile, // Keep full path for server
            csvUrl: csvUrl, // Public URL for download
            totalProducts: result.totalProducts,
            productsScraped: result.totalProducts,
            currentPage: maxPages,
            totalPages: maxPages
        };
        activeJobs.set(jobId, finalJob);
        console.log('Job stored with CSV URL:', csvUrl);
        console.log('File exists:', fs.existsSync(finalJob.csvFile));
    }).catch((error) => {
        const currentJob = activeJobs.get(jobId) || {};
        activeJobs.set(jobId, {
            ...currentJob,
            status: 'error',
            error: error.message
        });
    });
    
    // Initialize job
    activeJobs.set(jobId, {
        status: 'started',
        progress: 0,
        currentPage: 0,
        totalPages: maxPages,
        productsScraped: 0
    });
    
    res.json({ jobId });
});

// Get progress endpoint
app.get('/api/progress/:jobId', (req, res) => {
    const { jobId } = req.params;
    const progress = activeJobs.get(jobId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json(progress);
});

// Download CSV endpoint
app.get('/api/download/:jobId', (req, res) => {
    const { jobId } = req.params;
    const progress = activeJobs.get(jobId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    if (!progress.csvFile) {
        return res.status(404).json({ error: 'CSV file not ready yet' });
    }
    
    const filePath = path.join(__dirname, progress.csvFile);
    
    if (!fs.existsSync(filePath)) {
        console.error('File not found at:', filePath);
        return res.status(404).json({ error: 'File not found on disk' });
    }
    
    const fileName = path.basename(filePath);
    res.download(filePath, fileName, (err) => {
        if (err) {
            console.error('Download error:', err);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Download failed' });
            }
        }
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});


const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const { scrapeAmazonWithProgress } = require('./scraper-api');
const { scrapeFlipkartWithProgress } = require('./flipkart-scraper');

const app = express();
const PORT = 3000;

// Users file path
const USERS_FILE = path.join(__dirname, 'users.json');

// Helper function to read users
function readUsers() {
    try {
        const data = fs.readFileSync(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading users file:', error);
        return [];
    }
}

// Helper function to write users
function writeUsers(users) {
    try {
        fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 4), 'utf8');
        return true;
    } catch (error) {
        console.error('Error writing users file:', error);
        return false;
    }
}

// Helper function to find user by username
function findUser(username) {
    const users = readUsers();
    return users.find(u => u.user === username);
}

// Helper function to update user page limit
function updateUserPages(username, pagesUsed) {
    const users = readUsers();
    const userIndex = users.findIndex(u => u.user === username);
    
    if (userIndex !== -1) {
        const currentPages = parseInt(users[userIndex].noOfPages) || 0;
        const newPages = Math.max(0, currentPages - pagesUsed);
        users[userIndex].noOfPages = newPages.toString();
        writeUsers(users);
        return newPages;
    }
    return null;
}

// Middleware
app.use(cors({
    origin: true,
    credentials: true
}));
app.use(express.json());
app.use(session({
    secret: 'amazon-scraper-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // Set to true if using HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

app.use(express.static('public'));
// Serve output folder as static files
app.use('/output', express.static('output'));

// Store active scraping jobs
const activeJobs = new Map();

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
}

// Authentication endpoints
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    const user = findUser(username);
    
    if (!user || user.password !== password) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Set session
    req.session.user = username;
    req.session.userRemainingPages = parseInt(user.noOfPages) || 0;
    
    res.json({
        success: true,
        username: username,
        remainingPages: req.session.userRemainingPages
    });
});

app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ success: true });
    });
});

app.get('/api/auth/check', (req, res) => {
    if (req.session && req.session.user) {
        const user = findUser(req.session.user);
        const remainingPages = user ? parseInt(user.noOfPages) || 0 : 0;
        res.json({
            authenticated: true,
            username: req.session.user,
            remainingPages: remainingPages
        });
    } else {
        res.json({
            authenticated: false,
            remainingPages: 0
        });
    }
});

// Serve login page if not authenticated, otherwise serve main page
app.get('/', (req, res) => {
    if (req.session && req.session.user) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

// Serve login page explicitly
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Start scraping endpoint (protected)
app.post('/api/scrape', requireAuth, async (req, res) => {
    const { url, pages, platform } = req.body;
    const username = req.session.user;
    
    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }
    
    const requestedPages = parseInt(pages) || 1;
    const selectedPlatform = platform || 'amazon'; // Default to amazon
    
    // Check user's remaining pages
    const user = findUser(username);
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    const remainingPages = parseInt(user.noOfPages) || 0;
    
    if (requestedPages > remainingPages) {
        return res.status(403).json({ 
            error: `Insufficient pages. You have ${remainingPages} pages remaining, but requested ${requestedPages}.` 
        });
    }
    
    const jobId = Date.now().toString();
    const maxPages = requestedPages;
    
    // Initialize job first
    activeJobs.set(jobId, {
        status: 'started',
        progress: 0,
        currentPage: 0,
        totalPages: maxPages,
        productsScraped: 0,
        username: username,
        platform: selectedPlatform
    });
    
    // Define the progress callback handling
    const handleProgress = (progress) => {
        console.log(`Progress callback received:`, progress);
        // Get the current job and merge with new progress
        const currentJob = activeJobs.get(jobId);
        if (currentJob) {
            // Merge progress, ensuring new values override old ones
            const updatedJob = {
                ...currentJob,
                ...progress,
                // Ensure these are always updated from progress
                status: progress.status !== undefined ? progress.status : currentJob.status,
                progress: progress.progress !== undefined ? progress.progress : currentJob.progress,
                currentPage: progress.currentPage !== undefined ? progress.currentPage : currentJob.currentPage,
                productsScraped: progress.productsScraped !== undefined ? progress.productsScraped : currentJob.productsScraped,
                totalProducts: progress.totalProducts !== undefined ? progress.totalProducts : currentJob.totalProducts,
                totalPages: progress.totalPages !== undefined ? progress.totalPages : currentJob.totalPages
            };
            activeJobs.set(jobId, updatedJob);
            console.log(`Job updated in Map:`, updatedJob);
        } else {
            // If job doesn't exist, create it (should rarely happen as we init above)
            const newJob = {
                ...progress,
                username: username,
                platform: selectedPlatform
            };
            activeJobs.set(jobId, newJob);
        }
    };

    // Define completion handler
    const handleCompletion = (result) => {
        console.log('Scraping completed, CSV file path:', result.csvFile);
        
        // Update user's page limit
        const newRemaining = updateUserPages(username, maxPages);
        console.log(`User ${username} used ${maxPages} pages. Remaining: ${newRemaining}`);
        
        // Update session
        if (req.session) {
            req.session.userRemainingPages = newRemaining;
        }
        
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
            totalProducts: result.totalProducts || currentJob.totalProducts || 0,
            productsScraped: result.totalProducts || currentJob.totalProducts || 0,
            currentPage: maxPages,
            totalPages: maxPages,
            remainingPages: newRemaining
        };
        activeJobs.set(jobId, finalJob);
        console.log('Job stored with CSV URL:', csvUrl);
    };

    // Start scraping in background based on platform
    let scrapePromise;
    if (selectedPlatform === 'flipkart') {
        console.log('Starting Flipkart scraping...');
        scrapePromise = scrapeFlipkartWithProgress(url, maxPages, handleProgress);
    } else {
        console.log('Starting Amazon scraping...');
        scrapePromise = scrapeAmazonWithProgress(url, maxPages, handleProgress);
    }

    scrapePromise
        .then(handleCompletion)
        .catch((error) => {
            const currentJob = activeJobs.get(jobId) || {};
            activeJobs.set(jobId, {
                ...currentJob,
                status: 'error',
                error: error.message
            });
        });
    
    res.json({ jobId });
});

// Get progress endpoint (protected)
app.get('/api/progress/:jobId', requireAuth, (req, res) => {
    const { jobId } = req.params;
    const progress = activeJobs.get(jobId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if job belongs to current user
    if (progress.username && progress.username !== req.session.user) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Add remaining pages info
    const user = findUser(req.session.user);
    const remainingPages = user ? parseInt(user.noOfPages) || 0 : 0;
    
    const responseData = {
        ...progress,
        remainingPages: remainingPages
    };
    
    console.log(`Returning progress for job ${jobId}:`, responseData);
    
    res.json(responseData);
});

// Download CSV endpoint (protected)
app.get('/api/download/:jobId', requireAuth, (req, res) => {
    const { jobId } = req.params;
    const progress = activeJobs.get(jobId);
    
    if (!progress) {
        return res.status(404).json({ error: 'Job not found' });
    }
    
    // Check if job belongs to current user
    if (progress.username && progress.username !== req.session.user) {
        return res.status(403).json({ error: 'Access denied' });
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

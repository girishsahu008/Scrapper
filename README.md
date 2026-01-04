# Amazon Scraper

A web-based Amazon product scraper with user authentication and page limit management. Built with Node.js, Express, and Puppeteer.

## Features

- 🔐 User authentication with login system
- 📊 Real-time progress tracking
- 📄 Multi-page scraping support
- 💾 CSV export functionality
- 🎯 Page limit management per user
- 📈 Progress bar with page-based updates

## Prerequisites

- Ubuntu 20.04 or later
- Internet connection
- sudo/root access for package installation

## Installation Steps

### 1. Install Node.js using NVM (Node Version Manager)

```bash
# Update package list
sudo apt update

# Install required packages for NVM
sudo apt install -y curl build-essential

# Download and install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Reload your shell configuration
source ~/.bashrc

# Verify NVM installation
nvm --version

# Install Node.js (LTS version recommended)
nvm install 18

# Use Node.js 18
nvm use 18

# Set Node.js 18 as default
nvm alias default 18

# Verify Node.js installation
node --version
npm --version
```

**Expected output:**
- Node.js version: v18.x.x or higher
- npm version: 9.x.x or higher

### 2. Install Headless Chrome Dependencies

Puppeteer requires certain system dependencies to run Chromium in headless mode:

```bash
# Install all required dependencies
sudo apt-get install -y \
    ca-certificates \
    fonts-liberation \
    libappindicator3-1 \
    libasound2t64 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    lsb-release \
    wget \
    xdg-utils
```

**Note**: If you encounter an error with `libasound2t64` (on older Ubuntu versions), try using `libasound2` instead, or install it separately:

```bash
# For Ubuntu 24.04 and newer, use libasound2t64
# For Ubuntu 22.04 and older, use libasound2
# Try the command above first, if it fails, use this:
sudo apt-get install -y libasound2 || sudo apt-get install -y libasound2t64
```

### 3. Clone and Setup Project

```bash
# Navigate to your desired directory
cd /path/to/your/projects

# If using git, clone the repository
# git clone <your-repo-url>
# cd AmzonScrapper

# Or if you already have the project files, navigate to the project directory
cd AmzonScrapper
```

### 4. Install NPM Dependencies

```bash
# Install all project dependencies
npm install
```

This will install:
- `express` - Web framework
- `puppeteer` - Headless browser automation
- `csv-writer` - CSV file generation
- `express-session` - Session management
- `cors` - Cross-origin resource sharing

### 5. Create Required Directories

```bash
# Create output directory for CSV files
mkdir -p output

# Ensure the directory has write permissions
chmod 755 output
```

### 6. Configure Users

Edit the `users.json` file to add your users:

```json
[
    {
        "user": "your_username",
        "password": "your_password",
        "noOfPages": 30
    }
]
```

## Running the Application

### Start the Server

```bash
# Start the server (runs on port 3000 by default)
npm run server

# Or use the alternative command
npm run ui
```

**Expected output:**
```
Server running at http://localhost:3000
```

### Access the Application

1. Open your web browser
2. Navigate to: `http://localhost:3000`
3. You will be redirected to the login page
4. Enter your credentials from `users.json`
5. Start scraping Amazon product pages

### Running in Production (Optional)

For production deployment, consider using PM2 to keep the server running:

```bash
# Install PM2 globally
npm install -g pm2

# Start the server with PM2
pm2 start server.js --name amazon-scraper

# View logs
pm2 logs amazon-scraper

# Stop the server
pm2 stop amazon-scraper

# Restart the server
pm2 restart amazon-scraper
```

## Usage

1. **Login**: Enter your username and password
2. **Enter Amazon URL**: Paste an Amazon search URL (e.g., `https://www.amazon.in/s?k=metal+furniture`)
3. **Select Pages**: Choose the number of pages to scrape (limited by your account's page limit)
4. **Monitor Progress**: Watch the progress bar update in real-time
5. **Download CSV**: Once complete, download the CSV file with all scraped product data

## Project Structure

```
AmzonScrapper/
├── public/
│   ├── index.html          # Main scraper UI
│   └── login.html          # Login page
├── output/                 # Generated CSV files
├── scraper-api.js          # Core scraping logic
├── server.js               # Express server
├── users.json              # User credentials and limits
├── package.json            # Project dependencies
└── README.md              # This file
```

## Data Scraped

The scraper extracts the following data for each product:
- Product Name
- Price
- Product URL
- Delivery Date
- Sponsored Status
- Rating
- Number of Ratings
- Units Sold (if available)

## Troubleshooting

### Node.js version issues
```bash
# Check current Node.js version
node --version

# Switch to correct version if needed
nvm use 18
```

### Puppeteer/Chrome Download Issues

If you encounter a 403 error when Puppeteer tries to download Chrome:

**Solution 1: Install Chromium system-wide and configure Puppeteer to use it (Recommended)**

```bash
# Step 1: Install Chromium
sudo apt-get update
sudo apt-get install -y chromium-browser

# Step 2: Find Chromium path
which chromium-browser
# This should return something like /usr/bin/chromium-browser or /usr/bin/chromium

# Step 3: Install npm packages with skip download
cd ~/Scrapper
PUPPETEER_SKIP_DOWNLOAD=true npm install

# Step 4: Update scraper-api.js
# Find the browser launch code (around line 18-21) and change it to:
# const browser = await puppeteer.launch({
#     headless: true,
#     executablePath: '/usr/bin/chromium-browser',  # Use the path from step 2
#     args: ['--no-sandbox', '--disable-setuid-sandbox']
# });
```

**Alternative: If chromium-browser path is different, find it with:**
```bash
which chromium-browser || which chromium || find /usr -name chromium* 2>/dev/null | head -1
```

**Solution 2: Use Puppeteer with Chromium (Alternative package)**

```bash
# Uninstall puppeteer
npm uninstall puppeteer

# Install puppeteer-core and chromium separately
npm install puppeteer-core
sudo apt-get install -y chromium-browser

# Update scraper-api.js to use system Chromium (see Solution 1)
```

**Solution 3: Manual Chrome Download (if network allows)**

```bash
# Set environment variable to use a different download method
export PUPPETEER_DOWNLOAD_HOST=https://npm.taobao.org/mirrors
npm install

# Or try with skip download and manual setup
PUPPETEER_SKIP_DOWNLOAD=true npm install
# Then manually download and configure Chrome
```

**Solution 4: Use existing Chrome/Chromium**

If Chrome/Chromium is already installed on your system:

```bash
# Install with skip download
PUPPETEER_SKIP_DOWNLOAD=true npm install

# Find Chromium path
which chromium-browser
# or
which google-chrome

# Update scraper-api.js to use the system browser path
```

### Port already in use
```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>
```

### Permission issues
```bash
# Ensure output directory has write permissions
chmod 755 output
```

## Environment Variables (Optional)

You can modify the server port by editing `server.js`:

```javascript
const PORT = process.env.PORT || 3000;
```

Then run with:
```bash
PORT=8080 npm run server
```

## Security Notes

- Change the session secret in `server.js` for production use
- Use strong passwords in `users.json`
- Consider using environment variables for sensitive data
- Implement HTTPS in production

## License

ISC

## Support

For issues or questions, please check the project repository or create an issue.


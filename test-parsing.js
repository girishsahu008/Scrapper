
function extractCount(text) {
    if (!text) return 'N/A';
    
    // Normalize text
    text = text.trim();
    
    // Pattern to match number and optional K/M suffix and optional +
    // Matches: "1K+", "1.5K", "500", "2M+"
    // Capture group 1: The full count string including suffix and +
    const pattern = /([\d,]+(?:\.\d+)?\s*(?:[kKmM])?\+?)\s*(?:bought|sold|purchased|ratings?|reviews?)/i;
    
    const match = text.match(pattern);
    if (!match) {
        // Fallback for simple numbers without specific context keywords
        // e.g. just "1K+"
        const simplePattern = /^([\d,]+(?:\.\d+)?\s*(?:[kKmM])?\+?)$/;
        const simpleMatch = text.match(simplePattern);
        if (simpleMatch) {
            return normalizeCount(simpleMatch[1]);
        }
        return 'N/A';
    }
    
    return normalizeCount(match[1]);
}

function normalizeCount(str) {
    // Remove internal spaces (e.g. "1 K+" -> "1K+")
    return str.replace(/\s+/g, '').toUpperCase();
}

// Test cases
const testCases = [
    "1K+ bought in past month",
    "2K+ bought in past month",
    "500+ bought in past month",
    "1.5K+ bought",
    "3M+ rated",
    "2,500 ratings",
    "100 bought",
    "No units sold info",
    "Some other random text"
];

console.log("Running tests...");
testCases.forEach(test => {
    console.log(`"${test}" -> "${extractCount(test)}"`);
});

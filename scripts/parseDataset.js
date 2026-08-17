const fs = require('fs');
const path = require('path');

const firstNamePath = path.join(__dirname, '../dataset/cleaned_philippine_first_names.csv');
const surnamePath = path.join(__dirname, '../dataset/cleaned_philippine_surnames.csv');
const outputPath = path.join(__dirname, '../src/data/philippineNames.json');

function parseCsvColumn(filePath) {
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split(/\r?\n/);
    const names = [];

    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        const val = parts[parts.length - 1].trim().replace(/^"|"$/g, '');
        if (val && val !== 'first_name' && val !== 'surname' && val !== 'Column1' && isNaN(val)) {
            names.push(val);
        }
    }
    return Array.from(new Set(names));
}

const firstNames = parseCsvColumn(firstNamePath);
const surnames = parseCsvColumn(surnamePath);

const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify({ firstNames, surnames }, null, 2));
console.log(`Generated philippineNames.json with ${firstNames.length} first names and ${surnames.length} surnames.`);

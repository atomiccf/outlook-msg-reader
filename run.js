// run.js

const path = require('path');
const fs = require('fs');
const jiti = require('jiti')(__filename);

let parseMsg;

try {
    // Try using built artifacts first (dist)
    ({ parseMsg } = require('./dist/index.js'));
    console.info('[run] Using built module from dist/index.js');
} catch (error) {
    console.warn('[run] dist build not found or failed to load. Falling back to source via JITI.');
    ({ parseMsg } = jiti('./src/index.ts'));
}

async function main() {
    const filePath = process.argv[2] || path.join(__dirname, 'sample', 'sample.msg');

    if (!fs.existsSync(filePath)) {
        console.error(`File not found: ${filePath}`);
        process.exit(1);
    }

    try {
        console.log(`Parsing MSG file: ${filePath}`);
        const msg = await parseMsg(filePath);

        console.log('\n=== Parsed MSG ===');
        console.log('Subject:', msg.subject);
        console.log('From:', `${msg.from.name} <${msg.from.email}>`);
        console.log('To:', msg.to.map(t => `${t.name} <${t.email}>`).join(', '));
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();

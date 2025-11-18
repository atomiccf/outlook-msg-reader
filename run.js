// run.js

const { parseMsg } = require('./dist/index.js');
const path = require('path');
const fs = require('fs');

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

// run.js - Local debugging script for msg library

const path = require('path');
const fs = require('fs');
const jiti = require('jiti')(__filename, {
    // Enable source maps for better debugging
    sourceMaps: true,
    interopDefault: true,
});

// Parse command line arguments
const args = process.argv.slice(2);
const flags = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    json: args.includes('--json') || args.includes('-j'),
    source: args.includes('--source') || args.includes('-s'),
    help: args.includes('--help') || args.includes('-h'),
};

const filePath = args.find(arg => !arg.startsWith('--') && !arg.startsWith('-'));

// Show help
if (flags.help) {
    console.log(`
Usage: node run.js [options] [file.msg]

Options:
  -v, --verbose    Show detailed debugging information
  -j, --json       Output parsed message as JSON
  -s, --source     Force using source files (src/) instead of dist/
  -h, --help       Show this help message

Examples:
  node run.js sample/sample.msg
  node run.js -v sample/sample.msg
  node run.js --json --source sample/sample.msg
    `);
    process.exit(0);
}

// Load library - prefer source for debugging
let parseMsg, createMsgReader;

if (flags.source) {
    // Force using source files for debugging
    console.info('[run] Loading from source (src/index.ts)');
    ({ parseMsg, createMsgReader } = jiti('./src/index.ts'));
} else {
    try {
        // Try using built artifacts first (dist)
        ({ parseMsg, createMsgReader } = require('./dist/index.js'));
        console.info('[run] Using built module from dist/index.js');
    } catch (error) {
        if (flags.verbose) {
            console.warn('[run] dist build not found:', error.message);
        }
        console.warn('[run] Falling back to source via JITI.');
        ({ parseMsg, createMsgReader } = jiti('./src/index.ts'));
    }
}

async function main() {
    const targetFile = filePath || path.join(__dirname, 'sample', 'new.msg');

    if (!fs.existsSync(targetFile)) {
        console.error(`[ERROR] File not found: ${targetFile}`);
        console.error(`[INFO] Available sample files:`);
        const sampleDir = path.join(__dirname, 'sample');
        if (fs.existsSync(sampleDir)) {
            const files = fs.readdirSync(sampleDir).filter(f => f.endsWith('.msg'));
            files.forEach(f => console.error(`  - ${path.join(sampleDir, f)}`));
        }
        process.exit(1);
    }

    try {
        console.log(`[INFO] Parsing MSG file: ${targetFile}`);
        const startTime = Date.now();

        if (flags.verbose) {
            console.log(`[DEBUG] File size: ${fs.statSync(targetFile).size} bytes`);
            console.log(`[DEBUG] Loading library...`);
        }

        const msg = await parseMsg(targetFile);
        const parseTime = Date.now() - startTime;

        if (flags.verbose) {
            console.log(`[DEBUG] Parsing completed in ${parseTime}ms`);
        }

        // Output as JSON if requested
        if (flags.json) {
            console.log(JSON.stringify(msg, null, 2));
            return;
        }

        // Detailed text output
        console.log('\n' + '='.repeat(60));
        console.log('PARSED MSG FILE');
        console.log('='.repeat(60));

        // Basic info
        console.log('\n[SUBJECT]');
        console.log(`  ${msg.subject || '(no subject)'}`);

        console.log('\n[FROM]');
        console.log(`  Name:  ${msg.from?.name || '(unknown)'}`);
        console.log(`  Email: ${msg.from?.email || '(unknown)'}`);

        console.log('\n[TO]');
        if (msg.to && msg.to.length > 0) {
            msg.to.forEach((recipient, idx) => {
                console.log(`  ${idx + 1}. ${recipient.name || '(unknown)'} <${recipient.email || '(unknown)'}>`);
            });
        } else {
            console.log('  (no recipients)');
        }

        if (msg.cc && msg.cc.length > 0) {
            console.log('\n[CC]');
            msg.cc.forEach((recipient, idx) => {
                console.log(`  ${idx + 1}. ${recipient.name || '(unknown)'} <${recipient.email || '(unknown)'}>`);
            });
        }

        // Body content
        console.log('\n[BODY]');
        if (msg.body?.text) {
            const textPreview = msg.body.text.length > 200
                ? msg.body.text.substring(0, 200) + '...'
                : msg.body.text;
            console.log(`  Text (${msg.body.text.length} chars):`);
            console.log(`  ${textPreview.split('\n').join('\n  ')}`);
        }
        if (msg.body?.html) {
            const htmlPreview = msg.body.html.length > 200
                ? msg.body.html.substring(0, 200) + '...'
                : msg.body.html;
            console.log(`  HTML (${msg.body.html.length} chars):`);
            console.log(`  ${htmlPreview.split('\n').join('\n  ')}`);
        }
        if (msg.body?.rtf) {
            console.log(`  RTF (${msg.body.rtf.length} bytes)`);
        }
        if (!msg.body?.text && !msg.body?.html && !msg.body?.rtf) {
            console.log('  (no body content)');
        }

        // Attachments
        console.log('\n[ATTACHMENTS]');
        if (msg.attachments && msg.attachments.length > 0) {
            msg.attachments.forEach((att, idx) => {
                console.log(`  ${idx + 1}. ${att.name || '(unnamed)'}`);
                console.log(`     MIME: ${att.mime || '(unknown)'}`);
                console.log(`     Size: ${att.content?.length || 0} bytes`);
            });
        } else {
            console.log('  (no attachments)');
        }

        // Verbose debugging info
        if (flags.verbose) {
            console.log('\n[DEBUG INFO]');
            console.log(`  Parse time: ${parseTime}ms`);
            console.log(`  Total recipients: ${(msg.to?.length || 0) + (msg.cc?.length || 0)}`);
            console.log(`  Attachments count: ${msg.attachments?.length || 0}`);
            console.log(`  Has text body: ${!!msg.body?.text}`);
            console.log(`  Has HTML body: ${!!msg.body?.html}`);
            console.log(`  Has RTF body: ${!!msg.body?.rtf}`);
        }

        console.log('\n' + '='.repeat(60));

    } catch (error) {
        console.error('\n[ERROR] Failed to parse MSG file');
        console.error(`  File: ${targetFile}`);
        console.error(`  Error: ${error.message}`);

        if (flags.verbose) {
            console.error('\n[STACK TRACE]');
            console.error(error.stack);
        }

        process.exit(1);
    }
}

main();

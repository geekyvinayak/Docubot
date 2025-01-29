const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuration Constants
const CODE_FILE_EXTENSIONS = new Set([
    'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'cs', 'php',
    'html', 'css', 'scss', 'json', 'md', 'xml', 'yaml',
    'yml', 'sh', 'bat', 'cmd', 'ps1', 'vue', 'svelte',
    'go', 'rs', 'swift', 'kt', 'dart', 'lua', 'sql',
    'c', 'cpp', 'h', 'hpp', 'm', 'mm', 'rb', 'pl'
]);

const DEFAULT_IGNORE_PATTERNS = '**/{node_modules,.git,dist,bin}/**';

// Code Analysis Functions
function analyzeCodeStructure(content) {
    const structure = {
        functions: [],
        classes: [],
        imports: [],
        exports: [],
        endpoints: [],
        testCases: []
    };

    content.split('\n').forEach(line => {
        line = line.trim();
        
        // Detect common patterns
        if (line.startsWith('import ') || line.startsWith('require(')) structure.imports.push(line);
        if (line.startsWith('export ')) structure.exports.push(line);
        if (/function\s+\w+\(/.test(line)) structure.functions.push(line);
        if (/class\s+\w+/.test(line)) structure.classes.push(line);
        if (/(it|test|describe)\(/.test(line)) structure.testCases.push(line);
        if (/(GET|POST|PUT|DELETE)\s+\//.test(line)) structure.endpoints.push(line);
    });

    return structure;
}

function trackDependencies(content) {
    const dependencies = new Set();
    
    const patterns = [
        /from\s+['"]([^'"]+)['"]/g,
        /require\(['"]([^'"]+)['"]\)/g,
        /<dependency>\s*<groupId>([^<]+)/g,
        /implementation\s+['"]([^'"]+)['"]/g
    ];

    patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            dependencies.add(match[1]);
        }
    });

    return Array.from(dependencies);
}

// Documentation Generation
function generateMarkdownDoc(fileInfo) {
    return `# \`${fileInfo.relativePath}\` Documentation\n\n` +
        `## Metadata\n` +
        `- **Size**: ${fileInfo.size} bytes\n` +
        `- **Modified**: ${fileInfo.mtime}\n` +
        `- **Dependencies**: ${fileInfo.dependencies.join(', ') || 'None'}\n\n` +
        `## Code Structure\n` +
        `${renderSection('Functions', fileInfo.structure.functions)}\n` +
        `${renderSection('Classes', fileInfo.structure.classes)}\n` +
        `${renderSection('Endpoints', fileInfo.structure.endpoints)}\n` +
        `${renderSection('Tests', fileInfo.structure.testCases)}\n\n` +
        `## AI Analysis\n${fileInfo.summary}\n\n` +
        `## Preview\n\`\`\`${fileInfo.ext}\n${fileInfo.preview}\n\`\`\`\n`;
}

function renderSection(title, items) {
    if (!items.length) return '';
    return `### ${title} (${items.length})\n` +
        items.slice(0, 5).map(i => `- \`${truncate(i, 60)}\``).join('\n') +
        (items.length > 5 ? `\n- ...+${items.length - 5} more` : '');
}

function truncate(text, length) {
    return text.length > length ? text.substring(0, length) + '...' : text;
}

// Core Logic
async function generateSummary(content) {
    const apiKey = "AIzaSyB-YfkbNRHzKSjnQkUAfL8uKPlkX3bRRR0";
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    try {
        const prompt = `Analyze this code file and provide:\n1. Core functionality\n2. Key dependencies\n3. Potential issues\n4. Optimization suggestions\n\nCode:\n${content.substring(0, 1500)}`;
        const result = await model.generateContent(prompt);
        return (await result.response).text().trim();
    } catch (error) {
        return `Summary error: ${error.message}`;
    }
}

function getIgnorePatterns() {
    const config = vscode.workspace.getConfiguration('docGenerator');
    return config.get('ignorePatterns') || DEFAULT_IGNORE_PATTERNS;
}

async function processFile(filePath, rootPath) {
    const stats = fs.statSync(filePath);
    const relativePath = path.relative(rootPath, filePath);
    const ext = path.extname(filePath).slice(1);
    
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const [summary, structure, dependencies] = await Promise.all([
            generateSummary(content),
            analyzeCodeStructure(content),
            trackDependencies(content)
        ]);
        
        return generateMarkdownDoc({
            relativePath,
            ext,
            size: stats.size,
            mtime: stats.mtime.toLocaleString(),
            structure,
            dependencies,
            summary,
            preview: content.substring(0, 300)
        });
    } catch (error) {
        return `# Documentation Generation Failed\n**Error:** ${error.message}`;
    }
}

async function createDocumentationStructure(files, rootPath) {
    const docRoot = path.join(rootPath, 'documentations');
    if (!fs.existsSync(docRoot)) fs.mkdirSync(docRoot, { recursive: true });

    for (const file of files) {
        const docPath = path.join(docRoot, `${path.relative(rootPath, file.fsPath)}.md`);
        const docDir = path.dirname(docPath);
        
        if (!fs.existsSync(docDir)) fs.mkdirSync(docDir, { recursive: true });
        
        try {
            const content = await processFile(file.fsPath, rootPath);
            fs.writeFileSync(docPath, content);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed ${path.relative(rootPath, file.fsPath)}: ${error.message}`);
        }
    }
}

// Extension Activation
function activate(context) {
    context.subscriptions.push(vscode.commands.registerCommand('extension.generateDocs', async () => {
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showErrorMessage('No workspace open');
            return;
        }

        const rootPath = vscode.workspace.workspaceFolders[0].uri.fsPath;
        
        vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Generating Documentation...",
                cancellable: false,
            },
            async (progress) => {
                try {
                    const ignorePatterns = getIgnorePatterns();
                    const files = await vscode.workspace.findFiles(
                        '**/*.*',
                        `${ignorePatterns},**/*.{png,jpg,pdf,mp3,exe,dll}`
                    );

                    const codeFiles = files.filter(file => 
                        CODE_FILE_EXTENSIONS.has(path.extname(file.fsPath).slice(1).toLowerCase())
                    );

                    if (codeFiles.length === 0) {
                        vscode.window.showInformationMessage('No code files found for documentation.');
                        return;
                    }

                    let processed = 0;
                    for (const file of codeFiles) {
                        await createDocumentationStructure([file], rootPath);
                        processed++;
                        progress.report({ message: `Processing ${processed}/${codeFiles.length} files...`, increment: (100 / codeFiles.length) });
                    }

                    vscode.window.showInformationMessage(`Generated docs for ${codeFiles.length} files`);
                } catch (error) {
                    vscode.window.showErrorMessage(`Documentation failed: ${error.message}`);
                }
            }
        );
    }));
}

function deactivate() {}

module.exports = { activate, deactivate };
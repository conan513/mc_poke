const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const PROJECT_ROOT = path.join(__dirname, '..', '..');  // Go up 2 levels to project root
const CLI_SCRIPTS_DIR = path.join(PROJECT_ROOT, 'build-tools', 'cli');

let buildProcess = null;

// ════════════════════════════════════════════════════════════════════════════════
// Broadcast funkció WebSocket klienseknek
// ════════════════════════════════════════════════════════════════════════════════

function broadcast(message) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// WebSocket kapcsolat kezelés
// ════════════════════════════════════════════════════════════════════════════════

wss.on('connection', (ws) => {
    console.log('[WS] Kliens csatlakozott');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            console.log('[WS] Üzenet:', data);
        } catch (e) {
            console.error('[WS] Parse hiba:', e);
        }
    });

    ws.on('close', () => {
        console.log('[WS] Kliens lecsatlakozott');
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// Build futtatási funkció
// ════════════════════════════════════════════════════════════════════════════════

function runBuild(scriptName, buildType) {
    return new Promise((resolve, reject) => {
        // Check if build is already running
        if (buildProcess) {
            const msg = {
                type: 'error',
                title: '⚠️ Build már fut!',
                message: 'Kérjük, várj, amíg az előző build befejeződik.'
            };
            broadcast(msg);
            reject(msg);
            return;
        }

        const scriptPath = path.join(CLI_SCRIPTS_DIR, scriptName);

        // Check if script exists
        if (!fs.existsSync(scriptPath)) {
            const msg = {
                type: 'error',
                title: '❌ Script nem található',
                message: `A(z) "${scriptName}" script nem létezik: ${scriptPath}`
            };
            broadcast(msg);
            reject(msg);
            return;
        }

        broadcast({
            type: 'start',
            title: '🚀 Build indítása',
            buildType: buildType,
            message: `"${buildType}" build indítása...`
        });

        buildProcess = spawn('bash', [scriptPath], {
            cwd: PROJECT_ROOT,
            stdio: 'pipe'
        });

        let output = '';
        let errors = '';

        buildProcess.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            broadcast({
                type: 'output',
                text: text
            });
        });

        buildProcess.stderr.on('data', (data) => {
            const text = data.toString();
            errors += text;
            broadcast({
                type: 'error_output',
                text: text
            });
        });

        buildProcess.on('close', (code) => {
            buildProcess = null;

            if (code === 0) {
                broadcast({
                    type: 'success',
                    title: '✅ Build sikeres!',
                    message: 'A build sikeresen befejeződött.',
                    output: output
                });
                resolve({ code: 0, output });
            } else {
                broadcast({
                    type: 'error',
                    title: '❌ Build hiba',
                    message: `A build hiba kóddal fejeződött be: ${code}`,
                    output: errors || output
                });
                reject({ code, output: errors || output });
            }
        });

        buildProcess.on('error', (err) => {
            buildProcess = null;
            broadcast({
                type: 'error',
                title: '❌ Process hiba',
                message: err.message
            });
            reject(err);
        });
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// Static files - HTML dashboard
// ════════════════════════════════════════════════════════════════════════════════

app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: 0
}));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'build-client-dashboard.html'));
});

// ════════════════════════════════════════════════════════════════════════════════
// API végpontok
// ════════════════════════════════════════════════════════════════════════════════

app.post('/api/build/:type', express.json(), async (req, res) => {
    const buildType = req.params.type;
    
    const buildScripts = {
        // Linux
        'linux-all': { script: 'build-client-linux.sh', name: 'Összes Linux' },
        'linux-arch': { script: 'build-client-linux-arch.sh', name: 'Arch Linux' },
        'linux-debian': { script: 'build-client-linux-debian.sh', name: 'Debian/Ubuntu' },
        'linux-redhat': { script: 'build-client-linux-redhat.sh', name: 'Red Hat/Fedora' },
        'linux-appimage': { script: 'build-client-linux-appimage.sh', name: 'AppImage' },
        'linux-targz': { script: 'build-client-linux-targz.sh', name: 'TAR.GZ' },
        'linux-flatpak': { script: 'build-client-linux-flatpak.sh', name: 'Flatpak' },
        // Platformok
        'windows': { script: 'build-client-win.sh', name: 'Windows' },
        'macos': { script: 'build-client-mac.sh', name: 'macOS' }
    };

    const buildConfig = buildScripts[buildType];

    if (!buildConfig) {
        return res.status(400).json({
            error: 'Ismeretlen build típus',
            type: buildType
        });
    }

    try {
        await runBuild(buildConfig.script, buildConfig.name);
        res.json({ status: 'success', message: 'Build elindítva' });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message || 'Build hiba'
        });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// Status végpont
// ════════════════════════════════════════════════════════════════════════════════

app.get('/api/status', (req, res) => {
    res.json({
        building: buildProcess !== null,
        projectRoot: PROJECT_ROOT
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// Error handler
// ════════════════════════════════════════════════════════════════════════════════

app.use((err, req, res, next) => {
    console.error('Server hiba:', err);
    res.status(500).json({
        error: 'Server hiba',
        message: err.message
    });
});

// ════════════════════════════════════════════════════════════════════════════════
// Server indítás
// ════════════════════════════════════════════════════════════════════════════════

server.listen(PORT, () => {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║  🎮 COBBLEMON UNIVERSE - Client Builder Server            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`📍 Server futása: http://localhost:${PORT}`);
    console.log('');
    console.log('📋 Build scripteket megnyithatod a böngészőből!');
    console.log('🔗 Nyiss meg egy böngészőablakot: http://localhost:3000');
    console.log('');
    console.log('💾 Projektkönyvtár:', PROJECT_ROOT);
    console.log('');
    console.log('Press Ctrl+C a szerverhez leállításához');
    console.log('');
});

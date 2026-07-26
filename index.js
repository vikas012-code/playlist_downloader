const http = require('http');
const path = require('path');
const fs = require('fs');
const url = require('url');
const JSZip = require('jszip');
const YTDlpWrap = require('yt-dlp-wrap').default;
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const PORT = process.env.PORT || 3000;
const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');
const outputFolder = path.join(__dirname, 'my_audio_library');

// Ensure output folder exists
if (!fs.existsSync(outputFolder)) {
    fs.mkdirSync(outputFolder, { recursive: true });
}

let activeEmitter = null;
let isDownloading = false;
let isCancelled = false;
let sseClients = [];
let currentSong = null;

// Download yt-dlp binary if missing
async function ensureBinary() {
    if (!fs.existsSync(ytDlpPath)) {
        console.log('yt-dlp binary not found. Downloading latest binary from GitHub...');
        await YTDlpWrap.downloadFromGithub(ytDlpPath);
        console.log('yt-dlp binary downloaded successfully.');
    }
}

// Broadcast SSE message to all connected clients
function broadcast(data) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(client => client.res.write(message));
}

// Helper to count downloaded files
function getDownloadedFiles() {
    if (!fs.existsSync(outputFolder)) return [];
    return fs.readdirSync(outputFolder).filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.mp3', '.mp4', '.m4a', '.webm', '.mkv', '.wav', '.opus'].includes(ext) && !file.endsWith('.part');
    });
}

// HTTP Server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // Static file serving helper
    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
        
        // Prevent path traversal
        if (!filePath.startsWith(path.join(__dirname, 'public'))) {
            res.writeHead(403);
            return res.end('Forbidden');
        }

        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'text/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.svg': 'image/svg+xml'
        };

        const contentType = mimeTypes[ext] || 'application/octet-stream';

        fs.readFile(filePath, (err, content) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end('<h1>404 Not Found</h1>');
                } else {
                    res.writeHead(500);
                    res.end(`Server Error: ${err.code}`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
        return;
    }

    // API Routes

    // 1. SSE Connection Endpoint
    if (req.method === 'GET' && pathname === '/api/stream') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const clientId = Date.now();
        const newClient = { id: clientId, res };
        sseClients.push(newClient);

        // Send initial state
        res.write(`data: ${JSON.stringify({ type: 'init', isDownloading, currentSong })}\n\n`);

        req.on('close', () => {
            sseClients = sseClients.filter(client => client.id !== clientId);
        });
        return;
    }

    // 2. Start Download Endpoint
    if (req.method === 'POST' && pathname === '/api/start') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { url: playlistUrl, format } = JSON.parse(body || '{}');

                if (!playlistUrl) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'URL is required.' }));
                }

                if (isDownloading) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ error: 'A download is already in progress.' }));
                }

                await ensureBinary();
                const ytDlpWrap = new YTDlpWrap(ytDlpPath);

                isDownloading = true;
                isCancelled = false;

                // Configure yt-dlp arguments based on requested format
                let ytArgs = [
                    playlistUrl,
                    '-o', `${outputFolder}/%(title)s.%(ext)s`,
                    '--yes-playlist',
                    '--add-metadata',
                    '--ignore-errors',
                    '--ffmpeg-location', ffmpeg.path,
                    '--extractor-args', 'youtube:player_client=android,web'
                ];

                if (format === 'mp3') {
                    ytArgs.push('-x', '--audio-format', 'mp3', '--audio-quality', '5');
                } else {
                    ytArgs.push('-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]', '--merge-output-format', 'mp4');
                }

                console.log(`Starting download with arguments: ${ytArgs.join(' ')}`);
                broadcast({ type: 'status', message: 'Starting download process...' });

                activeEmitter = ytDlpWrap.exec(ytArgs);

                activeEmitter.on('progress', (progress) => {
                    if (isCancelled) return;
                    broadcast({
                        type: 'progress',
                        percent: progress.percent,
                        totalSize: progress.totalSize,
                        currentSpeed: progress.currentSpeed,
                        eta: progress.eta
                    });
                });

                activeEmitter.on('ytDlpEvent', (eventType, eventData) => {
                    if (isCancelled) return;
                    console.log(`[ytDlpEvent] ${eventType}: ${eventData}`);

                    // Parse title or song downloading event
                    if (eventData.includes('[download] Destination:') || eventData.includes('[ExtractAudio] Destination:')) {
                        const filename = path.basename(eventData.split('Destination:')[1].trim());
                        const songTitle = path.parse(filename).name;
                        currentSong = songTitle;
                        broadcast({ type: 'song_downloading', title: songTitle, filename });
                    } else if (eventData.includes('[download] Downloading item')) {
                        broadcast({ type: 'status', message: eventData.trim() });
                    } else if (eventData.includes('100% of') && currentSong) {
                        broadcast({ type: 'song_completed', title: currentSong });
                    }
                });

                activeEmitter.on('error', (error) => {
                    console.error('yt-dlp execution error:', error);
                    if (!isCancelled) {
                        isDownloading = false;
                        broadcast({ type: 'error', message: error.message || 'Download failed' });
                    }
                });

                activeEmitter.on('close', () => {
                    console.log('yt-dlp process closed.');
                    const count = getDownloadedFiles().length;

                    if (isCancelled) {
                        broadcast({ type: 'cancelled', count });
                    } else {
                        isDownloading = false;
                        broadcast({ type: 'finished', count });
                    }

                    activeEmitter = null;
                    isDownloading = false;
                });

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, message: 'Download started.' }));

            } catch (err) {
                console.error('Error starting download:', err);
                isDownloading = false;
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: err.message || 'Internal server error' }));
            }
        });
        return;
    }

    // 3. Cancel Download Endpoint
    if (req.method === 'POST' && pathname === '/api/cancel') {
        if (!isDownloading && !activeEmitter) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'No active download to cancel.' }));
        }

        console.log('Cancelling download process...');
        isCancelled = true;

        if (activeEmitter && activeEmitter.ytDlpProcess) {
            try {
                // Kill spawned child process
                activeEmitter.ytDlpProcess.kill('SIGINT');
                setTimeout(() => {
                    if (activeEmitter && activeEmitter.ytDlpProcess) {
                        activeEmitter.ytDlpProcess.kill('SIGKILL');
                    }
                }, 1000);
            } catch (e) {
                console.error('Error killing process:', e);
            }
        }

        isDownloading = false;
        const count = getDownloadedFiles().length;
        broadcast({ type: 'cancelled', count });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true, message: 'Download process cancelled.', count }));
    }

    // 4. Download ZIP Endpoint
    if (req.method === 'GET' && pathname === '/api/download-zip') {
        const files = getDownloadedFiles();

        if (files.length === 0) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('No downloaded files found to compress.');
        }

        try {
            console.log(`Packaging ${files.length} file(s) into ZIP...`);
            const zip = new JSZip();

            for (const file of files) {
                const filePath = path.join(outputFolder, file);
                if (fs.existsSync(filePath)) {
                    zip.file(file, fs.readFileSync(filePath));
                }
            }

            const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

            res.writeHead(200, {
                'Content-Type': 'application/zip',
                'Content-Disposition': 'attachment; filename="downloaded_songs.zip"',
                'Content-Length': zipBuffer.length
            });
            res.end(zipBuffer);
        } catch (err) {
            console.error('Error generating zip:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Failed to create ZIP package.');
        }
        return;
    }

    // 404 for unknown API route
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found.' }));
});

// Start Server
ensureBinary().then(() => {
    server.listen(PORT, () => {
        console.log(`===================================================`);
        console.log(` Playlist Downloader Server is running on port ${PORT}`);
        console.log(` Open your browser: http://localhost:${PORT}`);
        console.log(`===================================================`);
    });
}).catch(err => {
    console.error('Initialization error:', err);
});

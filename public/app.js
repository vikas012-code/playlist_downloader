document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const downloadForm = document.getElementById('download-form');
    const playlistUrlInput = document.getElementById('playlist-url');
    const startBtn = document.getElementById('start-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    
    const radioMp4 = document.getElementById('label-mp4');
    const radioMp3 = document.getElementById('label-mp3');
    
    const progressSection = document.getElementById('progress-section');
    const statusBadge = document.getElementById('status-badge');
    const speedInfo = document.getElementById('speed-info');
    const currentSongTitle = document.getElementById('current-song-title');
    const progressFill = document.getElementById('progress-fill');
    const percentText = document.getElementById('percent-text');
    const etaText = document.getElementById('eta-text');
    
    const songsSection = document.getElementById('songs-section');
    const songsList = document.getElementById('songs-list');
    const trackCounter = document.getElementById('track-counter');
    
    const zipSection = document.getElementById('zip-section');
    const zipTitle = document.getElementById('zip-title');
    const zipSubtitle = document.getElementById('zip-subtitle');
    const downloadZipBtn = document.getElementById('download-zip-btn');

    // Server Startup Loader Elements
    const serverLoader = document.getElementById('server-loader');
    const loaderStatus = document.getElementById('loader-status');

    let eventSource = null;
    let trackMap = new Map(); // trackId -> { title, status }
    let trackOrder = [];

    // --- SERVER WAKEUP HEALTH CHECK ---
    async function checkServerHealth() {
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds max timeout

        async function ping() {
            attempts++;
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 sec timeout per fetch

                const res = await fetch('/api/health', { signal: controller.signal });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data = await res.json();
                    if (data.status === 'ok') {
                        // Hide startup loader smoothly
                        serverLoader.classList.add('hidden');
                        return;
                    }
                }
            } catch (err) {
                console.log(`Server wakeup ping attempt ${attempts} failed, retrying...`);
            }

            if (attempts > 5) {
                loaderStatus.textContent = 'Server spin up in progress (free tier spinup may take ~15s)...';
            } else if (attempts > 12) {
                loaderStatus.textContent = 'Still waking up server... Almost ready!';
            }

            if (attempts < maxAttempts) {
                setTimeout(ping, 1000);
            } else {
                loaderStatus.textContent = 'Server response took too long. Please refresh the page.';
            }
        }

        ping();
    }

    // Run health check on startup
    checkServerHealth();

    // Format radio active toggle
    document.querySelectorAll('input[name="format"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            radioMp4.classList.toggle('active', e.target.value === 'mp4');
            radioMp3.classList.toggle('active', e.target.value === 'mp3');
        });
    });

    // Start Download
    downloadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const url = playlistUrlInput.value.trim();
        if (!url) return;

        const format = document.querySelector('input[name="format"]:checked').value;

        // Reset UI state
        resetUI();
        setDownloadingState(true);

        try {
            const res = await fetch('/api/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, format })
            });

            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Failed to start download process.');
                setDownloadingState(false);
                return;
            }

            // Connect to EventSource SSE endpoint
            connectEventSource();
        } catch (err) {
            console.error('Error starting download:', err);
            alert('Could not connect to server.');
            setDownloadingState(false);
        }
    });

    // Cancel Download
    cancelBtn.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to cancel the active download?')) return;

        cancelBtn.disabled = true;
        cancelBtn.innerText = 'Cancelling...';

        try {
            await fetch('/api/cancel', { method: 'POST' });
        } catch (err) {
            console.error('Error cancelling:', err);
        }
    });

    // Download ZIP
    downloadZipBtn.addEventListener('click', () => {
        window.location.href = '/api/download-zip';
    });

    function connectEventSource() {
        if (eventSource) eventSource.close();

        eventSource = new EventSource('/api/stream');

        eventSource.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                handleStreamEvent(data);
            } catch (err) {
                console.error('SSE JSON parse error:', err);
            }
        };

        eventSource.onerror = (err) => {
            console.log('SSE connection closed or lost.');
            eventSource.close();
        };
    }

    function handleStreamEvent(data) {
        switch (data.type) {
            case 'init':
                statusBadge.textContent = 'Initializing';
                statusBadge.className = 'status-badge downloading';
                break;

            case 'status':
                currentSongTitle.textContent = data.message;
                break;

            case 'song_downloading':
                updateSongStatus(data.title, 'downloading');
                currentSongTitle.textContent = data.title;
                break;

            case 'song_completed':
                updateSongStatus(data.title || data.filename, 'downloaded');
                break;

            case 'progress':
                if (data.percent !== undefined) {
                    const percent = Math.min(100, Math.max(0, data.percent));
                    progressFill.style.width = `${percent}%`;
                    percentText.textContent = `${percent.toFixed(1)}%`;
                }
                if (data.currentSpeed) speedInfo.textContent = data.currentSpeed;
                if (data.eta) etaText.textContent = `ETA: ${data.eta}`;
                break;

            case 'finished':
                setDownloadingState(false);
                statusBadge.textContent = 'Completed';
                statusBadge.className = 'status-badge completed';
                currentSongTitle.textContent = 'All downloads finished!';
                progressFill.style.width = '100%';
                percentText.textContent = '100%';
                
                // Show ZIP Section
                zipTitle.textContent = 'Download Complete!';
                zipSubtitle.textContent = `Successfully downloaded ${data.count || ''} songs. Download zip package now.`;
                zipSection.classList.remove('hidden');

                if (eventSource) eventSource.close();
                break;

            case 'cancelled':
                setDownloadingState(false);
                statusBadge.textContent = 'Cancelled';
                statusBadge.className = 'status-badge cancelled';
                currentSongTitle.textContent = 'Download process was cancelled.';
                
                // Mark any downloading song as cancelled
                trackMap.forEach((track, id) => {
                    if (track.status === 'downloading') {
                        updateSongStatus(track.title, 'cancelled');
                    }
                });

                // Show ZIP Section if any file was downloaded
                if (data.count > 0) {
                    zipTitle.textContent = 'Download Cancelled';
                    zipSubtitle.textContent = `${data.count} song(s) were downloaded before cancellation. Export zip folder now.`;
                    zipSection.classList.remove('hidden');
                } else {
                    currentSongTitle.textContent = 'Cancelled. No songs were downloaded.';
                }

                if (eventSource) eventSource.close();
                break;

            case 'error':
                setDownloadingState(false);
                statusBadge.textContent = 'Error';
                statusBadge.className = 'status-badge cancelled';
                currentSongTitle.textContent = `Error: ${data.message}`;
                if (eventSource) eventSource.close();
                break;
        }
    }

    function updateSongStatus(title, status) {
        if (!title) return;
        const key = title.trim();

        if (!trackMap.has(key)) {
            trackOrder.push(key);
        }
        trackMap.set(key, { title: key, status });

        // If newly downloading, set all previous 'downloading' to 'downloaded'
        if (status === 'downloading') {
            trackMap.forEach((track, k) => {
                if (k !== key && track.status === 'downloading') {
                    track.status = 'downloaded';
                }
            });
        }

        renderSongList();
    }

    function renderSongList() {
        songsSection.classList.remove('hidden');
        trackCounter.textContent = `${trackMap.size} track(s)`;
        songsList.innerHTML = '';

        trackOrder.forEach(key => {
            const track = trackMap.get(key);
            if (!track) return;

            const card = document.createElement('div');
            card.className = `song-card ${track.status}`;

            let statusHTML = '';
            if (track.status === 'downloading') {
                statusHTML = `
                    <span class="song-status-pill downloading">
                        <div class="spinner"></div> Downloading
                    </span>`;
            } else if (track.status === 'downloaded') {
                statusHTML = `
                    <span class="song-status-pill downloaded">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg> Downloaded
                    </span>`;
            } else {
                statusHTML = `
                    <span class="song-status-pill cancelled">
                        Cancelled
                    </span>`;
            }

            card.innerHTML = `
                <div class="song-card-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--text-dim); flex-shrink: 0;">
                        <path d="M9 18V5l12-2v13"></path>
                        <circle cx="6" cy="18" r="3"></circle>
                        <circle cx="18" cy="16" r="3"></circle>
                    </svg>
                    <span class="song-name">${escapeHTML(track.title)}</span>
                </div>
                ${statusHTML}
            `;

            songsList.appendChild(card);
        });
    }

    function setDownloadingState(isDownloading) {
        if (isDownloading) {
            startBtn.disabled = true;
            cancelBtn.disabled = false;
            cancelBtn.hidden = false;
            cancelBtn.innerHTML = `
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="15" y1="9" x2="9" y2="15"></line>
                    <line x1="9" y1="9" x2="15" y2="15"></line>
                </svg> Cancel Download`;
            progressSection.classList.remove('hidden');
        } else {
            startBtn.disabled = false;
            cancelBtn.disabled = true;
            cancelBtn.hidden = true;
        }
    }

    function resetUI() {
        trackMap.clear();
        trackOrder = [];
        songsList.innerHTML = '';
        songsSection.classList.add('hidden');
        zipSection.classList.add('hidden');
        progressFill.style.width = '0%';
        percentText.textContent = '0%';
        speedInfo.textContent = '-- KB/s';
        etaText.textContent = 'ETA: --';
        statusBadge.textContent = 'Starting...';
        statusBadge.className = 'status-badge downloading';
        currentSongTitle.textContent = 'Connecting...';
    }

    function escapeHTML(str) {
        return str.replace(/[&<>'"]/g, 
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }
});

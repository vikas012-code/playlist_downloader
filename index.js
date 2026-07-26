const YTDlpWrap = require('yt-dlp-wrap').default;
const path = require('path');
const fs = require('fs');
const ffmpeg = require('@ffmpeg-installer/ffmpeg');

const ytDlpPath = path.join(__dirname, 'yt-dlp.exe');

async function downloadPlaylist() {
    // 1. Ensure yt-dlp binary exists
    if (!fs.existsSync(ytDlpPath)) {
        console.log('yt-dlp binary not found. Downloading latest version...');
        await YTDlpWrap.downloadFromGithub(ytDlpPath);
        console.log('Download complete.');
    }

    const ytDlpWrap = new YTDlpWrap(ytDlpPath);
    const playlistUrl = 'https://www.youtube.com/watch?v=1tiHpkRbWf8&list=RD1tiHpkRbWf8&index=1';
    const outputFolder = path.join(__dirname, 'my_audio_library');

    // Create output folder if it doesn't exist
    if (!fs.existsSync(outputFolder)) {
        fs.mkdirSync(outputFolder);
    }

    console.log('Starting playlist download...');
    let ytDlpEventEmitter = ytDlpWrap.exec([
    playlistUrl, //for video
        // 1. SELECT FORMAT: Best video up to 360p + best audio
        '-f', 'bestvideo[height<=360]+bestaudio/best[height<=360]',

        // 2. SPECIFY EXTENSION (Optional but recommended for compatibility)
        '--merge-output-format', 'mp4',

        '-o', `${outputFolder}/%(title)s.%(ext)s`,
        '--yes-playlist',
        '--add-metadata',
        '--ignore-errors',
        '--ffmpeg-location', ffmpeg.path,
        '--extractor-args', 'youtube:player_client=android,web'
    ])
    // let ytDlpEventEmitter = ytDlpWrap.exec([
    //     playlistUrl,
    //     '-x',                          // Extract audio
    //     '--audio-format', 'mp3',       // Convert to mp3
    //     '--audio-quality', '5',
    //     '-o', `${outputFolder}/%(title)s.%(ext)s`,
    //     '--yes-playlist',
    //     '--add-metadata',
    //     // FIX FOR FFmpeg ERROR:
    //     '--ignore-errors',
    //     '--ffmpeg-location', ffmpeg.path,
    //     // FIX FOR JS RUNTIME WARNING:
    //     '--extractor-args', 'youtube:player_client=android,web'
    // ])
    .on('progress', (progress) => {
        console.log(`[${progress.percent}%] ${progress.totalSize} - Speed: ${progress.currentSpeed}`);
    })
    .on('ytDlpEvent', (eventType, eventData) => {
        if (eventType === 'download') console.log(`Downloading: ${eventData}`);
    })
    .on('error', (error) => {
        console.error('Detailed Error:', error);
    })
    .on('close', () => {
        console.log('Download Complete! Check your "my_audio_library" folder.');
    });
}

downloadPlaylist();

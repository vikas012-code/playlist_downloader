# 🎵 Media & Playlist Downloader

A modern, web-based YouTube playlist and video downloader built with Node.js and `yt-dlp`. It features real-time track progress tracking, live download cancellation, format selection (MP3 audio / MP4 video), and single-click ZIP archive exports.

---

## ✨ Features

- **Playlist & Video Downloads**: Download full YouTube playlists or single video URLs.
- **Audio & Video Formats**: Choose between high-quality **MP3 Audio** or **MP4 Video** (up to 360p).
- **Real-Time Track Status**: View live progress percentages, current download speeds, ETAs, and itemized track statuses (`Downloading`, `Downloaded`, `Cancelled`).
- **Live Cancel Feature**: Cancel an active download anytime with one click. The server gracefully stops the background `yt-dlp` process.
- **ZIP Export**: Download all completed songs as a single `.zip` folder archive upon completion or cancellation.
- **Auto-Download yt-dlp**: Automatically fetches the latest `yt-dlp.exe` binary if not present locally.

---

## 🛠️ Prerequisites & Requirements

1. **Node.js**: Ensure Node.js (v14 or higher) is installed on your computer.
   - Check version: `node -v`
2. **`yt-dlp.exe` Binary**:
   - **Automatic Setup (Recommended)**: The application will automatically download the latest official `yt-dlp.exe` binary from GitHub on its initial launch.
   - **Manual Download (Alternative)**: If your network restricts automated binary downloads, download `yt-dlp.exe` manually from [yt-dlp GitHub Releases](https://github.com/yt-dlp/yt-dlp/releases) and place `yt-dlp.exe` directly in the project root directory.
3. **FFmpeg**: Handled automatically via `@ffmpeg-installer/ffmpeg` for audio extraction and media format merging.

---

## 🚀 Quick Start & Installation

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/vikas012-code/playlist_downloader.git
   cd playlist_downloader
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Start the Server**:
   ```bash
   npm start
   ```
   *(Or run `node index.js`)*

4. **Access the Web Frontend**:
   Open your browser and navigate to:
   [http://localhost:3000](http://localhost:3000)

---

## 💻 How to Use

1. Paste any **YouTube Playlist URL** or **Single Video URL** into the input field.
2. Select your desired output format (**MP4 Video** or **MP3 Audio**).
3. Click **Start Download**.
4. Watch real-time progress for each song as it downloads.
5. Need to stop? Click **Cancel Download** at any time.
6. Once completed (or cancelled), click **Download Folder as ZIP** to save all downloaded media files to your computer in a `.zip` archive.

---

## 📁 File Structure

```text
playlist_downloader/
├── index.js                  # Node.js HTTP server & SSE API endpoints
├── package.json              # Project metadata & dependencies
├── yt-dlp.exe                # Executable binary (auto-downloaded)
├── my_audio_library/         # Directory where downloaded files are saved
└── public/
    ├── index.html            # Web interface HTML
    ├── style.css             # Glassmorphism dark mode CSS styling
    └── app.js                # Frontend SSE client & state management
```

---

## 🐞 Troubleshooting

- **Binary Download Issues**: If `yt-dlp.exe` fails to download automatically on startup, manually download `yt-dlp.exe` from [https://github.com/yt-dlp/yt-dlp/releases/latest](https://github.com/yt-dlp/yt-dlp/releases/latest) and copy it to the root project folder.
- **Port Conflict**: By default, the server runs on port `3000`. You can change it by running: `PORT=8080 npm start`.

---

## 📜 License

ISC License.

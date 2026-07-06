<p align="center">
  <a href="https://pyannote.ai/" target="blank"><img src="https://avatars.githubusercontent.com/u/162698670" width="64" /></a>
</p>

<div align="center">
    <h1><code>Live subtitling</code> demo</h1>
</div>

Combine [pyannoteAI Live](https://pyannote.ai/) real-time speaker diarization with OpenAI Realtime transcription to display live, speaker-labeled subtitles on top of any video.

This demo runs a small [Bun](https://bun.com) + [Hono](https://hono.dev) server in front of the browser. The browser plays a video, taps its audio through an `AudioWorklet`, and streams 16 kHz PCM chunks to the server over WebSocket. For each chunk, the server:

1. Sends the original 16 kHz Float32 PCM to pyannoteAI Live for speaker diarization,
2. Resamples to 24 kHz 16-bit PCM and sends it to OpenAI Realtime for transcription,
3. Reconciles each finalized transcript with the currently active pyannoteAI speaker label,
4. Pushes `partial` and `final` subtitle events back to the browser for display.

API keys stay server-side. The browser only talks to this demo server.

You can reproduce this `Live subtitling` demo in five simple steps:

1. Clone the repository

   ```bash
   git clone https://github.com/pyannoteai/tutorials.git
   ```

2. Move to this directory

   ```bash
   cd tutorials/2026-07-live-subtitling
   ```

3. Install [Bun](https://bun.com) (v1.3.14 or newer), then install dependencies

   ```bash
   bun install
   ```

4. Provide a video file (e.g. an interview or podcast clip with several speakers), copy your API keys into a local `.env` from the bundled example, and drop your clip into the bundled `samples/` directory:

   ```bash
   cp /path/to/your/clip.mp4 samples/podcast_clip.mp4
   cp .env.example .env   # then edit .env to fill in your keys
   ```

5. Build the client and start the server
   ```bash
   bun run start
   ```

Open <http://localhost:3000>, press play, and live subtitles with speaker labels should appear over the video.

To rebuild the client automatically while editing, use the hot-reloading dev script:

```bash
bun run dev
```

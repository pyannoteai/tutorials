import { useRef, useState } from "hono/jsx";
import { render } from "hono/jsx/dom";

const RATE = 16_000;

/*
  Step 2/5: prepare browser audio for streaming

  Browser video audio usually arrives at 44.1/48 kHz.
  pyannoteAI Live diarization receives steady 16 kHz PCM.
  This keeps streamed audio small and predictable.
*/
function downsample(input: Float32Array, rate: number) {
  if (rate === RATE) return input;

  const ratio = rate / RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));

  for (let i = 0; i < output.length; i++) {
    const inputIndex = Math.floor(i * ratio);
    output[i] = input[inputIndex] ?? 0;
  }

  return output;
}

const PER_PAGE = 14;

function page(words: string[], index: number) {
  const start = index * PER_PAGE;
  return words.slice(start, start + PER_PAGE).join(" ");
}

function App() {
  const videoElement = useRef<HTMLVideoElement>(null);
  const serverSocket = useRef<WebSocket | null>(null);
  const readyCallback = useRef(() => {});
  const failedCallback = useRef((_text: string) => {});
  const leftoverSamples = useRef(new Float32Array(0));
  const playing = useRef(false);
  const starting = useRef(false);
  const initialized = useRef(false);
  const apiReady = useRef(false);
  const streaming = useRef(false);
  const captureNode = useRef<AudioWorkletNode | null>(null);
  const [status, setStatus] = useState("idle");
  const [speaker, setSpeaker] = useState<string | null>(null);
  const [text, setText] = useState("");

  function setStreaming(value: boolean) {
    streaming.current = value;
    captureNode.current?.port.postMessage({ streaming: value });
  }

  /*
    Step 5/5: receive server events for visualization

    Server sends status, partial, and final events.
    Client renders current speaker plus newest text page.
    No API logic here. Browser stays display-only.
  */
  async function connect() {
    if (serverSocket.current) return;

    const socket = new WebSocket(`ws://${location.host}/ws`);
    serverSocket.current = socket;
    socket.binaryType = "arraybuffer";

    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === "status") setStatus(message.text);

      if (message.type === "ready") {
        apiReady.current = true;
        setStreaming(streaming.current === true);
        readyCallback.current?.();
      }

      if (message.type === "failed") failedCallback.current?.(message.text);

      if (message.type === "partial") {
        setSpeaker(message.speaker);
        const words = message.text.trim().split(/\s+/).filter(Boolean);
        const pageIndex = Math.max(0, Math.floor((words.length - 1) / PER_PAGE));
        setText(page(words, pageIndex));
      }

      if (message.type === "final") {
        setSpeaker(message.speaker);
        const words = message.text.trim().split(/\s+/).filter(Boolean);
        const pageIndex = Math.max(0, Math.floor((words.length - 1) / PER_PAGE));
        setText(page(words, pageIndex));
      }
    };

    await new Promise<void>((resolveOpen) =>
      socket.addEventListener("open", () => resolveOpen(), { once: true }),
    );

    socket.send(JSON.stringify({ type: "start" }));
  }

  /*
    Step 2 continued: capture audio from video

    AudioWorklet reads samples from video element.
    UI thread receives Float32 chunks, downsamples, then sends binary WS frames.
    Chunk size is 1600 samples: 100 ms at 16 kHz.
  */
  async function initAudio() {
    const video = videoElement.current;
    if (!video) return;
    if (initialized.current) return;

    const audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule("/capture-worklet.js");

    const source = audioContext.createMediaElementSource(video);
    const capture = new AudioWorkletNode(audioContext, "capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      outputChannelCount: [1],
    });

    captureNode.current = capture;

    source.connect(capture);
    capture.connect(audioContext.destination);
    source.connect(audioContext.destination);

    capture.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!streaming.current || !apiReady.current) return;

      const chunk = downsample(e.data, audioContext.sampleRate);
      const previousSamples = leftoverSamples.current ?? new Float32Array(0);
      const samples = new Float32Array(previousSamples.length + chunk.length);

      samples.set(previousSamples);
      samples.set(chunk, previousSamples.length);

      let offset = 0;

      while (offset + 1600 <= samples.length) {
        const frame = samples.slice(offset, offset + 1600);
        serverSocket.current?.send(frame.buffer);
        offset += 1600;
      }

      leftoverSamples.current = samples.slice(offset);
    };

    await audioContext.resume();
    initialized.current = true;
  }

  async function prime() {
    const video = videoElement.current;
    if (!video || starting.current) return;

    if (initialized.current) {
      playing.current = true;
      setStreaming(apiReady.current === true);
      await video.play();
      return;
    }

    starting.current = true;
    playing.current = false;
    setStreaming(false);
    setStatus("starting");

    try {
      await initAudio();
      playing.current = true;
      await video.play();
      setStreaming(false);
      await connect();

      await new Promise<void>((resolve, reject) => {
        readyCallback.current = resolve;
        failedCallback.current = (text) => reject(new Error(text));
      });

      setStreaming(true);
    } catch (err) {
      starting.current = false;
      setStatus(`${err}`.replace(/^Error: /, ""));
      return;
    }

    starting.current = false;
  }

  function pause() {
    if (!playing.current || starting.current) return;

    playing.current = false;
    setStreaming(false);
    leftoverSamples.current = new Float32Array(0);
    serverSocket.current?.send(JSON.stringify({ type: "pause" }));
  }

  return (
    <main>
      <style>{css}</style>
      <section class="stage">
        <video
          ref={videoElement}
          src="/video"
          controls
          playsinline
          onPlay={() => !playing.current && !starting.current && prime()}
          onPause={pause}
        />
        {text && (
          <div class="sub">
            {speaker && <span class="lbl">{speaker}</span>}
            <span>{text}</span>
          </div>
        )}
      </section>
      <section class="controls">
        <code>{status}</code>
      </section>
    </main>
  );
}

const css = `
body {
  margin: 0;
  background: #080808;
  color: #eee;
  font-family: Inter, system-ui, sans-serif;
  min-height: 100vh;
  display: grid;
  place-items: center;
}

main {
  width: min(1100px, 94vw);
}

.stage {
  position: relative;
  background: #000;
  border-radius: 18px;
  overflow: hidden;
}

.stage > video {
  display: block;
  width: 100%;
  max-height: 78vh;
}

.sub {
  position: absolute;
  left: 9%;
  right: 9%;
  bottom: 8%;
  text-align: center;
  font-size: clamp(16px, 2.3vw, 30px);
  font-weight: 800;
  line-height: 1.28;
  padding-top: 32px;
}

.sub b,
.sub .lbl {
  display: block;
  position: absolute;
  left: 50%;
  bottom: 100%;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 4px 9px;
  border-radius: 999px;
  background: #10b981;
  color: #03140c;
  font-size: 12px;
  letter-spacing: 0.08em;
  margin-bottom: 8px;
}

.sub span {
  display: inline;
  white-space: pre-wrap;
  background: rgba(0, 0, 0, 0.72);
  padding: 3px 9px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin: 16px 4px;
  color: #aaa;
}

code {
  margin-left: auto;
  color: #777;
}
`;

render(<App />, document.getElementById("root")!);

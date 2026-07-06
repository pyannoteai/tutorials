import { Hono } from "hono";
import { upgradeWebSocket, websocket } from "hono/bun";
import OpenAI from "openai";
import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";
import { resolve } from "node:path";

const app = new Hono();
const VIDEO = resolve(Bun.argv[2] ?? "samples/podcast_clip.mp4");
const SAMPLE_RATE = 16_000;
const OPENAI_RATE = 24_000;

type Client = { send(data: string): void };

class Session {
  activeSpeakers: string[] = [];
  uncommitted = false;
  pyannote?: WebSocket;
  openai?: OpenAIRealtimeWebSocket;

  client?: Client;
  chunks = 0;
  bytes = 0;
  loggedPyannote = false;

  get speaker() {
    return this.activeSpeakers.at(-1) ?? null;
  }

  send(data: object) {
    this.client?.send(JSON.stringify(data));
  }

  /*
    Step 1/5: connect live APIs

    Server creates one pyannoteAI Live stream with REST.
    Response contains WebSocket URL for diarization events.
    OpenAI WebSocket runs in transcription mode.
    API keys stay server-side. Browser only talks to this server.
  */
  async start() {
    const pyannoteKey = Bun.env.PYANNOTEAI_API_KEY;
    const openaiKey = Bun.env.OPENAI_API_KEY;

    if (!pyannoteKey || !openaiKey) throw new Error("missing PYANNOTEAI_API_KEY or OPENAI_API_KEY");

    this.send({ type: "status", text: "connecting" });
    console.log("client start -> connecting APIs");

    const response = await fetch("https://api.pyannote.ai/v1/live", {
      method: "POST",
      headers: { Authorization: `Bearer ${pyannoteKey}` },
    });

    if (!response.ok) throw new Error(await response.text());

    const stream = await response.json();
    console.log(`pyannoteAI stream created -> ${stream.id ?? "no-id"}`);

    await Promise.all([this.openPyannote(stream.url), this.openOpenAI(openaiKey)]);

    this.send({ type: "ready" });
    this.send({ type: "status", text: "ready" });
  }

  /*
    Step 4A/5: receive pyannoteAI diarization

    pyannoteAI sends speaker_start and speaker_end events.
    activeSpeakers[] is current speaker stack.
    Last active speaker labels incoming transcript text.
    speaker_end commits pending OpenAI audio buffer.
  */
  openPyannote(url: string) {
    return new Promise<void>((resolveOpen, reject) => {
      const socket = new WebSocket(url);
      this.pyannote = socket;
      socket.binaryType = "arraybuffer";

      socket.onopen = () => {
        console.log("pyannoteAI ws open");
        resolveOpen();
      };

      socket.onerror = () => {
        console.log("pyannoteAI ws error");
        reject(new Error("pyannoteAI websocket error"));
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        const diarization = message.data;

        if (!this.loggedPyannote) {
          this.loggedPyannote = true;
          console.log(`pyannoteAI sample -> ${JSON.stringify(message)}`);
        }

        if (
          message.type === "diarization_speaker_start" &&
          !this.activeSpeakers.includes(diarization.speaker)
        ) {
          this.activeSpeakers.push(diarization.speaker);
        }

        if (message.type === "diarization_speaker_end") {
          this.activeSpeakers = this.activeSpeakers.filter(
            (speaker) => speaker !== diarization.speaker,
          );
          this.commit();
        }

        if (message.type === "error") {
          console.log(`pyannoteAI error -> ${message.message}`);
          this.send({ type: "status", text: message.message });
        }
      };
    });
  }

  /*
    Step 4B/5: receive transcript and reconcile

    OpenAI sends partial words and final transcript text.
    current pyannoteAI speaker becomes transcript speaker label.
    This is reconciliation point: diarization state + transcript text -> client event.
    Timestamped segment matching belongs here when tighter alignment is needed.
  */
  openOpenAI(openaiKey: string) {
    return new Promise<void>((resolveOpen, reject) => {
      let partialTranscript = "";

      const socket = new OpenAIRealtimeWebSocket(
        {
          model: "gpt-realtime",
          onURL: (url) => {
            url.searchParams.delete("model");
            url.searchParams.set("intent", "transcription");
          },
        },
        new OpenAI({ apiKey: openaiKey }),
      );

      this.openai = socket;

      socket.on("error", (error) => {
        console.log(`openai error -> ${error.message}`);
        this.send({ type: "status", text: error.message });
      });

      socket.on("conversation.item.input_audio_transcription.delta", ({ delta = "" }) => {
        partialTranscript += delta;
        console.log(`openai delta -> ${delta.length} chars`);
        this.send({ type: "partial", speaker: this.speaker, text: partialTranscript });
      });

      socket.on("conversation.item.input_audio_transcription.completed", (event) => {
        const text = event.transcript.trim();
        const speaker = this.speaker;

        console.log(`openai final -> ${text.length} chars -> ${speaker ?? "none"}`);

        if (text) this.send({ type: "final", speaker, text });

        partialTranscript = "";
      });

      socket.socket.addEventListener(
        "open",
        () => {
          console.log("openai ws open");
          socket.send({
            type: "session.update",
            session: {
              type: "transcription",
              audio: {
                input: {
                  format: { type: "audio/pcm", rate: OPENAI_RATE },
                  transcription: { model: "gpt-realtime-whisper", language: "en", delay: "low" },
                  turn_detection: null,
                },
              },
            },
          });
          resolveOpen();
        },
        { once: true },
      );

      socket.socket.addEventListener("error", () => reject(new Error("OpenAI websocket error")), {
        once: true,
      });
    });
  }

  /*
    Step 3/5: send audio to both APIs

    pyannoteAI gets original 16 kHz Float32 PCM.
    OpenAI gets 24 kHz 16-bit base64 PCM.
    Same chunk feeds both systems.
    Format conversion stays near provider boundary.
  */
  async audio(data: Blob | ArrayBufferLike) {
    if (!this.pyannote || !this.openai || this.pyannote.readyState !== WebSocket.OPEN) return;

    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const samples = new Float32Array(buffer);

    this.chunks += 1;
    this.bytes += buffer.byteLength;

    if (this.chunks === 1) this.send({ type: "status", text: "audio streaming" });

    if (this.chunks === 1 || this.chunks % 50 === 0)
      console.log(`audio chunk ${this.chunks} -> ${buffer.byteLength} bytes, total ${this.bytes}`);

    this.pyannote.send(buffer);
    this.openai.send({ type: "input_audio_buffer.append", audio: pcm24(samples) });

    this.uncommitted = true;
  }

  commit() {
    if (!this.openai || !this.uncommitted) return;

    console.log(`commit -> ${this.chunks} chunks`);
    this.openai.send({ type: "input_audio_buffer.commit" });

    this.uncommitted = false;
  }

  close() {
    this.pyannote?.send(JSON.stringify({ type: "end_of_stream" }));
    this.pyannote?.close();
    this.openai?.close();
  }
}

/*
  Step 3 helper: prepare audio for OpenAI

  Small 16 kHz -> 24 kHz resampler.
  Clamp Float32 samples to int16 PCM.
  Encode bytes as base64 for OpenAI realtime input_audio_buffer.append.
*/
function pcm24(frame: Float32Array) {
  const sampleCount = Math.floor((frame.length * OPENAI_RATE) / SAMPLE_RATE);
  const pcm = new Int16Array(sampleCount);

  for (let i = 0; i < sampleCount; i++) {
    const sample = frame[Math.floor((i * SAMPLE_RATE) / OPENAI_RATE)] ?? 0;
    pcm[i] = Math.max(-1, Math.min(1, sample)) * 32767;
  }

  return Buffer.from(pcm.buffer).toString("base64");
}

app.get("/", () => new Response(Bun.file(new URL("../index.html", import.meta.url))));
app.get(
  "/client.js",
  () =>
    new Response(Bun.file(new URL("../dist/client.js", import.meta.url)), {
      headers: { "content-type": "text/javascript" },
    }),
);
app.get(
  "/capture-worklet.js",
  () =>
    new Response(Bun.file(new URL("../dist/capture-worklet.js", import.meta.url)), {
      headers: { "content-type": "text/javascript" },
    }),
);
app.get("/video", async (c) => {
  const file = Bun.file(VIDEO);
  if (!(await file.exists())) return c.text(`missing video: ${VIDEO}`, 404);

  const size = file.size;
  const range = c.req.header("range");
  const [a, b] = range?.replace("bytes=", "").split("-") ?? [];
  const start = a ? Number(a) : 0;
  const end = b ? Number(b) : size - 1;

  return new Response(file.slice(start, end + 1), {
    status: range ? 206 : 200,
    headers: {
      "content-type": "video/mp4",
      "accept-ranges": "bytes",
      "content-length": String(end - start + 1),
      ...(range ? { "content-range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
});
app.get(
  "/ws",
  upgradeWebSocket(() => {
    const session = new Session();
    return {
      onMessage: async (event, client) => {
        session.client = client;

        if (typeof event.data === "string") {
          const message = JSON.parse(event.data);

          if (message.type === "start")
            try {
              await session.start();
            } catch (err) {
              session.send({ type: "failed", text: `${err}`.replace(/^Error: /, "") });
            }

          if (message.type === "pause") {
            console.log(`client pause -> commit after ${session.chunks} chunks`);
            session.commit();
          }

          return;
        }

        await session.audio(event.data);
      },
      onClose: () => session.close(),
    };
  }),
);

Bun.serve({ port: 3000, fetch: app.fetch, websocket });
console.log(`App live on http://localhost:3000 using ${VIDEO}`);

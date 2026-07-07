interface AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare const AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (): AudioWorkletProcessor;
};
declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

/*
  Low-latency browser audio tap

  Collect Float32 samples from audio rendering thread.
  Batch until 4096 samples, then post to UI thread.
  Audio capture stays smooth while UI paints subtitles.
*/
class Capture extends AudioWorkletProcessor {
  streaming = false;
  chunks: Float32Array[] = [];
  sampleCount = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ streaming: boolean }>) =>
      (this.streaming = e.data.streaming);
  }

  flush() {
    const merged = new Float32Array(this.sampleCount);
    let offset = 0;

    for (const chunk of this.chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }

    this.chunks = [];
    this.sampleCount = 0;
    this.port.postMessage(merged, [merged.buffer]);
  }

  process(inputs: [[Float32Array]]) {
    const input = inputs[0][0];
    if (!this.streaming) return true;

    const copy = new Float32Array(input.length);
    copy.set(input);

    this.chunks.push(copy);
    this.sampleCount += copy.length;

    if (this.sampleCount >= 4096) this.flush();

    return true;
  }
}

registerProcessor("capture", Capture);

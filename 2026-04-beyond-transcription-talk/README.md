<p align="center">
  <a href="https://pyannote.ai/" target="blank"><img src="https://avatars.githubusercontent.com/u/162698670" width="64" /></a>
</p>

<div align="center">
    <h1><code>Beyond transcription</code> AI Engineer London talk</h1>
</div>


<!-- [![Watch the talk](https://img.youtube.com/vi/xxxxxxxx/maxresdefault.jpg)](https://youtu.be/xxxxxx) -->

You can reproduce locally the `Beyond transcription` demo presented during the talk in four simple steps:


1. Clone the repository
   ```bash
   git clone https://github.com/pyannoteai/tutorials.git
   ```  

2. Move to this directory
   ```bash
   cd tutorials/2026-04-beyond-transcription-talk
   ```

3. [Create a Hugginface token](https://huggingface.co/settings/tokens) and [request access](https://huggingface.co/pyannote/speaker-diarization-community-1) to `community-1` model (approved automatically)

4. Run the notebook with [`uv`](https://docs.astral.sh/uv/)
   ```bash
   HF_TOKEN=... PYANNOTEAI_API_KEY=... uv run jupyter lab demo.ipynb
   ```

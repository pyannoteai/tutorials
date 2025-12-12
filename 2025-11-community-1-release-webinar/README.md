<p align="center">
  <a href="https://pyannote.ai/" target="blank"><img src="https://avatars.githubusercontent.com/u/162698670" width="64" /></a>
</p>

<div align="center">
    <h1><code>community-1</code> release webinar</h1>
</div>

[![Watch the webinar](https://img.youtube.com/vi/EJjNNhj4XB4/maxresdefault.jpg)](https://youtu.be/EJjNNhj4XB4)

You can reproduce locally the `community-1` demo presented during the webinar in three simple steps:

1. Clone the repository
   ```bash
   git clone https://github.com/pyannoteai/tutorials.git
   ```  
2. Move to this directory
   ```bash
   cd tutorials/2025-11-community-1-release-webinar
   ```
3. Run the notebook with [`uv`](https://docs.astral.sh/uv/)
   ```bash
   HF_TOKEN=... PYANNOTEAI_API_KEY=... uv run jupyter lab community-1-demo.ipynb
   ```

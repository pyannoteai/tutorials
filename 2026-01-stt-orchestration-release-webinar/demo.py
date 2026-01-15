import warnings

warnings.filterwarnings("ignore")


from nemo.utils.nemo_logging import Logger

nemo_logger = Logger()
nemo_logger.remove_stream_handlers()

from pathlib import Path
from typing import Any

import torch
from huggingface_hub import hf_hub_download
from ipyannote.blocks.htranscript import HTranscript
from ipyannote.blocks.waveform import Waveform
from ipyannote.blocks.labels import Labels
from ipyannote.utils.sync import js_sync
from ipywidgets import VBox
from nemo.collections.asr.models import ASRModel as _ASRModel
from nemo.core.connectors.save_restore_connector import SaveRestoreConnector
from pyannote.audio.sample import SAMPLE_FILE

AUDIO = SAMPLE_FILE["audio"]
GOLD_TRANSCRIPTION = SAMPLE_FILE["transcription"]

class Reconciliation(VBox):
    def __init__(
        self,
        audio: str,
        diarization: list[dict],
        transcript: list[dict],
    ):
        self._labels = Labels({'N/A': '#808080'})
        self._waveform_diarization = Waveform(audio=audio, annotation=diarization, labels=self._labels)
        self._waveform_transcript = Waveform(audio=audio, annotation=transcript, labels=self._labels)
        self._htranscript = HTranscript(transcript=transcript, labels=self._labels)

        js_sync(self._waveform_diarization, self._waveform_transcript, ['current_time', 'zoom', 'scroll_time'])
        js_sync(self._waveform_diarization, self._htranscript, ['current_time'])
                
        super().__init__(
            [
                self._waveform_diarization,
                self._waveform_transcript,
                self._htranscript,
            ]
        )

    @property
    def transcript(self) -> list[dict]:
        return self._transcript.transcript

    @transcript.setter
    def transcript(self, transcript: list[dict]):
        self._transcript.transcript = transcript


class ASRModel(_ASRModel):
    @classmethod
    def from_pretrained(
        cls,
        model_name: str,
        cache_dir: Path | str | None = None,
        token: str | None = None,
        refresh_cache: bool = False,
        override_config_path: str | None = None,
        map_location: torch.device | None = None,
        strict: bool = True,
        return_config: bool = False,
        trainer: Any | None = None,
        save_restore_connector: Any | None = None,
        return_model_file: bool | None = False,
    ):
        """Load NeMo model from HF cache if offline."""

        if save_restore_connector is None:
            save_restore_connector = SaveRestoreConnector()

        filename = model_name.split("/")[-1] + ".nemo"

        nemo_model_file_in_cache = hf_hub_download(
            repo_id=model_name,
            filename=filename,
            cache_dir=cache_dir,
            local_files_only=False,
            token=token,
        )

        if return_model_file:
            return nemo_model_file_in_cache

        instance = cls.restore_from(
            restore_path=nemo_model_file_in_cache,
            override_config_path=override_config_path,
            map_location=map_location,
            strict=strict,
            return_config=return_config,
            trainer=trainer,
            save_restore_connector=save_restore_connector,
        )

        return instance


class Parakeet:
    def __init__(self):
        self._model = ASRModel.from_pretrained("nvidia/parakeet-tdt-0.6b-v3")

    def __call__(self, audio: Path) -> list[dict]:
        (prediction, *_), _ = self._model.transcribe(str(audio), timestamps=True)
        words = []
        for w in prediction.timestep["word"]:
            words.append({"start": w["start"], "end": w["end"], "text": w["word"], "speaker": "N/A"})

        return words

parakeet = Parakeet()

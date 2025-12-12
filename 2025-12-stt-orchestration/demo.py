import os
import warnings

from pyannote.audio.sample import SAMPLE_FILE
from pyannoteai.sdk import Client

from ipywidgets import VBox
from ipyannote.blocks.horizontal_transcript import HorizontalTranscript
from ipyannote.blocks.waveform import Waveform


warnings.filterwarnings("ignore")

AUDIO = SAMPLE_FILE["audio"]
GOLD_DIARIZATION = SAMPLE_FILE["annotation"].rename_tracks("string")


class STTOrchestration(VBox):
    def __init__(
        self,
        audio: str,
        diarization: list[dict],
        transcript: list[dict] | None = None,
    ):

        self._diarization = Waveform(audio=audio, annotation=diarization)
        self._transcript = HorizontalTranscript(transcript=transcript)
        self._transcript.js_sync_player(self._diarization)

        super().__init__(
            [
                self._diarization,
                self._transcript,
            ]
        )

    @property
    def transcript(self) -> list[dict]:
        return self._transcript.transcript
    
    @transcript.setter
    def transcript(self, transcript: list[dict]):
        self._transcript.transcript = transcript


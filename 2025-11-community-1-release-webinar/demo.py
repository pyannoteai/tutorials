import warnings
warnings.filterwarnings('ignore')

from ipyannote import Waveform, Labels, VBox
from ipywidgets import HTML
from pyannote.core import Annotation
from pathlib import Path


def match(reference: Annotation, hypothesis: Annotation) -> Annotation:
    """Map speakers between reference and hypothesis"""

    from pyannote.metrics.diarization import DiarizationErrorRate
    metric = DiarizationErrorRate()
    hypothesis = hypothesis.rename_labels()
    mapping = metric.optimal_mapping(reference, hypothesis)
    return hypothesis.rename_labels(mapping=mapping)

def visualize(path: Path, annotations: dict[str, Annotation]):
    """Interactive visualization of multiple annotations"""
    
    labels = Labels()

    widgets = []
    titles = {}
    waveforms = {}
    for n, (name, annotation) in enumerate(annotations.items()):    
        if n == 0:
            reference = annotation
            main_waveform = Waveform(path)
            waveforms[name] = main_waveform
            waveforms[name].annotation = annotation.rename_tracks()
            main_waveform.js_sync_labels(labels)
        else:
            annotation = match(reference, annotation)
            waveforms[name] = Waveform(path)         
            waveforms[name].js_sync_player(main_waveform)
            waveforms[name].js_sync_labels(labels)
            waveforms[name].annotation = annotation.rename_tracks()

        
        titles[name] = HTML(f"<h2>{name}</h2>")
        widgets.append(titles[name])
        widgets.append(waveforms[name])

    return VBox(widgets)
    
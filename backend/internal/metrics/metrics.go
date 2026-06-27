package metrics

import "time"

type Recorder interface {
	IncCounter(name string, labels map[string]string)
	ObserveHistogram(name string, value float64, labels map[string]string)
	RecordDuration(name string, start time.Time, labels map[string]string)
}

type NopRecorder struct{}

func (NopRecorder) IncCounter(string, map[string]string) {}

func (NopRecorder) ObserveHistogram(string, float64, map[string]string) {}

func (NopRecorder) RecordDuration(string, time.Time, map[string]string) {}

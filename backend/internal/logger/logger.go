package logger

import (
	"fmt"
	"io"
	"log"
	"strings"
)

type Logger interface {
	With(fields ...any) Logger
	Info(message string, fields ...any)
	Warn(message string, fields ...any)
	Error(message string, fields ...any)
}

type stdLogger struct {
	sink   *log.Logger
	fields []any
}

func NewStdLogger(out io.Writer, service string) Logger {
	return &stdLogger{
		sink:   log.New(out, "", log.LstdFlags|log.LUTC),
		fields: []any{"service", service},
	}
}

func (l *stdLogger) With(fields ...any) Logger {
	merged := append([]any{}, l.fields...)
	merged = append(merged, fields...)

	return &stdLogger{
		sink:   l.sink,
		fields: merged,
	}
}

func (l *stdLogger) Info(message string, fields ...any) {
	l.write("INFO", message, fields...)
}

func (l *stdLogger) Warn(message string, fields ...any) {
	l.write("WARN", message, fields...)
}

func (l *stdLogger) Error(message string, fields ...any) {
	l.write("ERROR", message, fields...)
}

func (l *stdLogger) write(level, message string, fields ...any) {
	merged := append([]any{}, l.fields...)
	merged = append(merged, fields...)
	l.sink.Println(fmt.Sprintf("level=%s msg=%q %s", level, message, formatFields(merged)))
}

func formatFields(fields []any) string {
	if len(fields) == 0 {
		return ""
	}

	parts := make([]string, 0, len(fields)/2+1)
	for i := 0; i < len(fields); i += 2 {
		key := fmt.Sprintf("field_%d", i)
		if i < len(fields) {
			key = fmt.Sprint(fields[i])
		}

		value := "<missing>"
		if i+1 < len(fields) {
			value = fmt.Sprint(fields[i+1])
		}

		parts = append(parts, fmt.Sprintf("%s=%q", key, value))
	}

	return strings.Join(parts, " ")
}

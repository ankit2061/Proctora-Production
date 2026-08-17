# Messaging Topics And Queues

## Purpose

This document captures the intended event transport model for the platform. The repository does not yet define a concrete broker implementation, so the topics and queues below are design placeholders.

## Messaging Goals

- Decouple event capture from scoring.
- Allow the backend and detection engine to scale independently.
- Keep review data available for downstream consumers.
- Preserve a clear path for replay or reprocessing if needed.

## Proposed Channels

### `exam.events`

Carries student behavior events from the backend ingestion layer toward downstream processors.

### `exam.scores`

Carries computed risk scores and supporting signal summaries.

### `exam.reviews`

Carries reviewer or moderation actions that should be visible in session history.

## Queue Usage

- Ingestion queue: receives normalized event payloads.
- Scoring queue: receives items for the detection engine.
- Review queue: receives dashboard or moderation updates.

## Message Shape

Messages should remain small and explicit.

```json
{
	"messageId": "msg_001",
	"type": "focus_lost",
	"sessionId": "sess_789",
	"createdAt": "2026-05-26T10:05:12Z",
	"payload": {}
}
```

## Reliability Considerations

- Messages should be idempotent where possible.
- Consumers should tolerate retries.
- Ordering may matter within a single session stream.
- Failed processing should be visible enough for debugging and replay.

## Notes

The exact broker, exchange, and queue names should be finalized once the runtime stack is selected.

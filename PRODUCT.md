# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Mimicopy imports MP3 files and YouTube audio, separates instruments, and saves tracks for repeat listening and transcription. The library must let users create, rename and delete folders, move tracks, and browse either a folder or unfiled tracks.

## Users

Inferred from the request and README: musicians organizing material for personal transcription and practice. Broader audience and collaboration requirements are undecided.

## Capabilities and Constraints

The existing app provides waveform playback, speed and pitch controls, keyboard shortcuts, markers, stem mixing and beat analysis. Folder changes must preserve audio, markers and separated stems. Deleting a folder returns its tracks to the unfiled collection.

The existing stack is strict TypeScript, React, React Router, TanStack Query, Tailwind and an Express API with SQLite persistence. Accessible controls and keyboard parity are required by AGENTS.md.

## Organization

The user confirmed one-level folders. Each track belongs to zero or one folder.

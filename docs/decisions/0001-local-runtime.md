# 0001 — Native runtime and local storage

Date: 2026-10-27

## Decision

Use Node 24+ with direct execution of erasable TypeScript, native `node:http`, and `node:sqlite`. Serve HTML and local assets from the same process. Keep all packages, fonts, images, and services out of the install path.

## Why

A fresh checkout should run without package installation or network access. A single database and a small router make the source, operations, and behavior easy to inspect. SQLite transactions provide the write ordering needed for checkout and calendar updates.

## Consequences

The app is local, single-process software. Demo sign-in and demo payments are explicit. A public production deployment would require real authentication, payment processing, privacy controls, operations ownership, and a reviewed hosting architecture.

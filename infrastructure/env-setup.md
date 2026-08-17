# Environment Setup

## Purpose

This document describes the intended environment setup for the platform. The repository does not yet include finished runtime scripts or package manifests, so this page serves as a planning guide rather than an exact installation procedure.

## Environment Layers

- Node-based frontend applications.
- Backend service runtime.
- Detection engine runtime.
- Database and migration tooling.
- Messaging or queue infrastructure.

## Expected Local Setup

The eventual development environment will likely need:

- A recent Node.js runtime.
- A package manager such as npm or pnpm.
- A local database instance.
- Environment variables for backend and dashboard services.
- Any queue or messaging dependency used by the event pipeline.

## Configuration Areas

- Backend service configuration.
- Student app runtime configuration.
- Admin app runtime configuration.
- Detection engine configuration.
- Database connection settings.

## Suggested Environment Variables

The exact names are not finalized, but the project will likely need variables in these categories:

- API base URLs.
- Database connection strings.
- Session or auth secrets.
- Messaging broker settings.
- Scoring service URLs.

## Startup Order

1. Start the database and supporting infrastructure.
2. Start the detection engine.
3. Start the backend service.
4. Start the admin dashboard.
5. Start the student app for a demo session.

## Notes

This document should be updated once package manifests, scripts, and service boundaries are implemented.

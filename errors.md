# Error Report

## Issue: `Cannot find module 'ws'`
**Date:** 2025-12-16
**Symptom:** The extension activates but fails to load `CursorCDPHandler` with the error `Cannot find module 'ws'`.
**Context:** This error occurs at runtime in the packaged extension, despite `ws` being listed in `dependencies`.

## Root Cause
The `.vscodeignore` file contained the line:
```
node_modules/**
```
This instructed the packaging tool (`vsce`) to completely exclude the `node_modules` directory from the final VSIX file. Since this project does not use a bundler (like Webpack or Esbuild), the extension relies on the `node_modules` folder being present at runtime to resolve dependencies like `ws`.

## Solution
1. **Modified `.vscodeignore`:** Removed `node_modules/**` from the ignore list.
   - `vsce` is intelligent enough to automatically include `dependencies` (production/runtime) while excluding `devDependencies`.
2. **Repackaged:** Bumped version and created a new VSIX which now correctly contains the `ws` library.

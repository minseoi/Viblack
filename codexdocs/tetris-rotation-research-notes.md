# Tetris Rotation Research Notes (for implementation handoff)

## Verified existing artifact
- `src/renderer/tetris-rotation.ts` already exists and contains a dedicated rotation engine.

## Current engine details (facts)
- Piece domain: `I | O | T | S | Z | J | L`.
- Rotation state: `0 | 1 | 2 | 3`.
- Functions:
  - `getPieceCells(state)`
    - Builds 4 cell offsets from `PIECE_CELLS` and rotates each cell with `CW` matrix `x,y -> y,-x` `rotation` times.
    - Returns absolute world coordinates by adding `state.x, state.y`.
  - `canPlacePiece(board, state)`
    - Requires all cells in bounds and currently empty (`board[y][x] === 0`).
    - `board` is `readonly number[][]`, row-major `[y][x]`.
  - `tryRotatePiece(board, state, direction)`
    - `cw`: `rotation+1 mod 4`, `ccw`: `rotation+3 mod 4`.
    - Applies wall-kick candidates in order:
      - `[0,0], [-1,0], [1,0], [0,-1], [1,-1], [-1,-1]`
    - Returns first candidate that `canPlacePiece` passes; otherwise returns original state.

## What is already done
- A full standalone TS module for rotation-only behavior is present.
- No other `tetris` game loop or renderer call site was found in current repo search.
- No tests found that directly exercise this module yet.

## Assumptions / risks (not guaranteed)
- Board semantics assume empty cell value is `0`; occupancy values must be non-zero.
- Origin assumptions: the module expects piece offsets centered around `(0,0)` for each piece profile as declared in `PIECE_CELLS`.
- Only minimal wall-kick behavior is implemented (not official SRS table for all transition types).

## Suggested implementation path for developer (철수)
1. Ensure a piece engine calls `tryRotatePiece(board, state, dir)` when rotate input occurs.
2. Replace rendering by consuming `getPieceCells` output.
3. Keep `state` updates immutable (module returns new state).
4. Add unit/e2e tests around boundary and wall-kick edge cases for safety.
5. If board uses different empty marker or different coordinate origin, adapt checks before integration.
